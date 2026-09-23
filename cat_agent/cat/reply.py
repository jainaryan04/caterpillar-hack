"""Let a tool speak its own answer, skipping the voice LLM's second call."""

from pipecat.frames.frames import (
    FunctionCallResultProperties,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.services.llm_service import FunctionCallParams


async def reply_directly(params: FunctionCallParams, spoken: str, result: dict) -> None:
    """Record `result` as the tool result and say `spoken` as Cat's reply.

    Normally the voice LLM runs again to turn a tool result into words (~0.5-0.9s).
    When the tool already has voice-ready text, it's emitted as if the LLM had
    said it: TTS speaks it and it lands in the conversation as Cat's reply.
    """
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))
    for frame in (LLMFullResponseStartFrame(), LLMTextFrame(spoken), LLMFullResponseEndFrame()):
        await params.llm.push_frame(frame)
