"""What is on screen at any second of each training video.

Every video in data/videos/ has an index.json written when the video was made
(video_build/build_video.py, exact) or indexed (video_build/index_video.py, for
existing footage). A pause is a binary search over segment start times: no
model call, microseconds, and the same for one operator or ten thousand.
Adding a video = dropping its files in data/videos/; no code change.
"""

import bisect
import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

VIDEOS_DIR = Path(__file__).resolve().parents[1] / "data" / "videos"


@dataclass(frozen=True)
class Video:
    id: str
    title: str
    duration: float
    url: str
    poster: str | None
    subtitles: str | None
    source: str
    segments: list[dict]
    _starts: list[float]

    def segment_at(self, t: float) -> dict | None:
        i = bisect.bisect_right(self._starts, t) - 1
        if i < 0:
            return None
        return self.segments[min(i, len(self.segments) - 1)]

    def summary(self) -> dict:
        return {
            "video_id": self.id,
            "title": self.title,
            "duration": self.duration,
            "url": self.url,
            "poster": self.poster,
            "subtitles": self.subtitles,
            "source": self.source,
        }


def _load(path: Path) -> Video:
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = sorted(data["segments"], key=lambda s: s["start"])
    return Video(
        id=data["video_id"],
        title=data["title"],
        duration=data["duration"],
        url=data["url"],
        poster=data.get("poster"),
        subtitles=data.get("subtitles"),
        source=data.get("source", ""),
        segments=segments,
        _starts=[s["start"] for s in segments],
    )


@cache
def videos() -> dict[str, Video]:
    """All indexed videos whose file is present."""
    found = {}
    for index in sorted(VIDEOS_DIR.glob("*/index.json")):
        video = _load(index)
        if (VIDEOS_DIR / f"{video.id}.mp4").exists():
            found[video.id] = video
    return found


def get_video(video_id: str) -> Video | None:
    return videos().get(video_id)
