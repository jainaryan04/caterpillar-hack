"""Run Cat locally: talks through your laptop mic and speakers, and serves the phone app.

    uv run main.py
    CAT_LAPTOP_VOICE=false uv run main.py    # phone app only: laptop mic and speakers off
"""

import asyncio
import sys

from loguru import logger
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
from pipecat.workers.runner import WorkerRunner

from cat import part_recognition, photo_match
from cat.config import load_config
from cat.pipeline import build_worker
from cat.rag import sections
from cat.rag.store import get_store
from cat.server import make_server


async def phones_only(cfg):
    """CAT_LAPTOP_VOICE=false: just the API, for the phone app (push-to-talk, /api/offer)."""
    server = make_server(cfg.http_host, cfg.http_port)
    logger.info(f"Operator API on http://localhost:{cfg.http_port}. Laptop mic and speakers are off (CAT_LAPTOP_VOICE=false).")
    # What the laptop session would warm up while saying hello.
    warm = asyncio.gather(
        get_store().warm_up(), *(asyncio.to_thread(m.warm) for m in (sections, photo_match, part_recognition))
    )
    try:
        await server.serve()
    finally:
        warm.cancel()


async def main():
    cfg = load_config()
    if not cfg.laptop_voice:
        await phones_only(cfg)
        return

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
