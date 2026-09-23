"""Factories for the three AI services in the voice loop: ears (STT), brain (LLM), mouth (TTS).

Swapping a provider only means changing one function here - the pipeline
doesn't care which implementation it gets.
"""

from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.cerebras.llm import CerebrasLLMService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService

from cat.config import Config
from cat.prompts import SYSTEM_PROMPT


def make_stt(cfg: Config) -> STTService:
    # Streams mic audio to Deepgram over a websocket, so the transcript is ready
    # the moment you stop talking.
    return DeepgramSTTService(
        api_key=cfg.deepgram_api_key,
        settings=DeepgramSTTService.Settings(model=cfg.stt_model),
    )


def make_llm(cfg: Config) -> OpenAILLMService:
    if cfg.llm_provider == "cerebras":
        return CerebrasLLMService(
            api_key=cfg.llm_api_key,
            settings=CerebrasLLMService.Settings(
                model=cfg.llm_model,
                system_instruction=SYSTEM_PROMPT,
                # gpt-oss thinks before it answers; keep that short so replies
                # start fast.
                extra={"reasoning_effort": "low"},
            ),
        )

    return OpenAILLMService(
        api_key=cfg.llm_api_key,
        settings=OpenAILLMService.Settings(
            model=cfg.llm_model,
            system_instruction=SYSTEM_PROMPT,
        ),
    )


def make_tts(cfg: Config) -> TTSService:
    if cfg.tts_provider == "cartesia":
        return CartesiaTTSService(
            api_key=cfg.tts_api_key,
            settings=CartesiaTTSService.Settings(voice=cfg.tts_voice),
        )

    return DeepgramTTSService(
        api_key=cfg.tts_api_key,
        settings=DeepgramTTSService.Settings(voice=cfg.tts_voice),
    )
