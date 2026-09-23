"""Index existing footage (e.g. an official Cat video) so Cat can answer when it's paused.

Like Gemini, this looks at the video as timestamped frames plus its audio,
but it runs once, offline, with no vision model:
  1. shots: frames sampled at 2 fps, a new shot wherever the picture changes
     (colour-histogram difference, OpenCV);
  2. on-screen text of each shot's keyframe with local OCR (rapidocr, CPU):
     Cat's videos label what they show ("Emergency Shut-off", "Operator Station");
  3. the narration with word timestamps (Deepgram prerecorded, ~$0.004/min);
  4. each segment's text is matched to the 320D control catalogue (names and
     synonyms) and to its manual sections (hybrid search, once per segment).
It writes the same index.json as the generated videos, so pausing works the
same way. Caveat, stated in the index: this knows what a moment is *about*,
not where each control is in the picture; a tap on the frame doesn't map to a
control the way it does in the generated videos.

    uv run --group video video_build/index_video.py data/videos/_source/cat-320d-series2-overview.mp4 \
        --id cat-320d-overview --title "Cat 320D Series 2: Official Overview" \
        --source "Cat Products on YouTube (pHSwr3CnqS0), for a private demo"
"""

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import cv2
import httpx
import imageio_ffmpeg
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cat  # noqa: E402,F401  (loads .env)
from cat.controls import catalogue  # noqa: E402
from cat.rag.store import get_store  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
VIDEOS = ROOT / "data" / "videos"
CACHE = VIDEOS / "_cache"

SAMPLE_FPS = 2
SHOT_CHANGE = 0.35  # 1 - histogram correlation between consecutive samples
MIN_SEGMENT = 3.0  # seconds

# Words people (and narrators) use for each numbered control.
SYNONYMS = {
    "2": ["hydraulic lockout", "lockout lever", "hydraulic lock"],
    "3": ["travel lever", "travel pedal", "travel control"],
    "4": ["service hour meter", "hour meter"],
    "5": ["monitor", "display screen", "lcd"],
    "6": ["joystick", "joy stick"],
    "7": ["engine speed dial", "throttle dial", "engine speed control"],
    "8": ["engine start switch", "key switch", "ignition", "start switch"],
    "10": ["operator seat", "operator's seat", "seat", "suspension seat"],
    "11": ["radio"],
    "12": ["backup switch", "backup control"],
    "13": ["travel speed"],
    "14": ["aec", "automatic engine speed"],
    "15": ["travel alarm"],
    "17": ["heavy lift"],
    "19": ["wiper"],
    "18": ["washer"],
    "20": ["light switch", "work light", "lights"],
    "21": ["quick coupler"],
    "25": ["fine swing"],
    "26": ["overload warning"],
    "1a": ["air conditioning", "climate control", "heater", "hvac"],
}


def shots(path: Path) -> list[tuple[float, float, np.ndarray]]:
    """(start, end, keyframe) for each shot."""
    cap = cv2.VideoCapture(str(path))
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS)
    samples = []
    t = 0.0
    while t < duration:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            break
        hist = cv2.calcHist([cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)], [0, 1], None, [30, 32], [0, 180, 0, 256])
        samples.append((t, cv2.normalize(hist, hist).flatten(), frame))
        t += 1 / SAMPLE_FPS
    cuts = [0]
    for i in range(1, len(samples)):
        change = 1 - cv2.compareHist(samples[i - 1][1], samples[i][1], cv2.HISTCMP_CORREL)
        if change > SHOT_CHANGE:
            cuts.append(i)
    result = []
    for a, b in zip(cuts, cuts[1:] + [len(samples)]):
        middle = samples[(a + b - 1) // 2]
        end = samples[b][0] if b < len(samples) else duration
        result.append((samples[a][0], end, middle[2]))
    return result


def merge_short(raw: list[tuple[float, float, np.ndarray]]) -> list[tuple[float, float, np.ndarray]]:
    merged = []
    for start, end, frame in raw:
        if merged and (end - start < MIN_SEGMENT or merged[-1][1] - merged[-1][0] < MIN_SEGMENT):
            s, _, f = merged[-1]
            merged[-1] = (s, end, f if end - start < MIN_SEGMENT else frame)
        else:
            merged.append((start, end, frame))
    return merged


def transcribe(path: Path) -> list[dict]:
    """Words with timestamps (Deepgram prerecorded), cached."""
    cache = CACHE / f"{path.stem}.words.json"
    if cache.exists():
        return json.loads(cache.read_text())
    audio = CACHE / f"{path.stem}.m4a"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(path), "-vn", "-c:a", "copy", str(audio)], check=True)
    response = httpx.post(
        "https://api.deepgram.com/v1/listen",
        params={"model": "nova-3", "smart_format": "true", "punctuate": "true"},
        headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}", "Content-Type": "audio/mp4"},
        content=audio.read_bytes(),
        timeout=300,
    )
    response.raise_for_status()
    words = response.json()["results"]["channels"][0]["alternatives"][0]["words"]
    words = [{"w": w.get("punctuated_word", w["word"]), "start": w["start"], "end": w["end"]} for w in words]
    cache.write_text(json.dumps(words))
    return words


