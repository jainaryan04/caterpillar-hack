"""Ask about a paused video frame or a photo from the terminal (no mic, no app).

    uv run ask_screen.py --video controls-tour --t 95 "what does this button do?"
    uv run ask_screen.py --video controls-tour --t 95 --tap 0.3 0.5 "what's this one?"
    uv run ask_screen.py --photo cab.jpg "what does the red button do?"

Prints what Cat sees, the answer, and the time each step took.
"""

import argparse
import asyncio
import sys
import time

import cat  # noqa: F401  (loads .env)
from cat.photo_match import match_photo, warm
from cat.rag import sections
from cat.screen import LOCAL_SESSION, get_screen_store, view_from_photo, view_from_video
from cat.tools.screen import answer_about_screen
from cat.video_index import get_video, videos


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("question")
    parser.add_argument("--video", help=f"one of: {', '.join(videos())}")
    parser.add_argument("--t", type=float, default=0.0, help="seconds into the video")
    parser.add_argument("--photo", help="path to a photo")
    parser.add_argument("--tap", type=float, nargs=2, metavar=("X", "Y"), help="where the operator tapped, 0-1")
    args = parser.parse_args()

    sections.warm()
    t0 = time.perf_counter()
    if args.video:
        video = get_video(args.video)
        if video is None:
            sys.exit(f"No video {args.video!r}. Have: {', '.join(videos())}")
        view = view_from_video(video, args.t, tuple(args.tap) if args.tap else None)
    elif args.photo:
        warm()
        t0 = time.perf_counter()
        with open(args.photo, "rb") as f:
            view = view_from_photo(match_photo(f.read()), tuple(args.tap) if args.tap else None)
    else:
        sys.exit("Give --video and --t, or --photo.")
    t_view = time.perf_counter()
    get_screen_store().set(LOCAL_SESSION, view)

    print("CAT SEES:\n  " + view.describe().replace("\n", "\n  "))
    answer, _ = await answer_about_screen(args.question)
    t_answer = time.perf_counter()
    print(f"\nQ: {args.question}\nA: {answer.text}")
    print(f"   manual pages {answer.page}-{answer.page_end} ({answer.topic}); picture: {answer.image.id if answer.image else '-'}")
    print(f"\n{'photo match' if args.photo else 'video lookup'} {1000 * (t_view - t0):.0f}ms, answer {1000 * (t_answer - t_view):.0f}ms")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
