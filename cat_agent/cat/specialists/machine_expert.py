"""Machine expert: a specialist agent that answers from the official Cat manual.

This is the "agent as a tool" pattern:
  voice LLM --calls tool--> ask_machine_expert(question)
      1. hybrid search over the Cat 320D Operation and Maintenance Manual (Pinecone)
      2. Agents SDK agent reads the top passages and writes a short spoken answer,
         and picks the manual's picture for it if one helps
         (it can call search_manual itself if the first passages miss)
      --shows-->  the picture on the operator's screen (see cat/display.py)
      --speaks--> the answer directly (no second voice-LLM call to reword it,
                  which saves ~0.5-0.9s and can't add facts that aren't in the manual).
      --remembers--> the pages it came from, so "open it" can show them (cat/tools/manual.py)

Retrieval runs *before* the agent, so the usual answer takes one LLM call
instead of a tool-call round trip. The agent runs on the same provider as the
voice loop (Cerebras by default).
"""

import asyncio
import re
import time
from dataclasses import dataclass
from functools import cache

from agents import (
    Agent,
    ModelSettings,
    OpenAIChatCompletionsModel,
    Runner,
    function_tool,
    set_tracing_disabled,
)
from loguru import logger
from openai import AsyncOpenAI
from openai.types.shared import Reasoning
from pipecat.services.llm_service import FunctionCallParams

from cat.config import load_config
from cat.display import show_manual_image
from cat.memory import ManualLookup, get_manual_memory
from cat.rag.images import ManualImage, get_image
from cat.rag.pages import MAX_PAGES
from cat.rag.store import MANUAL, Passage, format_passages, get_store, hedged
from cat.reply import reply_directly

# Tracing uploads every agent run to OpenAI's dashboard; keep it off.
set_tracing_disabled(True)

INSTRUCTIONS = f"""\
You are the machine expert for a Cat 320D hydraulic excavator. You answer the \
operator's question using only the {MANUAL.title}.

You are given excerpts from the manual, each headed with its topic and page. \
If they don't answer the question, call search_manual once with different \
words. If the manual still doesn't cover it, say so plainly.

Accuracy rules - an operator will act on what you say:
- State only facts written in the excerpts. Never add advice, warnings or numbers of your own.
- Use the excerpt about the exact control or task asked about. Neighbouring \
controls often share an excerpt; don't mix their details in.
- Keep conditions that change the answer (e.g. "only with Cat HYDO Advanced oil, otherwise 2000 hours").
- Mention a safety warning only if the excerpt gives one for this control or task.
- Positions and conditions must match the excerpt word for word: LOCKED/UNLOCKED, ON/OFF, \
forward/backward, "before"/"after", "only when", "will not". Say which position allows what \
exactly as written (e.g. "the engine starts only with the lever in LOCKED"), never inverted.

Your answer is read aloud to an operator who is working the machine:
- Explain it in your own everyday words, like an experienced operator talking a new one \
through it. Don't read the manual's sentences out; say what it means for them.
- One or two short sentences, under 45 words, in plain speech. No lists, markdown or symbols.
- Then the page, e.g. "That's on page 96 of the manual."

If the operator asks you to explain more simply, or says they don't understand \
("in simple terms", "what does that mean", "explain it like I'm new"), really explain it:
- Start from what it is for and why it matters to them, then what to do, in the \
simplest words. Swap manual terms for everyday ones (say "the lever that locks \
the controls" rather than only its name). A short everyday comparison is fine.
- Up to four short sentences, under 70 words. Don't repeat the manual's wording.
- Simpler words, same facts: the accuracy rules above still apply.

Pictures: the excerpts contain markers like [image g00867598] where the \
manual's illustrations sit; a picture belongs to the text right after it. \
"Shown as callout (15) in [image ...]" means the control is number 15 on that \
overview drawing. If a picture shows the control or the steps in your answer, \
pick it (prefer the control's own picture; else its callout drawing). Don't \
describe the picture; if you pick a callout drawing, say its number once in \
the first sentence, e.g. "It's number 15 in the picture." The operator is told separately that a \
picture is on screen. End your reply with one last line, exactly:
image: g00867598     <- the picture you picked, or
image: none
"""

EXPERT_HEDGE_SECS = 2.5
EXPERT_TEMPERATURE = 0.2

SHOWN_ON_SCREEN = " I've put the picture from the manual on your screen."

