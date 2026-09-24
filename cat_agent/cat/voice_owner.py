"""One voice at a time: while a phone runs a voice session, the laptop's goes quiet.

main.py runs Cat on the laptop's mic and speakers; cat/phone_voice.py runs a
second copy of the pipeline for each phone. Both would hear "Hey Cat" in the
same room and answer twice, so while any phone is connected the laptop's copy
is deaf (its mic audio is replaced with silence) and mute (its speaker audio
is dropped). It comes back when the last phone disconnects.

Silence rather than no audio: Deepgram closes a stream that stops sending,
and Silero VAD then sees the operator stop talking.
"""

from loguru import logger
from pipecat.frames.frames import Frame, InputAudioRawFrame, OutputAudioRawFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

_phones: set[str] = set()


def phone_connected(session_id: str) -> None:
    _phones.add(session_id)


def phone_disconnected(session_id: str) -> None:
    _phones.discard(session_id)


def phone_live() -> bool:
    return bool(_phones)


class LaptopMicGate(FrameProcessor):
    """Right after the laptop mic: silence while a phone is live, and cut off
    whatever the laptop was saying or working on when the phone connects."""

    def __init__(self):
        super().__init__()
        self._muted = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame):
            live = phone_live()
            if live != self._muted:
                self._muted = live
                if live:
                    logger.info("Laptop mic and speaker off: a phone voice session is live")
                    await self.broadcast_interruption()
                else:
                    logger.info("Laptop mic and speaker back on: no phone voice session")
            if live:
                frame.audio = bytes(len(frame.audio))
        await self.push_frame(frame, direction)


class LaptopSpeakerGate(FrameProcessor):
    """Right before the laptop speaker: drop Cat's audio while a phone is live
    (e.g. a manual lookup that was already running when the phone connected)."""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, OutputAudioRawFrame) and phone_live():
            return
        await self.push_frame(frame, direction)
