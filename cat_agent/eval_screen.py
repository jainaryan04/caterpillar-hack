"""Check "what does this do?" answers about paused videos and photos: accuracy and speed.

    uv run eval_screen.py          # all cases
    uv run eval_screen.py -v       # also print what Cat saw

Each case pauses a video at a second (optionally tapping a control) or sends a
photo, asks a question in an operator's words, and checks the spoken answer
names the right thing. Photos are simulated phone shots of the manual's
control drawings (perspective, rotation, blur, noise, JPEG), since the 320D
cab itself isn't here; real cab photos can be added as references.

Timing is from the end of the question to the answer text, as in the app: the
pause (or photo) happens first and saying "Hey Cat, what does this do?" takes
a couple of seconds, so each case waits PAUSE_TO_QUESTION_SECS in between,
while real footage's manual search runs.
"""

import asyncio
import statistics
import sys
import time

import cv2
import numpy as np

import cat  # noqa: F401  (loads .env)
from cat.photo_match import match_photo, warm
from cat.rag import sections
from cat.rag.images import IMAGES_DIR
from cat.rag.store import get_store
from cat.screen import LOCAL_SESSION, get_screen_store, view_from_photo, view_from_video
from cat.tools.screen import answer_about_screen
from cat.video_index import get_video

# (video, second, question, tap on callout, words the answer must contain (any))
VIDEO_CASES = [
    ("controls-tour", 190, "What does this button do?", None, ["alarm"]),
    ("controls-tour", 207, "What's this one for?", None, ["heavy lift"]),
    ("controls-tour", 95, "What does this dial do?", None, ["engine speed", "rpm"]),
    ("controls-tour", 12, "What's number 2 here?", None, ["lockout"]),
    ("controls-tour", 158, "What does the switch with the rabbit and turtle do?", None, ["travel speed", "low speed"]),
    ("controls-tour", 158, "What's this one?", "21", ["coupler"]),
    ("controls-tour", 305, "Can I use this on a slope?", None, ["slope"]),
    ("start-to-finish", 55, "What does knob number 2 do?", None, ["engine speed", "speed dial"]),
    ("start-to-finish", 20, "How do I do this?", None, ["belt", "buckle"]),
    ("start-to-finish", 42, "Why do I need to do this?", None, ["lock", "start"]),
    ("start-to-finish", 78, "Where is this switch?", None, ["seat"]),
    ("cat-320d-overview", 452, "What does this red button do?", None, ["engine stop", "stop the engine", "stop control"]),
    ("cat-320d-overview", 360, "What do these do?", None, ["joystick", "work tool"]),
    ("cat-320d-overview", 442, "What is this lever for?", None, ["lock"]),
    ("cat-320d-overview", 457, "How do I get out of here in an emergency?", None, ["exit", "window"]),
]

PAUSE_TO_QUESTION_SECS = 2.0
rng = np.random.default_rng(0)


def fake_photo(image_id: str, crop, angle=8.0, persp=0.08) -> bytes:
    """A phone-like shot of part of a manual drawing: tilt, rotation, blur, noise, JPEG."""
    img = cv2.imread(str(IMAGES_DIR / f"{image_id}.png"))
    h, w = img.shape[:2]
    x0, y0, x1, y1 = (int(v * s) for v, s in zip(crop, (w, h, w, h)))
    img = img[y0:y1, x0:x1]
    h, w = img.shape[:2]
    img = (img.astype(np.float32) * np.array([0.85, 0.9, 1.0])).clip(0, 255).astype(np.uint8)
    d = persp * w
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[d, d * 0.5], [w - d * 0.3, 0], [w, h - d * 0.2], [d * 0.6, h]])
    img = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=(90, 90, 90))
    img = cv2.warpAffine(img, cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0), (w, h), borderValue=(90, 90, 90))
    img = cv2.GaussianBlur(cv2.resize(img, (1600, int(1600 * h / w))), (7, 7), 0)
    img = (255 * (img / 255.0) ** 0.8 + rng.normal(0, 10, img.shape)).clip(0, 255).astype(np.uint8)
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])[1].tobytes()


