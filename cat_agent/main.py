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
from cat.server import make_server


async def main():
    cfg = load_config()

    # The transport is the only thing tied to "where the audio comes from".
    # Later this can become a WebRTC transport (browser / in-cab tablet) without
    # touching the rest of the pipeline.
    transport = LocalAudioTransport(
        LocalAudioTransportParams(audio_in_enabled=True, audio_out_enabled=True)
    )

    # laptop=True: it goes quiet while a phone runs its own voice session (cat/voice_owner.py).
    worker = build_worker(transport, cfg, laptop=True)
    runner = WorkerRunner(handle_sigint=True)
    await runner.add_workers(worker)

    # The phone app's API (videos, paused frames, photos) runs in the same process,
    # so a voice question can use what the app just reported.
    server = make_server(cfg.http_host, cfg.http_port)
    server_task = asyncio.create_task(server.serve())
    logger.info(f"Operator API on http://localhost:{cfg.http_port} (try /ref)")

    logger.info(
        f"Cat is listening (STT=deepgram/{cfg.stt_model}, LLM={cfg.llm_provider}/{cfg.llm_model}, "
        f"TTS={cfg.tts_provider}/{cfg.tts_voice}). Press Ctrl+C to stop."
    )
    try:
        await runner.run()
    finally:
        server.should_exit = True
        await server_task


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    asyncio.run(main())
