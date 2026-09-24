"""Render a manual video from its script, and write the index Cat uses when it's paused.

    uv run --group video video_build/build_video.py controls-tour
    uv run --group video video_build/build_video.py start-to-finish

For every scene in video_build/scripts/<id>.json:
  - narration: Cat's own voice (Deepgram Aura-2), one WAV per scene (cached), so
    each scene lasts exactly as long as its narration;
  - picture: the manual's drawing, re-cut from the PDF at high resolution. On
    the overview drawings the camera eases onto the numbered control and puts
    a yellow ring on it (positions from video_build/callouts.json);
  - a caption bar ("(15) Travel Alarm Cancel Switch · manual page 101") and
    burned-in subtitles.
Frames are piped straight into ffmpeg (H.264 + AAC, 1280x720, 24 fps).

Outputs (data/videos/):
  <id>.mp4          the video (git-ignored)
  <id>.vtt          subtitles
  <id>/index.json   what's on screen when: segments with the controls in view,
                    their position in the frame, the narration and the manual
                    section. Because this script draws every frame, the index
                    is exact; a pause is a lookup, no vision model needed.
  <id>/poster.jpg   first frame for the app's video list
"""

import hashlib
import json
import re
import math
import os
import sys
import time
import wave
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import httpx
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cat  # noqa: E402,F401  (loads .env)
from cat.controls import catalogue  # noqa: E402
from cat.rag.images import get_image, render_illustration  # noqa: E402
from cat.rag.parse import parse_manual  # noqa: E402
from cat.rag.store import MANUAL  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).with_name("scripts")
VIDEOS = ROOT / "data" / "videos"
CACHE = VIDEOS / "_cache"

W, H, FPS = 1280, 720, 24
SAMPLE_RATE = 24000
VOICE = os.getenv("CAT_TTS_VOICE", "aura-2-helena-en")
PAD_BEFORE, PAD_AFTER = 0.5, 0.7  # seconds of quiet around each scene's narration
MOVE_SECS = 0.9  # camera move onto a control
FADE_SECS = 0.35  # cross-fade between different pictures
ZOOM = 2.6  # how far the camera zooms onto a control
SOURCE_DPI = 400

CAT_YELLOW = (255, 205, 17)
INK = (20, 20, 20)
BAR = (24, 24, 24)
TOP_BAR, BOTTOM_BAR = 54, 132
STAGE = (0, TOP_BAR, W, H - BOTTOM_BAR)  # where the picture goes


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("arialbd.ttf", "DejaVuSans-Bold.ttf") if bold else ("arial.ttf", "DejaVuSans.ttf")):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


# ---------- narration ----------