# (description, drawing, crop, tap (0-1 in the photo), question, words the answer must contain)
PHOTO_CASES = [
    ("switch panel, left group", "g03666599", (0.0, 0.15, 0.30, 0.85), None, "What does this button do?", ["alarm"]),
    ("whole switch panel, tapped", "g03666599", (0, 0, 1, 1), (0.30, 0.47), "What's this one?", ["coupler"]),
    ("cab, right console", "g03654245", (0.40, 0.15, 0.85, 0.55), None, "What is this?", ["start", "key"]),
    ("not a control picture", "g00867598", (0, 0, 1, 1), None, "What does this button do?", ["can't tell", "cannot tell", "can't see", "name it", "tap it", "not sure", "which button", "which control", "label"]),
]


# Real photos of a 320D-series right console (frames of Caterpillar's video at a
# different moment and camera angle than the reference photo). Skipped if absent.
REAL_PHOTO = "data/test_photos/cat-video-342.jpg"
REAL_PHOTO_CASES = [
    ("real photo, tapped travel alarm switch", (0.28, 0.33), "What does this button do?", ["alarm"]),
    ("real photo, tapped wiper switch", (0.21, 0.43), "What's this one?", ["wiper"]),
    ("real photo, asked by icon", None, "What does the switch with the hook do?", ["heavy lift"]),
]


def tap_for(video, t: float, callout: str) -> tuple[float, float] | None:
    segment = video.segment_at(t)
    for entry in segment.get("also_in_view", []):
        if entry["callout"] == callout:
            return tuple(entry["at"])
    return None


async def run_case(view, question: str, expect: list[str], label: str, t_view: float, verbose: bool):
    get_screen_store().set(LOCAL_SESSION, view)
    view.prefetch()
    await asyncio.sleep(PAUSE_TO_QUESTION_SECS)
    t0 = time.perf_counter()
    answer, _ = await answer_about_screen(question)
    ms = 1000 * (time.perf_counter() - t0)
    ok = any(word in answer.text.lower() for word in expect)
    print(f"{'OK ' if ok else 'BAD'} {label:44} {t_view:5.0f}ms + {ms:5.0f}ms  Q: {question}")
    print(f"      A: {answer.text}")
    if verbose or not ok:
        print("      SAW: " + view.describe().replace("\n", "\n           "))
    return ok, ms, t_view


async def main(verbose: bool):
    sections.warm()
    warm()
    await get_store().warm_up()  # as Cat does at startup
    results = []
    for video_id, t, question, tap_callout, expect in VIDEO_CASES:
        video = get_video(video_id)
        if video is None:
            print(f"SKIP {video_id} (not built)")
            continue
        t0 = time.perf_counter()
        tap = tap_for(video, t, tap_callout) if tap_callout else None
        view = view_from_video(video, t, tap)
        t_view = 1000 * (time.perf_counter() - t0)
        label = f"{video_id} @{t}s" + (f" tap {tap_callout}" if tap_callout else "")
        results.append(("video",) + await run_case(view, question, expect, label, t_view, verbose))
    for description, drawing, crop, tap, question, expect in PHOTO_CASES:
        data = fake_photo(drawing, crop)
        t0 = time.perf_counter()
        view = view_from_photo(await asyncio.to_thread(match_photo, data), tap)
        t_view = 1000 * (time.perf_counter() - t0)
        results.append(("photo",) + await run_case(view, question, expect, f"photo: {description}", t_view, verbose))

    from pathlib import Path

    if Path(REAL_PHOTO).exists():
        data = Path(REAL_PHOTO).read_bytes()
        for description, tap, question, expect in REAL_PHOTO_CASES:
            t0 = time.perf_counter()
            view = view_from_photo(await asyncio.to_thread(match_photo, data), tap)
            t_view = 1000 * (time.perf_counter() - t0)
            results.append(("photo",) + await run_case(view, question, expect, description, t_view, verbose))

    for kind in ("video", "photo"):
        rows = [r for r in results if r[0] == kind]
        if not rows:
            continue
        answers = sorted(r[2] for r in rows)
        p90 = answers[min(len(answers) - 1, int(0.9 * len(answers)))]
        print(
            f"\n{kind}: {sum(r[1] for r in rows)}/{len(rows)} correct; "
            f"{'pause lookup' if kind == 'video' else 'photo match'} median {statistics.median(r[3] for r in rows):.0f}ms; "
            f"answer median {statistics.median(answers):.0f}ms, p90 {p90:.0f}ms"
        )


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main("-v" in sys.argv))
