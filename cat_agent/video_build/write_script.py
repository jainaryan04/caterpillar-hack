"""Write the narration scripts for the generated manual videos (offline, once).

Each scene shows a manual drawing (zoomed onto a numbered control, or a step
picture) and says one or two sentences condensed from that part of the manual
by one text-only LLM call, under the machine expert's accuracy rules. Scripts
are saved to video_build/scripts/<video>.json so a person can review and edit
the narration before rendering (edits survive re-runs: scenes that already
have narration are kept unless --rewrite).

    uv run video_build/write_script.py            # both videos
    uv run video_build/write_script.py --rewrite
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cat  # noqa: E402,F401  (loads .env)
from openai import AsyncOpenAI  # noqa: E402

from cat.config import load_config  # noqa: E402
from cat.controls import OVERVIEW, SWITCH_PANEL, catalogue  # noqa: E402
from cat.rag.parse import IMAGE_MARKER, parse_manual  # noqa: E402
from cat.rag.store import MANUAL  # noqa: E402

SCRIPTS = Path(__file__).with_name("scripts")

RULES = """\
You write narration for a short training video about the Cat 320D excavator, \
read aloud over a drawing from its Operation and Maintenance Manual.
Write one or two plain spoken sentences, at most 32 words, about the topic \
named below, using ONLY facts stated in the manual text given. No advice, \
numbers or warnings that are not in the text. Don't start with the topic's \
name if the caption already shows it; don't say "this video" or "the manual \
says". No lists or symbols. Return only the narration."""


def _controls_tour() -> dict:
    """V1: every numbered control, zooming into the two overview drawings."""
    controls = catalogue()
    scenes = [
        {
            "kind": "title",
            "title": "Cat 320D Operator Controls",
            "subtitle": "From the Operation and Maintenance Manual SEBU8053-20",
            "narration": "This is a tour of the operator controls of the Cat 320D excavator, "
            "taken from its Operation and Maintenance Manual.",
        },
        {
            "kind": "drawing",
            "image": OVERVIEW,
            "caption": "The cab · manual page 95",
            "narration": "Here is the cab from above. Each control has a number in the manual. "
            "Pause at any time and ask Cat about what you see.",
            "controls": [],
            "manual": [{"title": "Operation Section > Operator Controls", "page": 95}],
        },
    ]
    for drawing in (OVERVIEW, SWITCH_PANEL):
        if drawing == SWITCH_PANEL:
            scenes.append(
                {
                    "kind": "drawing",
                    "image": SWITCH_PANEL,
                    "caption": "(9) Right side control panel · manual page 96",
                    "narration": "Now the right side control panel, with switches 13 to 26.",
                    "controls": [],
                    "manual": [{"title": "Operation Section > Operator Controls", "page": 96}],
                }
            )
        for c in controls.values():
            if c.drawing != drawing or c.callout == "9":
                continue
            scenes.append(
                {
                    "kind": "drawing",
                    "image": drawing,
                    "focus": c.callout,
                    "caption": f"({c.callout}) {c.name} · manual page {c.page}",
                    "controls": [c.callout],
                    "manual": [{"title": c.title, "page": c.page}],
                    "source_title": c.title,
                    "narration": "",
                }
            )
            # A control's own picture, where the manual has one that shows it.
            if c.images and c.callout in ("3", "12", "20", "26"):
                scenes.append(
                    {
                        "kind": "picture",
                        "image": c.images[0] if c.callout != "3" else "g00731542",
                        "caption": f"({c.callout}) {c.name} · manual page {c.page}",
                        "controls": [c.callout],
                        "manual": [{"title": c.title, "page": c.page}],
                        "source_title": c.title,
                        "narration": "",
                        "follow_on": True,  # continue from the previous scene, don't repeat it
                    }
                )
    scenes.append(
        {
            "kind": "title",
            "title": "Ask Cat",
            "subtitle": 'Pause the video and say "Hey Cat, what does this do?"',
            "narration": "Pause this video at any control and ask Cat what it does.",
        }
    )
    return {"video_id": "controls-tour", "title": "Cat 320D Operator Controls Tour", "scenes": scenes}


