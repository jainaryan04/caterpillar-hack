"""What each operator is looking at: a paused video frame or a photo they took.

The app reports it (POST /api/screen/..., see cat/server.py). Cat's
ask_about_screen tool reads it when the operator asks "what does this do?".
Everything the answer needs is worked out here, before the question arrives:

  - paused video -> the segment at that second (cat/video_index.py): which
    controls are on screen, which one is highlighted, the narration, and the
    manual sections they come from;
  - photo -> matched to the manual's control drawings on the CPU
    (cat/photo_match.py): which controls are in the photo, which one was
    tapped or is in the middle.

So answering is one LLM call over a short text description plus the manual
sections, which are looked up locally by title (cat/rag/sections.py): no
vision model, no search round trip.

State is per session (one per operator/phone) with a time-to-live; this
in-memory store is the only state, so it can move to Redis unchanged.
"""

import asyncio
import time
from dataclasses import dataclass, field

from loguru import logger

from cat.controls import Control, catalogue
from cat.pointing import CIRCLED, pick
from cat.rag import sections
from cat.rag.store import Passage

MISSED = (
    "The part you circled isn't one of the controls I can find in this picture. "
    "Circle a switch or lever, or tell me its name."
)
VIEW_TTL_SECS = 5 * 60  # after this, "this button" no longer refers to an old pause or photo
LOCAL_SESSION = "local"  # the laptop mic/speaker session


@dataclass
class ViewControl:
    control: Control
    emphasis: str = ""  # "highlighted", "tapped", "centre of the photo", ...
    where: str = ""  # position in the frame, e.g. "upper left"
    colour: str = ""  # from a real photo

    def describe(self) -> str:
        c = self.control
        parts = [f"({c.callout}) {c.name}"]
        if self.emphasis:
            parts.append(f"[{self.emphasis}]")
        details = [d for d in (c.looks_like, f"in the {self.where} of the frame" if self.where else "",
                               f"looks {self.colour} in the photo" if self.colour else "") if d]
        return " ".join(parts) + (f" - {'; '.join(details)}" if details else "") + f"; manual page {c.page}"

    def as_json(self) -> dict:
        c = self.control
        return {"callout": c.callout, "name": c.name, "page": c.page, "emphasis": self.emphasis,
                "where": self.where, "colour": self.colour}


@dataclass
class ScreenView:
    kind: str  # "video" or "photo"
    headline: str  # one line: what the operator is looking at
    controls: list[ViewControl] = field(default_factory=list)
    legend: dict[str, str] = field(default_factory=dict)  # a step picture's own numbered parts
    transcript: str = ""  # narration at that moment
    manual_titles: list[str] = field(default_factory=list)  # sections the frame comes from
    image_id: str | None = None  # the manual drawing on screen, if any
    details: dict = field(default_factory=dict)  # for the API response
    # Real footage is indexed by what it's *about* (on-screen text, narration),
    # not by exact controls, so its manual sections are also searched for:
    # started at pause time, reused by the question.
    search_hint: str = ""
    label: str = ""  # real footage: the on-screen label of what's shown, e.g. "Emergency Shut-off"
    label_manual: list[str] = field(default_factory=list)  # hand-checked manual sections for that label
    _search: asyncio.Task | None = None
    photo_match: object | None = None  # a photo's match, so a new circle doesn't need matching again
    photo: bytes | None = None  # the photo itself, to draw the next circle on
    missed: str = ""  # what to say when the operator circled a spot with no control (no LLM needed)
    created: float = field(default_factory=time.monotonic)

    def prefetch(self) -> None:
        """Start the manual search for this view now (call from the event loop)."""
        if self.search_hint and self._search is None:
            from cat.rag.store import get_store

            self._search = asyncio.get_running_loop().create_task(get_store().search(self.search_hint, top_k=4))
            self._search.add_done_callback(lambda t: t.cancelled() or t.exception())

    async def all_passages(self, limit: int = 6) -> list[Passage]:
        """passages() plus, for footage, what the prefetched search found."""
        local = self.passages(limit)
        if not self.search_hint:
            return local
        self.prefetch()
        try:
            found = await self._search
        except Exception as e:
            logger.warning(f"Screen search failed: {e}")
            found = []
        seen = {(p.title, p.page) for p in local}
        return (local + [p for p in found if (p.title, p.page) not in seen])[:limit]

    def describe(self) -> str:
        """The block the machine expert reads under "On the operator's screen"."""
        lines = [self.headline]
        focused = [vc for vc in self.controls if vc.emphasis]
        others = [vc for vc in self.controls if not vc.emphasis]
        if len(focused) > 1 and all(vc.emphasis == CIRCLED for vc in focused):
            lines.append(f"The operator drew one circle around {len(focused)} controls (closest to its middle first):")
        for vc in focused:
            lines.append(f"Pointed at: {vc.describe()}")
        if self.label and not focused:
            line = f'Pointed at: the part the on-screen label names, "{self.label}".'
            if self.label_manual:
                names = " / ".join(t.split(" > ")[-1] for t in self.label_manual)
                line += f' In the 320D manual this part is the "{names}" (checked by hand).'
            related = [t.split(" > ")[-1] for t in self.manual_titles if t not in self.label_manual]
            if related:
                line += f" Possibly related manual sections: {'; '.join(related)}."
            lines.append(line)
        if others:
            # A procedure step names the controls it uses; they aren't what's pointed at.
            step = self.kind == "video" and not focused and all(not vc.where for vc in others)
            prefix = "Controls this step uses (the step itself is the subject): " if step else "Also visible: "
            lines.append(prefix + " | ".join(vc.describe() for vc in others[:14]))
        if self.legend:
            lines.append(
                "Numbers drawn on this picture label its own parts (not the cab callouts): "
                + ", ".join(f"({k}) {v}" for k, v in self.legend.items())
            )
        if self.transcript:
            lines.append(f'Narration at this moment: "{self.transcript}"')
        if not self.controls and not self.legend and not self.manual_titles:
            lines.append("No 320D control could be identified in it.")
        return "\n".join(lines)

    def _titles(self) -> list[str]:
        """Manual sections behind the screen, most relevant first: a pointed-at control's own
        section, else the scene's section (a procedure step), then other visible controls."""
        pointed = [vc.control.title for vc in self.controls if vc.emphasis]
        rest = [vc.control.title for vc in self.controls if not vc.emphasis]
        return list(dict.fromkeys(pointed + self.label_manual + self.manual_titles + rest[:3]))

    def passages(self, limit: int = 6) -> list[Passage]:
        """The manual sections behind what's on screen. Local, ~0ms."""
        return sections.sections(self._titles(), limit=limit)

    def manual_pages(self) -> tuple[int, int, str] | None:
        """(first page, last page, topic) of the manual section for what's on screen, for "open it"."""
        for title in self._titles():
            found = sections.section(title)
            if found:
                topic = title.split(" > ")[-1]
                return found[0].page, max(p.page_end for p in found), topic
        return None

    def as_json(self) -> dict:
        return {
            "kind": self.kind,
            "headline": self.headline,
            "controls": [vc.as_json() for vc in self.controls],
            "picture_legend": self.legend,
            "transcript": self.transcript,
            "manual": self.manual_titles,
            "image_id": self.image_id,
            **self.details,
        }