# Added to the prompt when the question is about what's on the operator's screen.
SCREEN_RULES = """\
The operator is asking about what is on their screen right now (described \
below). "This", "that", "it" or "the one" means what is marked as pointed \
at (a control, or the part an on-screen label names), unless their words (a \
colour, icon, position or number) clearly pick another listed one. A colour \
the operator mentions may not appear in the manual; don't repeat it as a fact. \
Numbers drawn on a step picture refer to that picture's own labels. Identify \
the control only from that description and explain it only from the manual \
excerpts, answering what they actually asked (what it does, where it is, or \
how to use it). If the footage shows a newer machine version, say the 320D \
manual describes it this way. If \
several listed controls fit equally and nothing narrows it down, ask which \
one in one short question, naming them. If the operator circled two or three \
controls, name each and say in a few words what it does. If nothing listed fits, say you can't \
tell from the screen and ask them to name it or tap it. If nothing is marked \
as pointed at and the screen shows a procedure step, "this" means that step: \
explain the step from its own manual section, not a control it uses. If the \
part was recognised by its shape only (the picture didn't match a known 320D \
layout), say what it looks like ("That looks like a joystick.") rather than \
stating it as fact, then what the 320D manual says about that control; if two \
guesses are close, mention both briefly. Start by \
naming the step or the \
control, e.g. "That's the travel alarm cancel switch."
"""

# Added to the prompt when the operator may be following up on Cat's last answer.
EARLIER = """\
Just before this, the operator asked: {question}
You answered: {answer}
If the new question follows up on that ("explain it more simply", "what does \
that mean?", "say it again"), it is about the same control or task: explain \
that again, as the new question asks, rather than looking for something new. \
If it names a different control or task, answer that instead.

"""


# The agent's last line names its picture. (A structured output type would be
# neater, but Cerebras rejects tools and response_format in the same request.)
_IMAGE_LINE = re.compile(r"\s*image:\s*(g\d{8}|none)\W*$", re.IGNORECASE)


def _split_answer(output: str) -> tuple[str, str | None]:
    # gpt-oss likes typographic spaces/hyphens ("page 94", "right‑side").
    output = output.replace(" ", " ").replace(" ", " ").replace("‑", "-")
    output = output.replace("’", "'").replace("“", '"').replace("”", '"')
    match = _IMAGE_LINE.search(output)
    if not match:
        return output.strip(), None
    image_id = match.group(1).lower()
    return output[: match.start()].strip(), None if image_id == "none" else image_id


# "That's on page 96", "pages 92 to 94", "pages 10-11"
_PAGE_REF = re.compile(r"\bpages?\s+(\d+)(?:\s*(?:-|to|and)\s*(\d+))?", re.IGNORECASE)


@dataclass
class ExpertAnswer:
    text: str
    image: ManualImage | None = None
    page: int | None = None  # where in the manual the answer came from
    page_end: int | None = None
    topic: str = ""


def _source(text: str, image: ManualImage | None, passages: list[Passage]) -> tuple[int, int, str] | None:
    """(first page, last page, topic) of the manual section behind an answer."""
    match = _PAGE_REF.search(text)
    if match:
        page = int(match.group(1))
    elif image:
        page = image.page
    else:
        return None  # the manual didn't cover it
    # The best-ranked passage on that page gives the topic and its full page range.
    passage = next((p for p in passages if p.page <= page <= p.page_end), None)
    if passage is None:
        end = int(match.group(2)) if match and match.group(2) else page
        return page, max(end, page), ""
    # "Operation Section > Travel Alarm Cancel Switch (15)" -> "Travel Alarm Cancel Switch"
    topic = re.sub(r"\s*\([\d-]+\)$", "", passage.title.split(" > ")[-1])
    topic = topic.replace("- ", "-")  # "Non- Retractable": hyphen from a wrapped PDF line
    if passage.page_end - passage.page < MAX_PAGES:
        return passage.page, passage.page_end, topic
    # A long topic: the page the answer cites, plus the next one.
    first = min(page, passage.page_end - 1)
    return first, first + 1, topic


@function_tool
async def search_manual(query: str) -> str:
    """Search the machine's Operation and Maintenance Manual.

    Args:
        query: What to look up, e.g. "hydraulic lockout lever" or "travel alarm".
    """
    return format_passages(await get_store().search(query))


