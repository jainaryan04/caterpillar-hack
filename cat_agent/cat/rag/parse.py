"""Turn a Cat Operation and Maintenance Manual PDF into searchable chunks.

Cat manuals are generated from SIS with a fixed style, so the structure can be
read from font sizes instead of guessing from text:

    15.9pt bold  topic title        e.g. "Operator Controls"
    13.9pt bold  subheading         e.g. "Hydraulic Lockout Control (2)"  <- one control
    7pt          "Illustration 83" / "g03666599" (illustration id) / "i05782287" (topic id)
    top 62pt     running header     section name + topic name

Each (topic, subheading) becomes a chunk, so every button or switch gets its own
chunk. Long sections are split into overlapping windows.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

HEADER_BOTTOM = 62  # y coordinate; everything above is the running header
COLUMN_SPLIT = 300  # x coordinate between the left and right text columns
MAX_WORDS = 320
OVERLAP_WORDS = 50

_TOPIC_ID = re.compile(r"^i\d{8}$")
_ILLUSTRATION_ID = re.compile(r"^g\d{8}$")
_ILLUSTRATION_LABEL = re.compile(r"^(Illustration|Table) \d+$")
# Where a picture sits in the text, e.g. "[image g00867598]", so the agent can
# tell which picture goes with which instructions.
IMAGE_MARKER = re.compile(r" ?\[image (g\d{8})\]")
# Overview drawings number their parts with a legend under the picture:
# "(15) Travel Alarm Cancel Switch". The control's own section is then headed
# "Travel Alarm Cancel Switch (15)" and often has no picture of its own.
_LEGEND_ENTRY = re.compile(r"^\((\d+[a-z]?)\) ")
_HEADING_CALLOUT = re.compile(r"\((\d+[a-z]?)(?:\s*-\s*\d+[a-z]?)?\)")


@dataclass
class Chunk:
    id: str
    section: str
    topic: str
    subheading: str
    page: int
    page_end: int
    text: str
    illustrations: list[str] = field(default_factory=list)

    @property
    def title(self) -> str:
        return " > ".join(p for p in (self.section, self.topic, self.subheading) if p)

    def embedding_text(self, doc_title: str) -> str:
        # The breadcrumb helps both embeddings and BM25 ("Operator Controls" etc.).
        # Picture markers are for the agent, not for search.
        return f"{doc_title} | {self.title}\n{IMAGE_MARKER.sub('', self.text)}"


@dataclass
class _Line:
    page: int
    column: int
    y: float
    size: float
    bold: bool
    text: str


def _page_lines(doc: pymupdf.Document, pno: int) -> tuple[list[_Line], str]:
    """Lines on a page in reading order (left column, then right), plus the section name."""
    lines, header = [], []
    raw = [
        ("".join(s["text"] for s in line["spans"]).strip(), line)
        for block in doc[pno].get_text("dict")["blocks"]
        for line in block.get("lines", [])
    ]
    labels = [line["bbox"] for text, line in raw if _ILLUSTRATION_LABEL.match(text)]
    for text, line in raw:
        if not text:
            continue
        x0, y0 = line["bbox"][0], line["bbox"][1]
        if _ILLUSTRATION_ID.match(text):
            # The id is printed at the caption's right edge, so a full-width
            # picture's id would land in the right column. Use the
            # "Illustration N" label on the same row to pick the column.
            row = [b[0] for b in labels if abs(b[1] - y0) < 3 and b[0] < x0]
            x0 = max(row, default=x0)
        if y0 < HEADER_BOTTOM:
            header.append((y0, text))
            continue
        span = line["spans"][0]
        lines.append(
            _Line(
                page=pno + 1,
                column=0 if x0 < COLUMN_SPLIT else 1,
                y=y0,
                size=round(span["size"], 1),
                bold="Bold" in span["font"],
                text=text,
            )
        )
    lines.sort(key=lambda l: (l.column, l.y))
    section = next((t for _, t in sorted(header) if t.endswith("Section")), "")
    return lines, section


def _windows(words: list[str]) -> list[str]:
    if len(words) <= MAX_WORDS:
        return [" ".join(words)]
    step = MAX_WORDS - OVERLAP_WORDS
    return [" ".join(words[i : i + MAX_WORDS]) for i in range(0, len(words) - OVERLAP_WORDS, step)]


def parse_manual(pdf_path: Path, doc_key: str) -> list[Chunk]:
    doc = pymupdf.open(pdf_path)
    chunks: list[Chunk] = []

    section = topic = subheading = ""
    body: list[str] = []
    start_page = end_page = 1
    last_heading: tuple[int, int, float] | None = None  # to merge headings that wrap
    last_image = ""  # most recent picture in the current topic
    legend: dict[str, str] = {}  # callout number -> overview picture, for the current topic

    def add_callout_picture():
        # "Travel Alarm Cancel Switch (15)" -> point at the drawing whose legend lists (15).
        match = _HEADING_CALLOUT.search(subheading)
        if match and match.group(1) in legend:
            body.append(f"Shown as callout ({match.group(1)}) in [image {legend[match.group(1)]}].")

    def flush():
        nonlocal body
        words = " ".join(body).split()
        if len(words) >= 8:  # skip empty stubs (a heading with only a picture under it)
            for text in _windows(words):
                chunks.append(
                    Chunk(
                        id=f"{doc_key}-{len(chunks):04d}",
                        section=section,
                        topic=topic,
                        subheading=subheading,
                        page=start_page,
                        page_end=end_page,
                        text=text,
                        illustrations=IMAGE_MARKER.findall(text),
                    )
                )
        body = []

    for pno in range(doc.page_count):
        lines, page_section = _page_lines(doc, pno)
        if page_section.startswith(("Index", "Reference")) or pno < 3:
            continue  # cover, table of contents, index: navigation only
        for line in lines:
            text = line.text
            if _TOPIC_ID.match(text) or text.startswith("SMCS Code"):
                continue
            if _ILLUSTRATION_ID.match(text):
                body.append(f"[image {text}]")
                last_image = text
                continue
            if _ILLUSTRATION_LABEL.match(text):
                continue

            is_topic = line.size >= 15.5 and line.size < 17
            is_sub = line.size == 13.9 and line.bold
            if is_topic or is_sub:
                # A heading that wraps onto a second line continues the previous one.
                wrapped = last_heading is not None and last_heading[:2] == (line.page, line.column) and (
                    0 < line.y - last_heading[2] < 22
                )
                if wrapped:
                    if is_topic:
                        topic = f"{topic} {text}"
                    else:
                        body.clear()  # the callout line was added for the heading's first line
                        subheading = f"{subheading} {text}"
                        add_callout_picture()
                else:
                    flush()
                    section = page_section or section
                    if is_topic:
                        topic, subheading = text, ""
                        last_image, legend = "", {}
                    else:
                        subheading = text
                        add_callout_picture()
                    start_page = line.page
                last_heading = (line.page, line.column, line.y)
                end_page = line.page
                continue

            if line.size >= 17:  # section / group banners ("Operation Section")
                continue
            last_heading = None
            legend_entry = _LEGEND_ENTRY.match(text)
            if legend_entry and last_image:
                legend.setdefault(legend_entry.group(1), last_image)
            body.append(text)
            end_page = line.page
    flush()
    return chunks


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8")
    path = Path(sys.argv[1])
    result = parse_manual(path, "doc")
    words = [len(c.text.split()) for c in result]
    print(f"{len(result)} chunks, {sum(words)} words, avg {sum(words) // len(result)}, max {max(words)}")
    for c in result:
        if c.topic == "Operator Controls" or "--all" in sys.argv:
            print(f"p{c.page}-{c.page_end} [{c.title}] {c.text[:110]}")