def _where(x: float, y: float) -> str:
    """Position words for a point in a frame (0-1 coordinates)."""
    col = "left" if x < 0.36 else "right" if x > 0.64 else "middle"
    row = "upper" if y < 0.4 else "lower" if y > 0.68 else "centre"
    return "centre" if (col, row) == ("middle", "centre") else f"{row} {col}".replace("centre ", "")


def _mmss(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def view_from_video(video, t: float, tap=None, circle=None) -> ScreenView:
    """What's on screen at second t of a video (optionally where the operator tapped or circled)."""
    segment = video.segment_at(t) or {}
    controls = catalogue()
    view = ScreenView(
        kind="video",
        headline=f'Paused at {_mmss(t)} in the training video "{video.title}". On screen: {segment.get("caption", "the title card")}.',
        transcript=segment.get("transcript", ""),
        manual_titles=[m["title"] for m in segment.get("manual", [])],
        legend=segment.get("picture_legend", {}),
        image_id=segment.get("image"),
        details={"video_id": video.id, "t": round(t, 2), "segment": [segment.get("start"), segment.get("end")]},
    )
    if segment.get("kind") == "footage":
        words = f'{segment.get("caption", "")}. {segment.get("transcript", "")}'.split()
        view.search_hint = " ".join(words[:60])
        view.label = " ".join(segment.get("on_screen_text", []))
        view.label_manual = segment.get("label_manual", [])
        view.headline += (
            " This is real footage, indexed by what each moment is about (on-screen text and narration),"
            " not by where each control is. The manual is for the Cat 320D; if the footage shows a newer"
            " version that the manual describes differently, say so."
        )
    step = segment.get("kind") == "picture"  # a procedure step: the step itself is the subject
    if step and view.manual_titles:
        section = view.manual_titles[0].split(" > ")[-1]
        page = segment["manual"][0].get("page")
        view.headline += f' This step is from the manual section "{section}" (page {page}); that is what "this" means.'
    for entry in segment.get("controls", []):
        control = controls.get(entry["callout"])
        if control:
            if entry.get("highlighted"):
                emphasis = "highlighted"
            else:
                emphasis = "" if step else "named in the caption"
            box = entry.get("box")
            where = _where(box[0] + box[2] / 2, box[1] + box[3] / 2) if box else ""
            view.controls.append(ViewControl(control, emphasis, where))
    for entry in segment.get("also_in_view", []):
        control = controls.get(entry["callout"])
        if control:
            view.controls.append(ViewControl(control, "", _where(*entry["at"])))
    if tap or circle:
        _apply_pointing(view, segment, tap, circle)
    return view


def _apply_pointing(view: ScreenView, segment: dict, tap, circle) -> None:
    """The operator tapped or circled part of the paused frame."""
    points = {e["callout"]: tuple(e["at"]) for e in segment.get("also_in_view", [])}
    for e in segment.get("controls", []):
        if e.get("box"):
            b = e["box"]
            points[e["callout"]] = (b[0] + b[2] / 2, b[1] + b[3] / 2)
    meant, how = pick(points, tap, circle, default_centre=False)
    if not meant:
        if circle and segment.get("kind") != "footage":  # footage has no control positions to miss
            view.missed = MISSED
        return
    for vc in view.controls:
        vc.emphasis = how if vc.control.callout in meant else ""
    view.controls.sort(key=lambda vc: (not vc.emphasis, meant.index(vc.control.callout) if vc.emphasis else 0))


def view_from_photo(match, tap=None, circle=None) -> ScreenView:
    """A photo matched by cat/photo_match.py (or None when nothing matched), and
    what the operator tapped or circled on it."""
    if match is None:
        return ScreenView(
            kind="photo",
            headline="A photo from the operator's phone. It could not be matched to any known 320D control layout.",
            details={"matched": False},
        )
    controls = catalogue()
    view = ScreenView(
        kind="photo",
        headline=f"A photo from the operator's phone, showing {match.title}.",
        image_id=match.reference if match.reference in ("g03654245", "g03666599") else None,
        details={"matched": True, "reference": match.reference, "inliers": match.inliers, "match_ms": round(match.ms)},
        photo_match=match,
    )
    meant, how = pick(match.visible, tap, circle)
    if circle and not meant:
        view.missed = MISSED
    ordered = sorted(match.visible, key=lambda k: meant.index(k) if k in meant else len(meant))
    for callout in ordered:
        if callout in controls:
            x, y = match.visible[callout]
            view.controls.append(
                ViewControl(controls[callout], how if callout in meant else "", _where(x, y), match.colours.get(callout, ""))
            )
    return view


SHAPE_ONLY_MIN = 0.3  # below this the best guess is too unsure to name
CLOSE_SECOND = 0.15  # a second guess this close is mentioned too


def apply_recognition(view: ScreenView, recognition, how: str) -> None:
    """What the circled part looks like (cat/part_recognition.py), for pictures with no known layout."""
    best = recognition.best
    x0, y0, x1, y1 = recognition.box
    where = _where((x0 + x1) / 2, (y0 + y1) / 2)
    guesses = ", ".join(f"{g.part.name} ({g.score:.0%})" for g in recognition.guesses)
    view.details["recognized"] = [{"part": g.part.name, "score": round(g.score, 2)} for g in recognition.guesses]
    view.details["recognized_ms"] = round(recognition.ms)
    view.missed = ""
    if best.score < SHAPE_ONLY_MIN:
        view.missed = "I can't tell what that part is from the picture. Tell me its name, or take a closer photo of it."
        return
    if not best.part.callouts and not best.part.manual:
        view.missed = f"That looks like the {best.part.name}, not a control. Circle a switch or lever, or tell me its name."
        return
    view.headline += (
        f" The operator {how.split(' by ')[0]} a part in the {where} of the picture. Cat couldn't match this picture to"
        f" a known 320D layout (it may be another machine), so the part was recognised by its shape only; it looks"
        f' like: {guesses}. Begin the answer with "That looks like a {best.part.name}." and then say what the Cat'
        f' 320D manual says about it ("On the 320D, ..."). The picture has no callout numbers, so don\'t say'
        f' "number N in the picture".'
    )
    controls = catalogue()
    likely = [best] + [g for g in recognition.guesses[1:2] if best.score - g.score < CLOSE_SECOND and g.part.callouts]
    for vc in view.controls:
        vc.emphasis = ""
    for guess in likely:
        for callout in guess.part.callouts:
            if callout in controls:
                emphasis = f"{how}; by its shape it looks like a {guess.part.name} ({guess.score:.0%})"
                view.controls = [vc for vc in view.controls if vc.control.callout != callout]
                view.controls.insert(0, ViewControl(controls[callout], emphasis, where))
        view.manual_titles = list(guess.part.manual) + view.manual_titles


class ScreenStore:
    """session id -> what that operator is looking at."""

    def __init__(self, ttl: float = VIEW_TTL_SECS):
        self._views: dict[str, ScreenView] = {}
        self._ttl = ttl

    def set(self, session_id: str, view: ScreenView) -> None:
        self._views[session_id] = view

    def clear(self, session_id: str) -> None:
        self._views.pop(session_id, None)

    def get(self, session_id: str) -> ScreenView | None:
        view = self._views.get(session_id)
        if view and time.monotonic() - view.created > self._ttl:
            self.clear(session_id)
            return None
        return view


_store = ScreenStore()


def get_screen_store() -> ScreenStore:
    return _store
