"""Run Cat locally: talks through your laptop mic and speakers.

    uv run main.py
"""

import asyncio
import sys

from loguru import logger
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
from pipecat.workers.runner import WorkerRunner

from cat.config import load_config
from cat.pipeline import build_worker


async def main():
    cfg = load_config()

    # The transport is the only thing tied to "where the audio comes from".
    # Later this can become a WebRTC transport (browser / in-cab tablet) without
    # touching the rest of the pipeline.
    transport = LocalAudioTransport(
        LocalAudioTransportParams(audio_in_enabled=True, audio_out_enabled=True)
    )

    worker = build_worker(transport, cfg)
    runner = WorkerRunner(handle_sigint=True)
    await runner.add_workers(worker)

    logger.info(
        f"Cat is listening (STT=deepgram/{cfg.stt_model}, LLM={cfg.llm_provider}/{cfg.llm_model}, "
        f"TTS={cfg.tts_provider}/{cfg.tts_voice}). Press Ctrl+C to stop."
    )
    await runner.run()


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    asyncio.run(main())