@cache
def _machine_expert() -> Agent:
    cfg = load_config()
    client = AsyncOpenAI(api_key=cfg.llm_api_key, base_url=cfg.llm_base_url)
    # Low temperature: plain-language answers, but no drifting from the manual (typed, voice and photo all use this).
    settings = ModelSettings(
        temperature=EXPERT_TEMPERATURE,
        reasoning=Reasoning(effort="low") if cfg.llm_provider == "cerebras" else None,
    )
    return Agent(
        name="Machine Expert",
        model=OpenAIChatCompletionsModel(model=cfg.llm_model, openai_client=client),
        model_settings=settings,
        instructions=INSTRUCTIONS,
        tools=[search_manual],
    )


async def _search_with_earlier(question: str, earlier: ManualLookup) -> list[Passage]:
    """A follow-up's own words rarely name the part, so also search what the last answer was about."""
    store = get_store()
    about_earlier, about_question = await asyncio.gather(
        store.search(f"{earlier.topic}. {earlier.answer}"), store.search_for_question(question)
    )
    seen, merged = set(), []
    for p in about_earlier + about_question:
        if (p.title, p.page) not in seen:
            seen.add((p.title, p.page))
            merged.append(p)
    return merged


async def answer_from_manual(
    question: str,
    screen: str | None = None,
    passages: list[Passage] | None = None,
    earlier: ManualLookup | None = None,
) -> ExpertAnswer:
    """Answer from the manual. `screen` describes what the operator is looking at
    (cat/screen.py) and `passages` are the manual sections already known to be
    behind it; without them the manual is searched with the question. `earlier`
    is Cat's last answer, when the question may follow up on it ("explain that simpler")."""
    t0 = time.perf_counter()
    if not passages:
        try:
            if earlier:
                passages = await _search_with_earlier(question, earlier)
            else:
                passages = await get_store().search_for_question(question)
        except Exception as e:
            logger.error(f"Manual search failed: {e}")
            return ExpertAnswer("I couldn't reach the manual just now. Please try again in a moment.")
    t_search = time.perf_counter()
    prompt = ""
    if earlier:
        prompt += EARLIER.format(question=earlier.question, answer=earlier.answer)
    prompt += f"Operator's question: {question}\n\n"
    if screen:
        prompt += f"{SCREEN_RULES}\nOn the operator's screen right now:\n{screen}\n\n"
    prompt += f"Manual excerpts:\n\n{format_passages(passages)}"
    # Usually ~0.8s; now and then a request stalls for several seconds, so race
    # a backup copy after EXPERT_HEDGE_SECS (costs an extra call only then).
    result = await hedged(lambda: Runner.run(_machine_expert(), prompt), "machine expert", after=EXPERT_HEDGE_SECS)
    text, image_id = _split_answer(result.final_output)
    # Only show a picture that really exists (the model could invent an id).
    image = get_image(image_id)
    logger.debug(
        f"machine expert: search {1000 * (t_search - t0):.0f}ms, "
        f"agent {1000 * (time.perf_counter() - t_search):.0f}ms, "
        f"top hit: {passages[0].title if passages else '-'}, picture: {image_id}"
    )
    source = _source(text, image, passages)
    if source is None:
        return ExpertAnswer(text, image)
    page, page_end, topic = source
    return ExpertAnswer(text, image, page, page_end, topic)


async def ask_machine_expert(params: FunctionCallParams, question: str):
    """Look up the machine's official operation manual. Use for any question about a \
control, button, switch, lever, warning, safety procedure, or maintenance task.

    Args:
        question: The operator's question, rewritten to be self-contained
            (e.g. "What does the AEC switch do?").
    """
    answer = await answer_from_manual(question)
    await say_answer(params, question, answer)


def remember_answer(question: str, answer: ExpertAnswer) -> bool:
    """Keep the pages behind an answer, so "open it" can show them. False if it had none."""
    if not answer.page:
        return False
    get_manual_memory().remember(
        ManualLookup(
            question=question,
            answer=answer.text,
            topic=answer.topic,
            page=answer.page,
            page_end=answer.page_end or answer.page,
            image_id=answer.image.id if answer.image else None,
        )
    )
    return True


async def say_answer(params: FunctionCallParams, question: str, answer: ExpertAnswer, show_picture: bool = True):
    """Show the manual's picture, remember the pages for "open it", and speak the answer."""
    spoken = answer.text
    if answer.image and show_picture:
        await show_manual_image(params.llm, answer.image, caption=question)
        spoken += SHOWN_ON_SCREEN
    result = {"answer": spoken, "picture_shown": answer.image.id if answer.image and show_picture else None}
    if remember_answer(question, answer):
        result["manual_pages"] = [answer.page, answer.page_end]
    # The answer is already short and voice-ready: speak it without running
    # the voice LLM again.
    await reply_directly(params, spoken, result)
