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

Retrieval runs *before* the agent, so the usual answer takes one LLM call
instead of a tool-call round trip. The agent runs on the same provider as the
voice loop (Cerebras by default).
"""

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
from pipecat.frames.frames import (
    FunctionCallResultProperties,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.services.llm_service import FunctionCallParams

from cat.config import load_config
from cat.display import show_manual_image
from cat.rag.images import ManualImage, get_image
from cat.rag.store import MANUAL, format_passages, get_store

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

Your answer is read aloud to an operator who is working the machine:
- One or two short sentences, under 45 words, in plain speech. No lists, markdown or symbols.
- Then the page, e.g. "That's on page 96 of the manual."

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

SHOWN_ON_SCREEN = " I've put the picture from the manual on your screen."


# The agent's last line names its picture. (A structured output type would be
# neater, but Cerebras rejects tools and response_format in the same request.)
_IMAGE_LINE = re.compile(r"\s*image:\s*(g\d{8}|none)\W*$", re.IGNORECASE)


def _split_answer(output: str) -> tuple[str, str | None]:
    # gpt-oss likes typographic spaces/hyphens ("page 94", "right‑side").
    output = output.replace(" ", " ").replace(" ", " ").replace("‑", "-")
    match = _IMAGE_LINE.search(output)
    if not match:
        return output.strip(), None
    image_id = match.group(1).lower()
    return output[: match.start()].strip(), None if image_id == "none" else image_id


@dataclass
class ExpertAnswer:
    text: str
    image: ManualImage | None = None


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
    settings = ModelSettings(reasoning=Reasoning(effort="low")) if cfg.llm_provider == "cerebras" else ModelSettings()
    return Agent(
        name="Machine Expert",
        model=OpenAIChatCompletionsModel(model=cfg.llm_model, openai_client=client),
        model_settings=settings,
        instructions=INSTRUCTIONS,
        tools=[search_manual],
    )


async def answer_from_manual(question: str) -> ExpertAnswer:
    t0 = time.perf_counter()
    try:
        passages = await get_store().search_for_question(question)
    except Exception as e:
        logger.error(f"Manual search failed: {e}")
        return ExpertAnswer("I couldn't reach the manual just now. Please try again in a moment.")
    t_search = time.perf_counter()
    prompt = f"Operator's question: {question}\n\nManual excerpts:\n\n{format_passages(passages)}"
    result = await Runner.run(_machine_expert(), prompt)
    text, image_id = _split_answer(result.final_output)
    # Only show a picture that really exists (the model could invent an id).
    image = get_image(image_id)
    logger.debug(
        f"machine expert: search {1000 * (t_search - t0):.0f}ms, "
        f"agent {1000 * (time.perf_counter() - t_search):.0f}ms, "
        f"top hit: {passages[0].title if passages else '-'}, picture: {image_id}"
    )
    return ExpertAnswer(text, image)


async def ask_machine_expert(params: FunctionCallParams, question: str):
    """Look up the machine's official operation manual. Use for any question about a \
control, button, switch, lever, warning, safety procedure, or maintenance task.

    Args:
        question: The operator's question, rewritten to be self-contained
            (e.g. "What does the AEC switch do?").
    """
    answer = await answer_from_manual(question)
    spoken = answer.text
    if answer.image:
        await show_manual_image(params.llm, answer.image, caption=question)
        spoken += SHOWN_ON_SCREEN
    # The answer is already short and voice-ready: record it as the tool result
    # without running the voice LLM again, and emit it as if the LLM had said it,
    # so TTS speaks it and it lands in the conversation as Cat's reply.
    result = {"answer": spoken, "picture_shown": answer.image.id if answer.image else None}
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))
    for frame in (LLMFullResponseStartFrame(), LLMTextFrame(spoken), LLMFullResponseEndFrame()):
        await params.llm.push_frame(frame)