# V2: a procedure video, narrated by hand from the manual's numbered steps
# (checked line by line against pages 85-190).
# (manual section, picture, callouts on screen, caption, narration)
_PROCEDURE = [
    ("Operation Section > Mounting and Dismounting", "g00037860", [], "Getting on",
     "Face the machine when you get on or off, and keep three-point contact with the steps and handholds. "
     "Never mount or dismount a moving machine."),
    ("Operation Section > Seat Belt > Seat Belt Adjustment for Retractable Seat Belts", "g00867598", [],
     "Fasten the seat belt",
     "Pull the belt out of the retractor in a continuous motion, fasten the catch into the buckle, "
     "and position the belt low across your lap."),
    ("Operation Section > Seat Belt > Seat Belt Adjustment for Retractable Seat Belts", "g00039113", [],
     "Release the seat belt",
     "To release it, push the release button on the buckle. The belt retracts automatically."),
    ("Operation Section > Engine Starting", "g00406959", [], "Battery disconnect switch: ON",
     "Before starting, turn the battery disconnect switch to the ON position."),
    ("Operation Section > Engine Starting", "g01075262", ["2"], "Hydraulic lockout: LOCKED",
     "Move the hydraulic lockout control to LOCKED. The engine only starts with the lever in the LOCKED "
     "position. Then move the joysticks to HOLD."),
    ("Operation Section > Engine Starting", "g00682776", ["8", "7"], "Starting the engine",
     "Make sure everyone is clear and briefly sound the horn. Turn the engine start switch to ON, set the "
     "engine speed dial to 1, then turn the switch to START and release the key once the engine starts."),
    ("Operation Section > Stopping the Engine", "g00683306", ["8"], "Stopping the engine",
     "After working under load, stop the machine and run the engine at low idle for five minutes. "
     "Then turn the engine start switch to OFF and remove the key."),
    ("Operation Section > Stopping the Engine > Engine Stop Control", "g01073837", [], "If the engine won't stop",
     "If the engine does not stop, use the engine stop control below the left side of the operator seat: "
     "lift the cover and push the switch upward."),
    ("Operation Section > Leaving the Machine", "g00037860", [], "Leaving the machine",
     "Dismount facing the machine, using both hands on the steps and handholds. Then clean any debris out "
     "of the engine compartment and the front bottom guard to avoid a fire hazard."),
    ("Operation Section > Leaving the Machine", "g00406959", [], "Battery disconnect switch: OFF",
     "Finally, turn the battery disconnect switch to OFF. If you leave the machine for a month or longer, "
     "remove the key."),
]


def _start_to_finish(pages: dict[str, int]) -> dict:
    scenes = [
        {
            "kind": "title",
            "title": "Cat 320D: Start to Finish",
            "subtitle": "Getting on, starting, stopping and leaving the machine",
            "narration": "From climbing on to leaving the machine: the basic steps from the Cat 320D manual.",
        }
    ]
    for title, image, callouts, caption, narration in _PROCEDURE:
        scenes.append(
            {
                "kind": "picture",
                "image": image,
                "caption": f"{caption} · manual page {pages[title]}",
                "controls": callouts,
                "manual": [{"title": title, "page": pages[title]}],
                "source_title": title,
                "narration": narration,
            }
        )
    return {"video_id": "start-to-finish", "title": "Cat 320D: Start to Finish", "scenes": scenes}


def _section_texts() -> dict[str, tuple[str, int]]:
    """Manual section title -> (its text, first page)."""
    texts: dict[str, list] = {}
    for chunk in parse_manual(MANUAL.pdf, MANUAL.key):
        entry = texts.setdefault(chunk.title, [[], chunk.page])
        entry[0].append(IMAGE_MARKER.sub("", chunk.text))
    return {t: (" ".join(parts), page) for t, (parts, page) in texts.items()}


async def _narrate(client, model: str, scene: dict, text: str, previous: str) -> str:
    image_hint = f" The picture on screen is manual illustration {scene['image']}." if scene["kind"] == "picture" else ""
    follow = f'\nThe previous line was: "{previous}". Continue with the next fact; don\'t repeat it.' if scene.get("follow_on") else ""
    prompt = (
        f"Topic: {scene['caption'].split(' · ')[0]}.{image_hint}{follow}\n\n"
        f"Manual text ({scene['source_title']}):\n{text[:3500]}"
    )
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": RULES}, {"role": "user", "content": prompt}],
        reasoning_effort="low",
    )
    return " ".join(response.choices[0].message.content.split()).replace("‑", "-")


async def main(rewrite: bool):
    cfg = load_config()
    client = AsyncOpenAI(api_key=cfg.llm_api_key, base_url=cfg.llm_base_url)
    sections = _section_texts()
    pages = {title: page for title, (_, page) in sections.items()}
    SCRIPTS.mkdir(exist_ok=True)
    for script in (_controls_tour(), _start_to_finish(pages)):
        path = SCRIPTS / f"{script['video_id']}.json"
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        old_lines = {(s.get("image"), s.get("focus"), s.get("caption")): s["narration"] for s in old["scenes"]} if old else {}
        previous = ""
        for scene in script["scenes"]:
            key = (scene.get("image"), scene.get("focus"), scene.get("caption"))
            if not scene["narration"]:
                scene["narration"] = "" if rewrite else old_lines.get(key, "")
            if not scene["narration"]:
                text, _ = sections[scene["source_title"]]
                scene["narration"] = await _narrate(client, cfg.llm_model, scene, text, previous)
            previous = scene["narration"]
            print(f"  [{scene.get('caption', scene.get('title'))}] {scene['narration']}")
        path.write_text(json.dumps(script, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"{len(script['scenes'])} scenes -> {path.name}\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main("--rewrite" in sys.argv))
