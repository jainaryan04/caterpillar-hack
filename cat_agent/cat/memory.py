"""What Cat has looked up in the manual during this session.

The conversation itself is already remembered (it's the LLM context). This
keeps the details the spoken answer leaves out - exact page range, topic,
picture - so "open it" or "show me the seat belt page again" can put the right
pages on screen without searching again.

Process-wide, like the manual store: one operator per Cat process.
"""

from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class ManualLookup:
    question: str
    answer: str  # what Cat said
    topic: str  # the manual section the answer came from, e.g. "Seat Belt"
    page: int
    page_end: int
    image_id: str | None


class ManualMemory:
    def __init__(self, size: int = 20):
        self._lookups: deque[ManualLookup] = deque(maxlen=size)

    def remember(self, lookup: ManualLookup) -> None:
        self._lookups.append(lookup)

    def last(self) -> ManualLookup | None:
        return self._lookups[-1] if self._lookups else None

    def on_page(self, page: int) -> ManualLookup | None:
        """The most recent lookup covering this page."""
        return next((lu for lu in reversed(self._lookups) if lu.page <= page <= lu.page_end), None)


_memory = ManualMemory()


def get_manual_memory() -> ManualMemory:
    return _memory
