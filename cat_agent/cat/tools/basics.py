"""Simple, fast tools that run in-process.

A Pipecat "direct function" tool is just an async function:
  - first parameter must be `params: FunctionCallParams`
  - remaining parameters become the tool's arguments (type hints -> JSON schema)
  - the docstring becomes the description the LLM sees, so write it for the LLM
  - deliver the result with `await params.result_callback(...)`
"""

from datetime import datetime

from pipecat.services.llm_service import FunctionCallParams


async def get_current_time(params: FunctionCallParams):
    """Get the current local date and time. Use this when the operator asks what time or day it is."""
    now = datetime.now()
    await params.result_callback(
        {"date": now.strftime("%A, %d %B %Y"), "time": now.strftime("%I:%M %p")}
    )
