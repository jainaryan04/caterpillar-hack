"""Speech for push-to-talk (POST /api/app/voice): a recorded question in, Cat's voice out.

The live voice loop (cat/pipeline.py) streams audio both ways. Push-to-talk is
for phones without it (Expo Go has no WebRTC): the app records one clip, the
answer comes back as text at once, and its audio streams from a URL while
Deepgram synthesises it. Same Deepgram models as the live loop, over HTTP.
"""

import re
import time
import uuid
from functools import cache

import httpx

from cat.config import load_config

DEEPGRAM = "https://api.deepgram.com/v1"
# Words speech-to-text would otherwise get wrong ("a EC", "three twenty D").
KEYTERMS = ["Cat", "320D", "AEC", "joystick", "hydraulic lockout", "travel alarm", "Hey Cat"]
# Mishearings the keyterms don't always prevent (none of these words are in the manual).
CORRECTIONS = [(re.compile(r"(?<!\w)(?:AAC|EEC|A\.? ?E\.? ?C(?!\w)\.?)(?!\w)", re.IGNORECASE), "AEC")]
KEEP_REPLIES_SECS = 600  # how long a reply's audio stays available


@cache
def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))


def _auth() -> dict:
    return {"Authorization": f"Token {load_config().deepgram_api_key}"}


async def transcribe(audio: bytes, content_type: str | None) -> str:
    """What the operator said in a recorded clip (m4a, 3gp, wav...), or "" if nothing."""
    response = await _client().post(
        f"{DEEPGRAM}/listen",
        params={"model": "nova-3", "smart_format": "true", "keyterm": KEYTERMS},
        headers={**_auth(), "Content-Type": content_type or "audio/mp4"},
        content=audio,
    )
    response.raise_for_status()
    alternatives = response.json()["results"]["channels"][0]["alternatives"]
    text = alternatives[0]["transcript"].strip() if alternatives else ""
    for wrong, right in CORRECTIONS:
        text = wrong.sub(right, text)
    return text


_pending: dict[str, tuple[str, float]] = {}  # reply id -> (text, when)


def queue_reply(text: str) -> str:
    """Keep an answer for GET /api/app/voice/{id}.mp3; returns the id. Speech starts when the phone asks."""
    now = time.time()
    for key in [k for k, (_, at) in _pending.items() if at < now - KEEP_REPLIES_SECS]:
        del _pending[key]
    reply_id = uuid.uuid4().hex[:12]
    _pending[reply_id] = (text, now)
    return reply_id


def reply_text(reply_id: str) -> str | None:
    found = _pending.get(reply_id)
    return found[0] if found else None


async def stream_speech(text: str):
    """Cat's voice saying `text` as MP3 bytes, passed on as Deepgram makes them, so the
    phone starts playing before the whole answer is synthesised."""
    cfg = load_config()
    voice = cfg.tts_voice if cfg.tts_provider == "deepgram" else "aura-2-helena-en"
    async with _client().stream(
        "POST", f"{DEEPGRAM}/speak", params={"model": voice, "encoding": "mp3"}, headers=_auth(), json={"text": text}
    ) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            yield chunk
