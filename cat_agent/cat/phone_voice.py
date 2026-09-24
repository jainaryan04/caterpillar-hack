"""Voice sessions from the phone app, over WebRTC (Pipecat SmallWebRTC).

The laptop runs Cat on its own mic and speakers (main.py). This lets the
operator app run the same voice loop from the phone instead: the app opens a
WebRTC connection (Pipecat client SDK, RNSmallWebRTCTransport) and gets the
exact pipeline main.py builds -- "Hey Cat" wake phrase, Deepgram in and out,
manual tools, and the RTVI server messages for manual pictures and pages.

    POST  /api/offer   SDP offer from the app -> SDP answer (starts a session)
    PATCH /api/offer   trickled ICE candidates

Each connection gets its own pipeline worker, cancelled when the phone
disconnects. Needs the pipecat-ai `webrtc` extra (aiortc).
"""

import asyncio

from fastapi import APIRouter
from loguru import logger
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

from cat.config import load_config
from cat.pipeline import build_worker
from cat.voice_owner import phone_connected, phone_disconnected

router = APIRouter(tags=["phone voice"])
_handler = SmallWebRTCRequestHandler()
# Keep references so running sessions aren't garbage-collected.
_sessions: set[asyncio.Task] = set()


async def _run_session(connection: SmallWebRTCConnection) -> None:
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    worker = build_worker(transport, load_config())
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"PHONE: voice session connected ({connection.pc_id})")
        phone_connected(connection.pc_id)  # the laptop's own voice session goes quiet

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info(f"PHONE: voice session ended ({connection.pc_id})")
        phone_disconnected(connection.pc_id)
        await runner.cancel(reason="phone disconnected")

    try:
        await runner.run()
    finally:
        # However it ended (hang-up, dropped network, error), give the laptop its voice back.
        phone_disconnected(connection.pc_id)


@router.post("/api/offer")
async def offer(request: SmallWebRTCRequest):
    """Start (or renegotiate) a phone voice session."""

    async def on_connection(connection: SmallWebRTCConnection) -> None:
        task = asyncio.create_task(_run_session(connection))
        _sessions.add(task)
        task.add_done_callback(_sessions.discard)

    return await _handler.handle_web_request(request=request, webrtc_connection_callback=on_connection)


@router.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    await _handler.handle_patch_request(request)
    return {"status": "success"}
