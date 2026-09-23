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

Built on Pipecat's WakePhraseUserTurnStartStrategy, which on its own only goes
back to sleep after a period of silence - long enough for side conversations
to be answered. CatWakeStrategy adds "sleep once Cat starts replying".

Deepgram often writes the name as "Kat", so both spellings are accepted, and
the STT is told to favour the word "Cat" (keyterm boost, cat/services.py).
"""

import re

from loguru import logger

from pipecat.turns.user_start import WakePhraseUserTurnStartStrategy
from pipecat.turns.user_start.wake_phrase_user_turn_start_strategy import _WakeState

# "pay cat" / "they cat": mis-hearings of "Hey Cat" seen in tests ("PayCat.",
# "They cat."). Not "the cat" or "big cat": real speech could trigger those.
_GREETINGS = ("hey", "hi", "hay", "okay", "ok", "pay", "they")

WAKE_PHRASES = [f"{greeting} {name}" for greeting in _GREETINGS for name in ("cat", "kat")]

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
