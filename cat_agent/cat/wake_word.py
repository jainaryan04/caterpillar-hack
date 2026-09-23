"""Wake word: Cat only listens after "Hey Cat", for one request at a time.

  asleep  every transcript without the wake phrase is thrown away before the
          LLM, so talking to the person next to you costs nothing and gets
          no reply
  "Hey Cat, what does the AEC switch do?"
          wakes Cat, that turn goes to the LLM straight away, and Cat goes
          back to sleep as soon as it starts answering - while it works and
          talks, only "Hey Cat ..." (e.g. "Hey Cat, stop") gets through
  "Hey Cat." on its own
          Cat says "Yes?" and stays awake for the question that follows (for
          up to CAT_WAKE_TIMEOUT_SECS), then sleeps again after answering it

Speech-to-text sometimes ends the operator's turn mid-sentence ("Hey Cat, can
you tell me..." / "...about the fire extinguisher?"). Words that start within
FOLLOW_ON_SECS of the end of a request still count as part of it, even though
Cat has already gone back to sleep.

Built on Pipecat's WakePhraseUserTurnStartStrategy, which on its own only goes
back to sleep after a period of silence - long enough for side conversations
to be answered. CatWakeStrategy adds "sleep once Cat starts replying".

Deepgram often writes the name as "Kat", so both spellings are accepted, and
the STT is told to favour the word "Cat" (keyterm boost, cat/services.py).
"""

import re
import time

from loguru import logger

from pipecat.frames.frames import Frame, InterimTranscriptionFrame, TranscriptionFrame
from pipecat.turns.types import ProcessFrameResult
from pipecat.turns.user_start import WakePhraseUserTurnStartStrategy
from pipecat.turns.user_start.wake_phrase_user_turn_start_strategy import _WakeState

# "pay cat" / "they cat": mis-hearings of "Hey Cat" seen in tests ("PayCat.",
# "They cat."). Not "the cat" or "big cat": real speech could trigger those.
_GREETINGS = ("hey", "hi", "hay", "okay", "ok", "pay", "they")

WAKE_PHRASES = [f"{greeting} {name}" for greeting in _GREETINGS for name in ("cat", "kat")]

# Speech starting this soon after a request ends is the rest of that request.
# Long enough for a mid-sentence pause, short enough that side talk after
# Cat's answer is still ignored.
FOLLOW_ON_SECS = 2.0

WAKE_WORDS = {word for phrase in WAKE_PHRASES for word in phrase.split()}

# The greeting is optional here: speech-to-text sometimes delivers "Hey," and
# "Cat." as two pieces, and the turn then holds just "Cat.".
_WAKE_PREFIX = re.compile(rf"^\W*(?:(?:{'|'.join(_GREETINGS)})\W*)?[ck]at\b\W*", re.IGNORECASE)


def strip_wake_phrase(text: str) -> str:
    """ "Hey, Cat. How do I wear the seat belt?" -> "How do I wear the seat belt?" """
    return _WAKE_PREFIX.sub("", text)


class CatWakeStrategy(WakePhraseUserTurnStartStrategy):
    """Pipecat's wake phrase gate, plus going back to sleep after each answer.

    `timeout` only applies while Cat waits for the question after a bare "Hey Cat".
    """

    def __init__(self, *, timeout: float):
        super().__init__(phrases=WAKE_PHRASES, timeout=timeout)
        self._request_pending = False
        self._user_talking = False
        self._request_ended_at = 0.0  # when the last request's turn ended
        self._follow_on_until = 0.0  # carried on talking: accept the final transcript until then

    async def _process_idle(self, frame: Frame) -> ProcessFrameResult:
        if isinstance(frame, (InterimTranscriptionFrame, TranscriptionFrame)) and frame.text.strip():
            now = time.monotonic()
            if now - self._request_ended_at < FOLLOW_ON_SECS:
                # Started talking again right away: wait for the final words.
                self._follow_on_until = max(self._follow_on_until, now + 8)
            if now < self._follow_on_until and isinstance(frame, TranscriptionFrame):
                # The rest of the previous request: let it through as a new turn.
                logger.info(f"(still listening, rest of the request: {frame.text!r})")
                self._follow_on_until = self._request_ended_at = 0.0
                self._state = _WakeState.AWAKE
                self._refresh_timeout()
                await self.trigger_user_turn_started()
                return ProcessFrameResult.STOP
        return await super()._process_idle(frame)

    def _check_wake_phrase(self, text: str) -> bool:
        heard = super()._check_wake_phrase(text)
        if not heard and text.strip():
            logger.info(f"(asleep, ignored: {text!r})")
        return heard

    def user_turn_started(self) -> None:
        self._user_talking = True

    def user_turn_finished(self, text: str) -> None:
        self._user_talking = False
        # A bare "Hey Cat." is not a request: stay awake for the question.
        # Anything else is: Cat handles it, and sleeps as soon as it starts to.
        if strip_wake_phrase(text).strip():
            self._request_pending = True
            self._request_ended_at = time.monotonic()

    def reply_started(self) -> None:
        """Cat started answering (or looking something up): go back to sleep.

        From here on, while Cat works and talks, only "Hey Cat ..." gets through,
        so a side conversation can't cut the answer off. If the operator is still
        mid-sentence (speech-to-text split it), wait for that turn to finish; its
        own reply puts Cat to sleep.
        """
        if self._request_pending and not self._user_talking and self.state == _WakeState.AWAKE:
            self._request_pending = False
            self._transition_to_idle()