# Logos and marketing lines that say nothing about the machine's parts.
_BRANDING = re.compile(r"^(cat®?|top|mon|joysti)$|320d series 2|total solutions|customer support", re.IGNORECASE)


def screen_text(ocr, frame: np.ndarray) -> list[str]:
    result = ocr(frame)
    if result.txts is None:
        return []
    lines = [t.strip() for t, s in zip(result.txts, result.scores) if s > 0.85 and len(t.strip()) >= 3]
    return [t for t in lines if re.search(r"[A-Za-z]{3}", t) and not _BRANDING.search(t)]


def controls_in(text: str) -> list[str]:
    text = f" {text.lower()} "
    found = []
    for callout, words in SYNONYMS.items():
        if any(re.search(rf"\b{re.escape(w)}s?\b", text) for w in words):
            found.append(callout)
    return found


# On-screen labels whose 320D manual section search doesn't find on its own
# (checked by hand against the manual). Listed first, before search results.
LABEL_SECTIONS = {
    "emergency shut-off": [("Operation Section > Stopping the Engine > Engine Stop Control", 188)],
    "emergency exit": [("Operation Section > Mounting and Dismounting > Alternate Exit", 85)],
    "hydraulic activation": [("Operation Section > Operator Controls > Hydraulic Lockout Control (2)", 96)],
}


async def manual_refs(label: str) -> list[dict]:
    """Manual sections for an on-screen label like "Emergency Shut-off" (labels are specific;
    marketing narration isn't, so it's not used here: Cat searches with it when asked)."""
    passages = await get_store().search(label, top_k=3)
    refs = [{"title": t, "page": p} for t, p in LABEL_SECTIONS.get(label.lower().strip(), [])]
    seen = {r["title"] for r in refs}
    for p in passages:
        if p.title not in seen:
            seen.add(p.title)
            refs.append({"title": p.title, "page": p.page})
    return refs


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--source", default="")
    args = parser.parse_args()
    from rapidocr import RapidOCR

    t0 = time.perf_counter()
    out_dir = VIDEOS / args.id
    out_dir.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    segments_raw = merge_short(shots(args.video))
    print(f"{len(segments_raw)} segments ({time.perf_counter() - t0:.0f}s)")
    words = transcribe(args.video)
    print(f"{len(words)} words transcribed ({time.perf_counter() - t0:.0f}s)")
    ocr = RapidOCR()
    controls = catalogue()

    segments = []
    for i, (start, end, frame) in enumerate(segments_raw):
        said = " ".join(w["w"] for w in words if start - 0.3 <= (w["start"] + w["end"]) / 2 < end)
        shown = screen_text(ocr, frame)
        label = " ".join(shown)
        callouts = controls_in(f"{label} {said}")
        manual = await manual_refs(label) if label else []
        frame_file = f"frame-{i:03d}.jpg"
        cv2.imwrite(str(out_dir / frame_file), cv2.resize(frame, (640, 360)), [cv2.IMWRITE_JPEG_QUALITY, 75])
        segments.append(
            {
                "start": round(start, 2),
                "end": round(end, 2),
                "kind": "footage",
                "caption": label or (said[:80] + ("..." if len(said) > 80 else "")),
                "on_screen_text": shown,
                "transcript": said,
                "image": None,
                "frame": frame_file,
                "controls": [
                    {"callout": c, "name": controls[c].name, "looks_like": controls[c].looks_like,
                     "manual_title": controls[c].title, "page": controls[c].page, "highlighted": False, "box": None}
                    for c in callouts if c in controls
                ],
                "also_in_view": [],
                "picture_legend": {},
                "manual": manual,
                # Hand-checked: the 320D manual's own section for this on-screen label.
                "label_manual": [t for t, _ in LABEL_SECTIONS.get(label.lower().strip(), [])],
            }
        )
        print(f"  {start:6.1f}-{end:6.1f}  text={shown[:3]}  controls={callouts}  manual={[m['title'].split(' > ')[-1] for m in manual]}")

    # A phone-friendly copy of the video: 720p H.264, smaller, starts playing at once.
    mp4 = VIDEOS / f"{args.id}.mp4"
    if not mp4.exists() or mp4.stat().st_mtime < args.video.stat().st_mtime:
        subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(args.video), "-vf", "scale=-2:720",
             "-c:v", "libx264", "-crf", "28", "-preset", "medium", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(mp4)],
            check=True,
        )
    cv2.imwrite(str(out_dir / "poster.jpg"), cv2.resize(segments_raw[0][2], (1280, 720)), [cv2.IMWRITE_JPEG_QUALITY, 85])
    duration = segments[-1]["end"]
    index = {
        "video_id": args.id,
        "title": args.title,
        "source": args.source,
        "indexed_from": "transcript and on-screen text (no vision model); knows what each moment is about, not control positions",
        "duration": duration,
        "url": f"/videos/{args.id}.mp4",
        "subtitles": None,
        "poster": f"/videos/{args.id}/poster.jpg",
        "segments": segments,
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"-> {mp4.relative_to(ROOT)} ({mp4.stat().st_size / 1e6:.0f} MB), {len(segments)} segments in {time.perf_counter() - t0:.0f}s")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
