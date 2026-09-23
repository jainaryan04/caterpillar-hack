"""The Cat 320D's controls: one entry per numbered control in the manual's overview drawings.

Everything that points at a control uses this catalogue: the videos (which
control is on screen), photo matching (which button was photographed) and the
manual answer (its section and page). Built once from the manual and saved to
data/manuals/controls.json:

    uv run python -m cat.controls

Each entry:
    {"callout": "15", "name": "Travel Alarm Cancel Switch", "drawing": "g03666599",
     "target": [0.159, 0.451],        # where the control is in that drawing (0-1)
     "title": "Operation Section > Operator Controls > Travel Alarm Cancel Switch (15)",
     "page": 101, "page_end": 101, "images": [], "looks_like": "..."}
"""

import json
import re
from dataclasses import asdict, dataclass, field
from functools import cache
from pathlib import Path

from cat.rag.store import MANUALS_DIR

CATALOGUE_PATH = MANUALS_DIR / "controls.json"
CALLOUTS_PATH = Path(__file__).resolve().parents[1] / "video_build" / "callouts.json"

OVERVIEW = "g03654245"  # the cab from above: callouts 1a-12
SWITCH_PANEL = "g03666599"  # the right side control panel: callouts 1a, 13-26

# What each control looks like in the drawings, for questions like "the one
# with the rabbit and turtle" or "the round dial". Written by looking at the
# drawings (manual pages 95-96); the manual text doesn't describe icons.
LOOKS_LIKE = {
    "1a": "climate control panel with a small digital display and fan and AUTO buttons, rear of the right console",
    "1b": "small climate buttons on the left console, beside the seat",
    "2": "hydraulic lockout lever on the left console, left of the seat",
    "3": "two long travel levers with foot pedals, in front of the seat",
    "4": "service hour meter on the front right pillar, near the monitor",
    "5": "monitor screen, front right of the cab",
    "6": "joystick handle on the right console (the left one mirrors it)",
    "7": "engine speed dial, round knob on the right console",
    "8": "key switch (engine start switch) on the right console",
    "9": "right side control panel: two rows of round switches plus rocker switches",
    "10": "the operator's seat",
    "11": "radio, behind the seat on the right",
    "12": "backup switches under the right console cover",
    "13": "round switch with rabbit and turtle icons, top row, first on the left",
    "14": "round switch with the AEC icon, top row, second",
    "15": "round switch with a speaker and sound waves icon, top row, third",
    "16": "round switch with a work tool (hammer) icon, top row, fourth",
    "17": "round switch with a hook (weight) and plus sign icon, bottom row, far right",
    "18": "round switch with a washer spray icon, bottom row, third",
    "19": "round switch with a wiper arc icon, bottom row, second",
    "20": "round switch with a lamp beam icon, bottom row, far left",
    "21": "rocker switch with lock icons, first in the middle panel",
    "22": "rocker switch with a wiper icon, second in the middle panel",
    "23": "rocker switch with a washer icon, third in the middle panel",
    "24": "rocker switch with a seat heater icon, fourth in the middle panel",
    "25": "rocker switch with a swing icon, fifth in the middle panel",
    "26": "rocker switch with an overload warning icon, sixth in the middle panel",
}

# The end of the switch panel's legend (page 96, right column) is read into a
# neighbouring section by the parser, so it can't be found under the drawing.
LEGEND_TAIL = {
    "23": "Lower Window Washer",
    "24": "Seat Heater",
    "25": "Fine Swing Control",
    "26": "Overload Warning Device",
}

# "(15) Travel Alarm Cancel Switch" in the legend under an overview drawing.
_LEGEND = re.compile(r"\((\d+[a-z]?)\) (.+?)(?=\s\(\d+[a-z]?\)\s|\s\[image|$)")
_HEADING_CALLOUTS = re.compile(r"\((\d+)([a-z]?)(?:\s*-\s*(\d+)([a-z]?))?\)")


