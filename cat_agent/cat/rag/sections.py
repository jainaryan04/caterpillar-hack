"""Manual sections by title, straight from the local PDF (no search, no network).

When Cat already knows *which* part of the manual is on the operator's screen
(a paused video's segment, a matched photo), there is nothing to search for:
the passages are looked up by their section title in ~0ms. Hybrid search in
Pinecone (store.py) is only needed when the question itself has to be matched.

The parsed chunks are cached in data/manuals/chunks.json (git-ignored) so this
costs nothing at startup after the first run.
"""

import json
from functools import cache

from cat.rag.parse import parse_manual
from cat.rag.store import MANUAL, MANUALS_DIR, Passage

CHUNKS_PATH = MANUALS_DIR / "chunks.json"


@cache
def _sections() -> dict[str, list[Passage]]:
    if CHUNKS_PATH.exists() and CHUNKS_PATH.stat().st_mtime >= MANUAL.pdf.stat().st_mtime:
        rows = json.loads(CHUNKS_PATH.read_text(encoding="utf-8"))
    else:
        rows = [
            {"title": c.title, "page": c.page, "page_end": c.page_end, "text": c.text, "illustrations": c.illustrations}
            for c in parse_manual(MANUAL.pdf, MANUAL.key)
        ]
        CHUNKS_PATH.write_text(json.dumps(rows), encoding="utf-8")
    sections: dict[str, list[Passage]] = {}
    for row in rows:
        sections.setdefault(row["title"], []).append(Passage(score=1.0, **row))
    return sections


def section(title: str) -> list[Passage]:
    """All passages of one manual section, e.g. "Operation Section > Operator Controls > Radio (11)"."""
    return _sections().get(title, [])


def sections(titles: list[str], limit: int = 6) -> list[Passage]:
    """Passages for several sections, in order, without duplicates."""
    found, seen = [], set()
    for title in titles:
        for passage in section(title):
            key = (passage.title, passage.page, passage.text[:40])
            if key not in seen:
                seen.add(key)
                found.append(passage)
    return found[:limit]


def warm() -> None:
    _sections()
