"""Render whole manual pages as PNGs, for "open it" / "show me that in the manual".

A topic that runs over two pages is rendered as one image with the pages side
by side, the way the open manual would look. Renders are cached on disk:

    data/manuals/pages/page-094.png
    data/manuals/pages/page-096-097.png
"""

from dataclasses import dataclass
from pathlib import Path

import pymupdf

from cat.rag.store import MANUAL, MANUALS_DIR

PAGES_DIR = MANUALS_DIR / "pages"
DPI = 110  # readable on a phone, ~150 KB per page
MAX_PAGES = 2  # more than a spread is too small to read on a screen


@dataclass(frozen=True)
class ManualPages:
    first: int  # page numbers as Cat says them (1 = the PDF's first page)
    last: int
    path: Path
    width: int
    height: int

    def label(self) -> str:
        return f"page {self.first}" if self.first == self.last else f"pages {self.first} and {self.last}"


def page_count() -> int:
    with pymupdf.open(MANUAL.pdf) as doc:
        return doc.page_count


def render_pages(first: int, last: int | None = None) -> ManualPages:
    """Render pages first..last (at most MAX_PAGES of them) into one PNG."""
    last = min(max(last or first, first), first + MAX_PAGES - 1)
    name = f"page-{first:03d}.png" if first == last else f"page-{first:03d}-{last:03d}.png"
    path = PAGES_DIR / name
    with pymupdf.open(MANUAL.pdf) as doc:
        last = min(last, doc.page_count)
        if not path.exists():
            PAGES_DIR.mkdir(parents=True, exist_ok=True)
            if first == last:
                pix = doc[first - 1].get_pixmap(dpi=DPI)
            else:
                # Lay the pages out side by side on one canvas, then render that.
                sizes = [doc[p - 1].rect for p in range(first, last + 1)]
                spread = pymupdf.open()
                canvas = spread.new_page(width=sum(r.width for r in sizes), height=max(r.height for r in sizes))
                x = 0.0
                for p, r in zip(range(first, last + 1), sizes):
                    canvas.show_pdf_page(pymupdf.Rect(x, 0, x + r.width, r.height), doc, p - 1)
                    x += r.width
                pix = canvas.get_pixmap(dpi=DPI)
            pix.save(path)
    pix = pymupdf.Pixmap(str(path))
    return ManualPages(first, last, path, pix.width, pix.height)
