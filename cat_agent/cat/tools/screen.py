"""ask_about_screen: "what does this button do?" about a paused video or a photo.

What the operator is looking at was worked out when they paused or took the
photo (cat/screen.py). Answering is then one machine-expert LLM call over that
description plus the manual sections behind it (looked up locally), so it's
as fast as a normal manual answer, usually faster, and costs no vision model.
"""

import time

from loguru import logger
from pipecat.services.llm_service import FunctionCallParams

from cat.reply import reply_directly
from cat.screen import LOCAL_SESSION, get_screen_store
from cat.specialists.machine_expert import ExpertAnswer, answer_from_manual, say_answer

NOTHING_ON_SCREEN = (
    "I can't see anything on your screen yet. Pause the video on the control, or send me a photo, and ask again."
)


async def answer_about_screen(question: str, session_id: str = LOCAL_SESSION) -> tuple[ExpertAnswer | None, dict]:
    """(answer, what was on screen). The answer is None when nothing is on screen."""
    view = get_screen_store().get(session_id)
    if view is None:
        return None, {}
    if view.missed:
        # Known before any LLM call, so say it straight away rather than let a model guess.
        return ExpertAnswer(view.missed), view.as_json()
    t0 = time.perf_counter()
    # Local lookup by section title (plus the pause-time search for real footage);
    # empty -> the expert searches with the question.
    passages = await view.all_passages()
    answer = await answer_from_manual(question, screen=view.describe(), passages=passages or None)
    logger.info(
        f"SCREEN ({view.kind}): {len(view.controls)} controls in view, "
        f"{'local sections' if passages else 'searched'}, answered in {1000 * (time.perf_counter() - t0):.0f}ms"
    )
    return answer, view.as_json()


async def ask_about_screen(params: FunctionCallParams, question: str):
    """Answer a question about what the operator is looking at on their phone: \
a paused training video or a photo they took. Use for "what does this button \
do?", "what's that switch?", "what's number 7 here?", "what does the red button \
in my photo do?", "what's the one I circled?". Needs no description of the \
screen: it's provided.

    Args:
        question: The operator's question in their own words, e.g. "What does this button do?".
    """
    answer, seen = await answer_about_screen(question)
    if answer is None:
        await reply_directly(params, NOTHING_ON_SCREEN, {"answer": NOTHING_ON_SCREEN, "screen": None})
        return
    # The paused frame may already show the manual drawing; don't send it again.
    already_on_screen = answer.image is not None and answer.image.id == seen.get("image_id")
    await say_answer(params, question, answer, show_picture=not already_on_screen)
