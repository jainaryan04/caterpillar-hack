"""Stop Cat hearing itself when it talks through laptop speakers.

Phones and browsers cancel the speaker's sound out of the mic (echo
cancellation); Pipecat's local mic/speaker transport doesn't. So on laptop
speakers the mic hears Cat, speech-to-text transcribes it, and Cat treats
its own words as the operator talking: it interrupts itself, cancels manual
lookups, and answers "Let me check the manual." with "Sure thing!".

The guard compares words instead of sound:
  BotSpeechRecorder (before TTS) remembers what Cat is saying / said recently
  EchoFilter (after STT)         drops transcripts made mostly of those words

For this to also stop echo *interrupting* Cat, the pipeline starts a user
turn from recognised words (MinWordsUserTurnStartStrategy) instead of raw
voice activity, which echo would trigger. Barge-in still works: say two words
Cat isn't saying. The cost: barge-in waits for those words to be
transcribed (~2s in tests, vs ~0.5s when reacting to sound). Word matching also
can't untangle the operator talking *over* loud echo - that needs real echo
cancellation (headphones, or the browser / mobile app).

Turn it off with CAT_ECHO_GUARD=false when using headphones or an app with
its own echo cancellation (the mobile app / browser).
"""

import re
import time
from collections import deque

from loguru import logger
from pipecat.frames.frames import (
    Frame,
    InterimTranscriptionFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

MEMORY_SECS = 20  # speech-to-text can deliver an echo transcript seconds late
ECHO_SHARE = 0.7  # this share of a transcript's words must be Cat's to count as echo

_WORD = re.compile(r"[a-z0-9']+")


_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _number_words(n: int) -> list[str]:
    """94 -> ["ninety", "four"]: Cat writes "page 94", the mic hears "page ninety four"."""
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        return [_TENS[n // 10]] + (_number_words(n % 10) if n % 10 else [])
    if n < 1000:
        return [_ONES[n // 100], "hundred"] + (_number_words(n % 100) if n % 100 else [])
    if n < 10000:
        return _number_words(n // 1000) + ["thousand"] + (_number_words(n % 1000) if n % 1000 else [])
    return [str(n)]


_ORDINALS = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
             "nine": "ninth", "twelve": "twelfth"}


def _ordinal(word: str) -> str:
    """"three" -> "third", "twenty" -> "twentieth", "four" -> "fourth"."""
    if word in _ORDINALS:
        return _ORDINALS[word]
    return word[:-1] + "ieth" if word.endswith("y") else word + "th"


def _words(text: str) -> list[str]:
    words = []
    for word in _WORD.findall(text.lower()):
        digits = re.fullmatch(r"(\d+)(?:st|nd|rd|th)?", word)
        if digits:
            spoken = _number_words(int(digits.group(1)))
            # "23" / "23rd" can come back as "twenty three" or "twenty third".
            words += spoken + [_ordinal(spoken[-1])]
        else:
            words.append(word)
    return words


class _Said:
    def __init__(self, text: str):
        self.update(text)

    def update(self, text: str) -> None:
        self.at, self.words = time.monotonic(), set(_words(text))


class EchoGuard:
    def __init__(self, ignore_words: set[str] = frozenset()):
        # Words that never count as echo: the wake phrase ("hey cat"). Cat says
        # it in its greeting, and the operator's "Hey Cat" must still get through.
        self._ignore = ignore_words
        self._spoken: deque[_Said] = deque()

    def remember(self, text: str) -> _Said:
        said = _Said(text)
        self._spoken.append(said)
        return said

    def is_echo(self, text: str) -> bool:
        words = [w for w in _words(text) if w not in self._ignore]
        if not words:
            return False
        cutoff = time.monotonic() - MEMORY_SECS
        recent = set().union(*(s.words for s in self._spoken if s.at >= cutoff))
        while self._spoken and self._spoken[0].at < cutoff:
            self._spoken.popleft()
        return sum(w in recent for w in words) / len(words) >= ECHO_SHARE


class BotSpeechRecorder(FrameProcessor):
    """Sits just before TTS: remembers what Cat is about to say.

    Recording the text on its way *into* TTS (not after) means it is known
    before the audio plays, so even the first words of the echo are caught.
    """

    def __init__(self, guard: EchoGuard):
        super().__init__()
        self._guard = guard
        self._reply = ""
        self._reply_entry = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMFullResponseStartFrame):
            self._reply, self._reply_entry = "", None
        elif isinstance(frame, LLMTextFrame):
            # The LLM streams tokens ("Pull", " the", " be", "lt"): keep the whole
            # reply so far as one entry, so split words are joined back up.
            self._reply += frame.text
            if self._reply_entry is None:
                self._reply_entry = self._guard.remember(self._reply)
            else:
                self._reply_entry.update(self._reply)
        elif isinstance(frame, TTSSpeakFrame):
            self._guard.remember(frame.text)
        await self.push_frame(frame, direction)


class EchoFilter(FrameProcessor):
    """Sits after STT: drops transcripts that are just Cat's own voice."""

    def __init__(self, guard: EchoGuard):
        super().__init__()
        self._guard = guard

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, (TranscriptionFrame, InterimTranscriptionFrame)) and self._guard.is_echo(frame.text):
            if isinstance(frame, TranscriptionFrame):
                logger.debug(f"echo guard: ignored Cat's own voice: {frame.text!r}")
            return
        await self.push_frame(frame, direction)