@dataclass
class Control:
    callout: str
    name: str
    drawing: str
    target: list[float]
    title: str = ""
    page: int = 0
    page_end: int = 0
    images: list[str] = field(default_factory=list)
    looks_like: str = ""

    def describe(self) -> str:
        """One line for a prompt."""
        return f"({self.callout}) {self.name} - {self.looks_like}; manual {self.title.split(' > ')[-1]}, page {self.page}"


def _heading_callouts(subheading: str) -> list[str]:
    """ "Upper Window Wiper and Window Washer (18-19)" -> ["18", "19"]."""
    match = _HEADING_CALLOUTS.search(subheading)
    if not match:
        return []
    first, suffix, last, last_suffix = match.groups()
    if not last:
        return [first + suffix]
    if suffix or last_suffix:  # "(1a - 1b)"
        return [first + suffix, last + last_suffix]
    return [str(n) for n in range(int(first), int(last) + 1)]


def build() -> list[Control]:
    from cat.rag.parse import parse_manual
    from cat.rag.store import MANUAL

    chunks = [c for c in parse_manual(MANUAL.pdf, MANUAL.key) if c.topic == "Operator Controls"]
    callouts = json.loads(CALLOUTS_PATH.read_text())

    # Names from the legends under the two drawings.
    # The topic's intro can be split over overlapping windows; join them.
    intro = [c for c in chunks if not c.subheading]
    overview = intro[0]
    text = " ".join(c.text for c in intro)
    legend_text = {
        OVERVIEW: text.split(f"[image {SWITCH_PANEL}]")[0],
        SWITCH_PANEL: text.split(f"[image {SWITCH_PANEL}]")[1],
    }
    controls: dict[str, Control] = {}
    for drawing, text in legend_text.items():
        for number, name in _LEGEND.findall(text):
            if number in controls or number not in callouts[drawing]:
                continue  # 1a is in both drawings; keep the cab overview
            name = re.sub(r"\s*\((Early|Later) type and location\)", "", name).strip()
            controls[number] = Control(number, name, drawing, callouts[drawing][number]["target"])
    for number, name in LEGEND_TAIL.items():
        controls.setdefault(number, Control(number, name, SWITCH_PANEL, callouts[SWITCH_PANEL][number]["target"]))

    # Section and pages from each control's own chunk ("Travel Alarm Cancel Switch (15)").
    for chunk in chunks:
        for number in _heading_callouts(chunk.subheading):
            control = controls.get(number) or controls.get(number + "a")
            if control and not control.title:
                control.title, control.page, control.page_end = chunk.title, chunk.page, chunk.page_end
                control.images = [g for g in chunk.illustrations if g not in (OVERVIEW, SWITCH_PANEL)]
    for control in controls.values():
        control.looks_like = LOOKS_LIKE.get(control.callout, "")
        if not control.title:  # e.g. (9) Right Side Control Panel: described by the overview itself
            control.title, control.page, control.page_end = overview.title, overview.page, overview.page_end
    order = sorted(controls.values(), key=lambda c: (int(re.match(r"\d+", c.callout).group()), c.callout))
    return order


@cache
def catalogue() -> dict[str, Control]:
    """callout -> Control."""
    if not CATALOGUE_PATH.exists():
        raise RuntimeError("Control catalogue not built yet. Run: uv run python -m cat.controls")
    return {c["callout"]: Control(**c) for c in json.loads(CATALOGUE_PATH.read_text(encoding="utf-8"))}


def by_name(name: str) -> Control | None:
    name = name.lower().strip()
    return next((c for c in catalogue().values() if c.name.lower() == name), None)


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8")
    result = build()
    CATALOGUE_PATH.write_text(json.dumps([asdict(c) for c in result], indent=1), encoding="utf-8")
    for c in result:
        print(f"({c.callout:>2}) {c.name:42} p{c.page}-{c.page_end} {c.drawing} {c.target} imgs={c.images}")
    print(f"{len(result)} controls -> {CATALOGUE_PATH}")
