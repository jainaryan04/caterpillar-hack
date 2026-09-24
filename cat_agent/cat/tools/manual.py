"""Open the manual on screen at what Cat just talked about ("open it", "show me that").

ask_machine_expert remembers which pages each answer came from (cat/memory.py);
this tool renders those pages (cat/rag/pages.py) and puts them on the
operator's screen (cat/display.py). No search and no LLM call, so it's quick.
The phone app's GET /api/app/manual/open uses the same logic (find_pages).
"""

import asyncio

from loguru import logger
from pipecat.services.llm_service import FunctionCallParams

from cat.display import show_manual_pages
from cat.memory import get_manual_memory
from cat.rag.pages import ManualPages, page_count, render_pages
from cat.reply import reply_directly
from cat.screen import LOCAL_SESSION, get_screen_store


async def find_pages(page: int = 0, session_id: str = LOCAL_SESSION) -> tuple[ManualPages, str] | str:
    """The rendered manual pages the operator means, with their topic, or what to say instead."""
    memory = get_manual_memory()
    lookup = memory.on_page(page) if page else memory.last()
    # Paused on a video or sent a photo since the last answer: "open the manual
    # for this" means what's on the screen now, not the previous answer.
    view = get_screen_store().get(session_id)
    screen_is_newer = view is not None and not page and (lookup is None or view.created > lookup.at)
    on_screen = view.manual_pages() if screen_is_newer else None
    if screen_is_newer and on_screen is None:
        return "This part isn't from a specific page of the manual. Pause on a control or a step and ask me again."
    if on_screen:
        first, last, topic = on_screen
        last = min(last, first + 1)  # at most two pages side by side
    elif lookup:
        first, last, topic = lookup.page, lookup.page_end, lookup.topic
    elif page:
        pages_in_manual = await asyncio.to_thread(page_count)
        if not 1 <= page <= pages_in_manual:
            return f"The manual only has {pages_in_manual} pages."
        first, last, topic = page, page, ""
    else:
        return "I haven't looked anything up in the manual yet. Ask me about a control or a task first."
    try:
        return await asyncio.to_thread(render_pages, first, last), topic
    except Exception as e:
        logger.error(f"Couldn't render manual pages {first}-{last}: {e}")
        return "I couldn't open the manual just now."


async def open_manual(params: FunctionCallParams, page: int = 0):
    """Open the machine's manual on the operator's screen, at the pages a manual \
answer came from, or at what's on their screen (a paused video or a photo) if \
that is newer. Use when the operator asks to see it: "open it", "show me that", \
"show me the page", "open the manual for this".

    Args:
        page: 0 (the default) opens what the operator means now: what's on their \
screen or the most recent manual answer, whichever is newer. Pass 0 for "this" \
or "it". To open an earlier answer, pass one of its manual_pages; or pass a page \
number the operator asks for.
    """
    found = await find_pages(page)
    if isinstance(found, str):
        await reply_directly(params, found, {"opened": None, "reason": found})
        return
    pages, topic = found
    await show_manual_pages(params.llm, pages, topic)
    spoken = f"I've opened {pages.label()} of the manual on your screen."
    await reply_directly(params, spoken, {"opened": [pages.first, pages.last], "topic": topic})
