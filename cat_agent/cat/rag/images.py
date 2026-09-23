"""Cut the manual's illustrations out as PNGs, keyed by their Cat illustration id.

Every picture in a Cat manual has a caption line under it: "Illustration 80" on
the left and its id, e.g. "g00867598", on the right. The picture itself is
usually stored as a stack of thin image strips, so instead of extracting raw
images we render the page region between the strips' top and the caption.
That also keeps any callout numbers drawn on top of the picture.

    data/manuals/images/g00867598.png
    data/manuals/images/index.json   {"g00867598": {"page": 94, "file": "g00867598.png", ...}}
"""

import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import pymupdf

_ILLUSTRATION_ID = re.compile(r"^g\d{8}$")
DPI = 150
MAX_GAP = 6  # pt between image strips that belong to the same picture
MIN_SIZE = 40  # pt; smaller images are inline icons, not illustrations


def _captions(page: pymupdf.Page) -> list[tuple[str, pymupdf.Rect]]:
    """(illustration id, caption row rect) for each picture on the page."""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line["spans"]).strip()
            lines.append((text, pymupdf.Rect(line["bbox"])))
    captions = []
    for text, rect in lines:
        if not _ILLUSTRATION_ID.match(text):
            continue
        # The row spans from "Illustration N" (left) to the id (right).
        left = [r for t, r in lines if t.startswith("Illustration ") and abs(r.y0 - rect.y0) < 3 and r.x0 < rect.x0]
        row = pymupdf.Rect(max((r.x0 for r in left), default=rect.x0), rect.y0, rect.x1, rect.y1)  # nearest label
        captions.append((text, row))
    return captions


def _picture_rect(page: pymupdf.Page, caption: pymupdf.Rect) -> pymupdf.Rect | None:
    """Union of the image blocks stacked directly above a caption row."""
    images = [
        pymupdf.Rect(b["bbox"])
        for b in page.get_text("dict")["blocks"]
        if b["type"] == 1
    ]
    # Images in the caption's column, above it.
    column = [r for r in images if r.x0 >= caption.x0 - 4 and r.x1 <= caption.x1 + 4 and r.y1 <= caption.y0 + 2]
    if not column:
        return None
    column.sort(key=lambda r: r.y1, reverse=True)
    if caption.y0 - column[0].y1 > 30:
        return None  # nothing right above the caption
    rect = pymupdf.Rect(column[0])
    for r in column[1:]:
        if rect.y0 - r.y1 > MAX_GAP:
            break
        rect |= r
    if rect.width < MIN_SIZE or rect.height < MIN_SIZE:
        return None
    return rect


def extract_illustrations(pdf_path: Path, out_dir: Path) -> dict[str, dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    index: dict[str, dict] = {}
    for pno in range(doc.page_count):
        page = doc[pno]
        for image_id, caption in _captions(page):
            rect = _picture_rect(page, caption)
            if rect is None or image_id in index:
                continue
            pix = page.get_pixmap(clip=rect + (-2, -2, 2, 2), dpi=DPI)
            file = f"{image_id}.png"
            pix.save(out_dir / file)
            index[image_id] = {"page": pno + 1, "file": file, "width": pix.width, "height": pix.height}
    (out_dir / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    return index


def render_illustration(pdf_path: Path, image_id: str, page: int, dpi: int) -> pymupdf.Pixmap | None:
    """One illustration again at another resolution (same crop, so positions in it still match)."""
    doc = pymupdf.open(pdf_path)
    pdf_page = doc[page - 1]
    for found, caption in _captions(pdf_page):
        if found == image_id:
            rect = _picture_rect(pdf_page, caption)
            return pdf_page.get_pixmap(clip=rect + (-2, -2, 2, 2), dpi=dpi) if rect else None
    return None


def load_index(out_dir: Path) -> dict[str, dict]:
    path = out_dir / "index.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


IMAGES_DIR = Path(__file__).resolve().parents[2] / "data" / "manuals" / "images"


@dataclass(frozen=True)
class ManualImage:
    id: str  # Cat illustration id, e.g. "g00867598"
    page: int
    path: Path
    width: int
    height: int


@cache
def _index() -> dict[str, dict]:
    return load_index(IMAGES_DIR)


def get_image(image_id: str | None) -> ManualImage | None:
    """The extracted picture for an illustration id, or None if there isn't one."""
    entry = _index().get(image_id or "")
    if entry is None:
        return None
    return ManualImage(image_id, entry["page"], IMAGES_DIR / entry["file"], entry["width"], entry["height"])