def speak(text: str) -> np.ndarray:
    """Narration as 16-bit mono samples, cached by text and voice."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"tts-{hashlib.sha1(f'{VOICE}|{text}'.encode()).hexdigest()[:16]}.wav"
    if not path.exists():
        response = httpx.post(
            "https://api.deepgram.com/v1/speak",
            params={"model": VOICE, "encoding": "linear16", "sample_rate": SAMPLE_RATE, "container": "wav"},
            headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}"},
            json={"text": text},
            timeout=60,
        )
        response.raise_for_status()
        path.write_bytes(response.content)
    with wave.open(str(path)) as wav:
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)


# ---------- pictures ----------


@dataclass
class Picture:
    image: Image.Image  # high-resolution drawing

    @property
    def size(self) -> tuple[int, int]:
        return self.image.size


_pictures: dict[str, Picture] = {}


def picture(image_id: str) -> Picture:
    if image_id not in _pictures:
        meta = get_image(image_id)
        path = CACHE / f"{image_id}@{SOURCE_DPI}.png"
        if not path.exists():
            pix = render_illustration(MANUAL.pdf, image_id, meta.page, SOURCE_DPI)
            pix.save(path)
        _pictures[image_id] = Picture(Image.open(path).convert("RGB"))
    return _pictures[image_id]


def fit_view(pic: Picture) -> tuple[float, float, float, float]:
    """The whole drawing, letterboxed into the stage: (cx, cy, width, height) in drawing pixels."""
    pw, ph = pic.size
    sw, sh = STAGE[2] - STAGE[0], STAGE[3] - STAGE[1]
    scale = min(sw / pw, sh / ph) * 0.94
    return pw / 2, ph / 2, sw / scale, sh / scale


def focus_view(pic: Picture, target: list[float]) -> tuple[float, float, float, float]:
    cx, cy, vw, vh = fit_view(pic)
    vw, vh = vw / ZOOM, vh / ZOOM
    pw, ph = pic.size
    tx, ty = target[0] * pw, target[1] * ph
    # Keep the view inside the drawing where possible.
    x = min(max(tx, vw / 2), pw - vw / 2) if vw < pw else pw / 2
    y = min(max(ty, vh / 2), ph - vh / 2) if vh < ph else ph / 2
    return x, y, vw, vh


def ease(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def lerp_view(a, b, t):
    # Interpolate the zoom geometrically so it feels even.
    k = ease(t)
    cx = a[0] + (b[0] - a[0]) * k
    cy = a[1] + (b[1] - a[1]) * k
    vw = a[2] * (b[2] / a[2]) ** k
    vh = a[3] * (b[3] / a[3]) ** k
    return cx, cy, vw, vh


def render_view(pic: Picture, view) -> tuple[Image.Image, callable]:
    """The stage showing `view` of the drawing, and a function mapping drawing px -> frame px."""
    cx, cy, vw, vh = view
    sx0, sy0, sx1, sy1 = STAGE
    sw, sh = sx1 - sx0, sy1 - sy0
    box = (cx - vw / 2, cy - vh / 2, cx + vw / 2, cy + vh / 2)
    stage = _crop_scaled(pic.image, box, sw, sh)

    def to_frame(x: float, y: float) -> tuple[float, float]:
        return sx0 + (x - box[0]) / vw * sw, sy0 + (y - box[1]) / vh * sh

    return stage, to_frame


def _crop_scaled(image: Image.Image, box, w: int, h: int) -> Image.Image:
    # Areas outside the drawing are white paper.
    return image.transform((w, h), Image.EXTENT, box, resample=Image.BICUBIC, fillcolor=(255, 255, 255))


# ---------- frame drawing ----------


def wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + ([line] if line else [])


FONT_TOP = _font(22, bold=True)
FONT_CAPTION = _font(30, bold=True)
FONT_SUB = _font(24)
FONT_TITLE = _font(58, bold=True)
FONT_SUBTITLE = _font(28)
FONT_BADGE = _font(26, bold=True)


def chrome(frame: Image.Image, video_title: str, caption: str, subtitle: str) -> None:
    d = ImageDraw.Draw(frame)
    d.rectangle((0, 0, W, TOP_BAR), fill=BAR)
    d.rectangle((0, TOP_BAR - 4, W, TOP_BAR), fill=CAT_YELLOW)
    d.text((24, TOP_BAR / 2 - 2), "CAT 320D", font=FONT_TOP, fill=CAT_YELLOW, anchor="lm")
    d.text((140, TOP_BAR / 2 - 2), video_title, font=FONT_TOP, fill=(235, 235, 235), anchor="lm")
    d.text((W - 24, TOP_BAR / 2 - 2), "Source: Operation & Maintenance Manual SEBU8053-20", font=_font(16), fill=(170, 170, 170), anchor="rm")

    y0 = H - BOTTOM_BAR
    d.rectangle((0, y0, W, H), fill=BAR)
    d.rectangle((0, y0, 10, H), fill=CAT_YELLOW)
    d.text((32, y0 + 16), caption, font=FONT_CAPTION, fill=CAT_YELLOW)
    for i, line in enumerate(wrap(d, subtitle, FONT_SUB, W - 64)[:3]):
        d.text((32, y0 + 58 + i * 28), line, font=FONT_SUB, fill=(240, 240, 240))


def ring(frame: Image.Image, x: float, y: float, radius: float, label: str, pulse: float) -> None:
    d = ImageDraw.Draw(frame, "RGBA")
    r = radius * (1 + 0.08 * math.sin(pulse * 2 * math.pi))
    for width, color in ((12, (0, 0, 0, 90)), (7, CAT_YELLOW + (255,))):
        d.ellipse((x - r, y - r, x + r, y + r), outline=color, width=width)
    # Number badge at the ring's upper right.
    bx, by = x + r * 0.75, y - r * 0.75
    d.ellipse((bx - 20, by - 20, bx + 20, by + 20), fill=CAT_YELLOW + (255,), outline=(0, 0, 0, 255), width=2)
    d.text((bx, by + 1), label, font=FONT_BADGE if len(label) < 3 else _font(20, bold=True), fill=INK, anchor="mm")


def title_card(title: str, subtitle: str) -> Image.Image:
    frame = Image.new("RGB", (W, H), BAR)
    d = ImageDraw.Draw(frame)
    d.rectangle((0, H // 2 + 70, W, H // 2 + 76), fill=CAT_YELLOW)
    d.text((W / 2, H / 2 - 30), title, font=FONT_TITLE, fill=CAT_YELLOW, anchor="mm")
    for i, line in enumerate(wrap(d, subtitle, FONT_SUBTITLE, W - 200)):
        d.text((W / 2, H / 2 + 30 + i * 34), line, font=FONT_SUBTITLE, fill=(235, 235, 235), anchor="mm")
    return frame


# ---------- a picture's own numbered legend ----------

_LEGEND_ITEM = re.compile(r"\s*\((\w{1,3})\) ([A-Z][^()\[]*?)(?=\s*\(\w{1,3}\) [A-Z]|\s+\d+\.\s|\s*\[image|$)")


@cache
def _manual_text() -> str:
    return " ".join(c.text for c in parse_manual(MANUAL.pdf, MANUAL.key))


def picture_legend(image_id: str) -> dict[str, str]:
    """Step pictures number their own parts: "[image g00682776] (1) Engine start switch (2) Engine speed dial"."""
    text = _manual_text()
    at = text.find(f"[image {image_id}]")
    if at < 0:
        return {}
    rest, legend = text[at + len(f"[image {image_id}]") :], {}
    while match := _LEGEND_ITEM.match(rest):
        legend[match.group(1)] = match.group(2).strip()
        rest = rest[match.end() :]
    return legend


# ---------- the video ----------


@dataclass
class Shot:
    scene: dict
    start: float
    duration: float
    audio: np.ndarray


def plan(script: dict) -> list[Shot]:
    shots, t = [], 0.0
    for scene in script["scenes"]:
        audio = speak(scene["narration"])
        duration = PAD_BEFORE + len(audio) / SAMPLE_RATE + PAD_AFTER
        if scene.get("focus"):
            duration += MOVE_SECS * 0.5
        shots.append(Shot(scene, t, duration, audio))
        t += duration
    return shots


def soundtrack(shots: list[Shot], total: float) -> np.ndarray:
    track = np.zeros(int(math.ceil(total * SAMPLE_RATE)) + SAMPLE_RATE, dtype=np.int16)
    for shot in shots:
        offset = int((shot.start + PAD_BEFORE + (MOVE_SECS * 0.5 if shot.scene.get("focus") else 0)) * SAMPLE_RATE)
        track[offset : offset + len(shot.audio)] = shot.audio
    return track


def scene_view(scene: dict):
    pic = picture(scene["image"])
    if scene.get("focus"):
        return focus_view(pic, catalogue()[scene["focus"]].target)
    return fit_view(pic)


def draw_scene(shot: Shot, t: float, previous_view, script_title: str) -> tuple[Image.Image, list[dict]]:
    """Frame at time t (seconds into the shot), plus the on-screen control boxes (0-1, frame coords)."""
    scene = shot.scene
    if scene["kind"] == "title":
        return title_card(scene["title"], scene["subtitle"]), []

    pic = picture(scene["image"])
    target_view = scene_view(scene)
    if scene["kind"] == "picture":
        # Slow push-in on step pictures.
        cx, cy, vw, vh = target_view
        k = 1 - 0.06 * ease(t / shot.duration)
        view = (cx, cy, vw * k, vh * k)
    elif previous_view is not None and scene.get("image") == shot.scene.get("_previous_image"):
        view = lerp_view(previous_view, target_view, t / MOVE_SECS)
    else:
        view = target_view

    frame = Image.new("RGB", (W, H), (255, 255, 255))
    stage, to_frame = render_view(pic, view)
    frame.paste(stage, (STAGE[0], STAGE[1]))
    visible = []
    pw, ph = pic.size
    for callout in scene.get("controls", []):
        control = catalogue()[callout]
        if control.drawing != scene["image"]:
            continue  # a step picture: the control is named, not drawn on
        x, y = to_frame(control.target[0] * pw, control.target[1] * ph)
        radius = 46 if scene.get("focus") else 30
        if t > MOVE_SECS * 0.6 or scene["kind"] != "drawing":
            ring(frame, x, y, radius, callout, t / 1.4)
        visible.append({"callout": callout, "box": [round((x - radius) / W, 3), round((y - radius) / H, 3), round(2 * radius / W, 3), round(2 * radius / H, 3)]})
    chrome(frame, script_title, scene["caption"], scene["narration"])
    return frame, visible


def visible_callouts(scene: dict, view, pic: Picture, to_frame) -> list[dict]:
    """Every numbered control of an overview drawing that is inside the frame (for "what's number 7?")."""
    found = []
    pw, ph = pic.size
    for control in catalogue().values():
        if control.drawing != scene.get("image"):
            continue
        x, y = to_frame(control.target[0] * pw, control.target[1] * ph)
        if STAGE[0] <= x <= STAGE[2] and STAGE[1] <= y <= STAGE[3]:
            found.append({"callout": control.callout, "at": [round(x / W, 3), round(y / H, 3)]})
    return found


def build(video_id: str) -> None:
    script = json.loads((SCRIPTS / f"{video_id}.json").read_text(encoding="utf-8"))
    t0 = time.perf_counter()
    shots = plan(script)
    total = shots[-1].start + shots[-1].duration
    print(f"{video_id}: {len(shots)} scenes, {total:.1f}s (narration ready in {time.perf_counter() - t0:.1f}s)")

    out_dir = VIDEOS / video_id
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_path = CACHE / f"{video_id}.wav"
    with wave.open(str(audio_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(soundtrack(shots, total).tobytes())

    mp4 = VIDEOS / f"{video_id}.mp4"
    writer = imageio_ffmpeg.write_frames(
        str(mp4),
        (W, H),
        fps=FPS,
        codec="libx264",
        quality=None,
        bitrate=None,
        pix_fmt_out="yuv420p",
        output_params=["-crf", "23", "-preset", "medium", "-movflags", "+faststart", "-shortest"],
        audio_path=str(audio_path),
        audio_codec="aac",
        macro_block_size=8,
    )
    writer.send(None)

    segments = []
    previous_view, previous_image, last_frame = None, None, None
    for i, shot in enumerate(shots):
        scene = shot.scene
        scene["_previous_image"] = previous_image
        n = int(round(shot.duration * FPS))
        visible, in_view = [], []
        for f in range(n):
            t = f / FPS
            frame, visible = draw_scene(shot, t, previous_view, script["title"])
            # Cross-fade from the previous shot when the picture changes.
            if last_frame is not None and f < FADE_SECS * FPS and scene.get("image") != previous_image:
                frame = Image.blend(last_frame, frame, (f + 1) / (FADE_SECS * FPS))
            writer.send(np.asarray(frame).tobytes())
            if f == 0 and i == 0:
                frame.save(out_dir / "poster.jpg", quality=85)
        # The frame the operator most likely pauses on: the settled view.
        if scene["kind"] != "title":
            pic = picture(scene["image"])
            view = scene_view(scene)
            _, to_frame = render_view(pic, view)
            in_view = visible_callouts(scene, view, pic, to_frame)
            frame.save(out_dir / f"frame-{i:02d}.jpg", quality=80)
        last_frame = frame
        previous_view = scene_view(scene) if scene["kind"] != "title" else None
        previous_image = scene.get("image")

        controls = []
        for callout in scene.get("controls", []):
            c = catalogue()[callout]
            box = next((v["box"] for v in visible if v["callout"] == callout), None)
            controls.append(
                {"callout": callout, "name": c.name, "looks_like": c.looks_like, "manual_title": c.title,
                 "page": c.page, "highlighted": box is not None, "box": box}
            )
        segments.append(
            {
                "start": round(shot.start, 2),
                "end": round(shot.start + shot.duration, 2),
                "kind": scene["kind"],
                "caption": scene.get("caption") or scene.get("title"),
                "transcript": scene["narration"],
                "image": scene.get("image"),
                "frame": f"frame-{i:02d}.jpg" if scene["kind"] != "title" else None,
                "controls": controls,
                # Other numbered controls visible in the frame (overview drawings only).
                "also_in_view": [v for v in in_view if v["callout"] not in scene.get("controls", [])],
                # Numbers drawn on a step picture mean the picture's own parts, not the cab callouts.
                "picture_legend": picture_legend(scene["image"]) if scene["kind"] == "picture" else {},
                "manual": scene.get("manual", []),
            }
        )
        print(f"  {shot.start:6.1f}s  {segments[-1]['caption']}")
    writer.close()

    index = {
        "video_id": video_id,
        "title": script["title"],
        "source": "generated from the Cat 320D Operation and Maintenance Manual (SEBU8053-20)",
        "duration": round(total, 2),
        "width": W,
        "height": H,
        "url": f"/videos/{video_id}.mp4",
        "subtitles": f"/videos/{video_id}.vtt",
        "poster": f"/videos/{video_id}/poster.jpg",
        "segments": segments,
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    (VIDEOS / f"{video_id}.vtt").write_text(vtt(segments), encoding="utf-8")
    size = mp4.stat().st_size / 1e6
    print(f"-> {mp4.relative_to(ROOT)} ({size:.1f} MB, {total:.0f}s) in {time.perf_counter() - t0:.0f}s")


def vtt(segments: list[dict]) -> str:
    def ts(s: float) -> str:
        return f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{s % 60:06.3f}"

    cues = [f"{ts(s['start'])} --> {ts(s['end'])}\n{s['transcript']}" for s in segments]
    return "WEBVTT\n\n" + "\n\n".join(cues) + "\n"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for video in sys.argv[1:] or ["controls-tour", "start-to-finish"]:
        build(video)
