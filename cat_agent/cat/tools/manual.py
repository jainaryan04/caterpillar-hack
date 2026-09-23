"""Open the manual on screen at what Cat just talked about ("open it", "show me that").

ask_machine_expert remembers which pages each answer came from (cat/memory.py);
this tool renders those pages (cat/rag/pages.py) and puts them on the
operator's screen (cat/display.py). No search and no LLM call, so it's quick.
"""

import asyncio

from loguru import logger
from pipecat.services.llm_service import FunctionCallParams

from cat.display import show_manual_pages
from cat.memory import get_manual_memory
from cat.rag.pages import page_count, render_pages
from cat.reply import reply_directly


async def open_manual(params: FunctionCallParams, page: int = 0):
    """Open the machine's manual on the operator's screen, at the pages a manual \
answer came from. Use when the operator asks to see it after a manual answer: \
"open it", "show me that", "show me the page", "open the manual".

    Args:
        page: 0 (the default) opens the pages of the most recent manual answer. \
To open an earlier answer, pass one of its manual_pages; or pass a page number \
the operator asks for.
    """
    memory = get_manual_memory()
    lookup = memory.on_page(page) if page else memory.last()
    if lookup:
        first, last, topic = lookup.page, lookup.page_end, lookup.topic
    elif page:
        pages_in_manual = await asyncio.to_thread(page_count)
        if not 1 <= page <= pages_in_manual:
            spoken = f"The manual only has {pages_in_manual} pages."
            await reply_directly(params, spoken, {"opened": None, "reason": spoken})
            return
        first, last, topic = page, page, ""
    else:
        spoken = "I haven't looked anything up in the manual yet. Ask me about a control or a task first."
        await reply_directly(params, spoken, {"opened": None, "reason": "nothing looked up yet"})
        return

    try:
        pages = await asyncio.to_thread(render_pages, first, last)
    except Exception as e:
        logger.error(f"Couldn't render manual pages {first}-{last}: {e}")
        spoken = "I couldn't open the manual just now."
        await reply_directly(params, spoken, {"opened": None, "reason": str(e)})
        return

    await show_manual_pages(params.llm, pages, topic)
    spoken = f"I've opened {pages.label()} of the manual on your screen."
    await reply_directly(params, spoken, {"opened": [pages.first, pages.last], "topic": topic})
