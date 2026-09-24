"""Endpoints for the operator app (app/, Expo), in the app's own types.

The app talks to its backend through service interfaces (app/src/services/types.ts).
These endpoints return exactly what those interfaces expect, so connecting it is
a matter of calling them:

    VideoService.getLibrary / getVideo  ->  GET  /api/app/videos, /api/app/videos/{id}   TrainingVideo
    AgentService.sendMessage            ->  POST /api/app/agent/message                   AgentResponse
    MediaService.analyzeMachineryPhoto  ->  POST /api/app/photo/analyze (multipart)       ImageAnalysis
    (circle again on the same photo)    ->  POST /api/app/photo/mark                      ImageAnalysis
    ("open it": the manual pages)       ->  GET  /api/app/manual/open                     ManualPagesView
    (push-to-talk, no live voice)       ->  POST /api/app/voice (multipart)               AgentResponse + audioUrl

Every answer comes from the Cat 320D manual (RAG), in one of three ways:
  - a general question ("how do I wear the seat belt?") -> hybrid search + machine expert;
  - a question about what's on screen ("what does this do?" with a paused video
    in `context`) -> the video's index says what's there, then the manual section;
  - a photo with a circle (or tap) -> the circled control, then its manual section.
Answers also carry a few extras the app can use (camelCase): `manual` (pages),
`imageUrl` (the manual's picture), `annotatedUrl` / `manualCloseups` (for photos).

URLs in responses are absolute, built from the address the app called.
"""

import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from cat.display import IMAGE_URL_PREFIX, PAGES_URL_PREFIX
from cat.memory import get_manual_memory
from cat.screen import LOCAL_SESSION, get_screen_store
from cat.specialists.machine_expert import ExpertAnswer, answer_from_manual, remember_answer
from cat.tools.manual import find_pages
from cat.tools.screen import NOTHING_ON_SCREEN, answer_about_screen
from cat.video_index import get_video, videos

MANUAL_SOURCE = "Cat 320D Operation & Maintenance Manual"
MAX_PHOTO_BYTES = 12 * 1024 * 1024

# Words that point at the screen rather than name something ("what does THIS do?").
_POINTING = re.compile(
    r"\b(this|that|these|those|here|circled?|highlighted|tapped|marked|on (the |my )?screen|"
    r"in (the |my |this )?(photo|picture|pic|image|video|frame)|number \d+)\b",
    re.IGNORECASE,
)

# Asking about Cat's last answer rather than naming something ("explain it in simple words").
_FOLLOW_UP = re.compile(
    r"\b(simple|simpler|simply|plain|easier|easy words|layman|(don't|do not|didn't|did not) (get|understand)|"
    r"what do you mean|what does that mean|explain( it| that| this)? (again|more|better|properly)|"
    r"say (it|that) again|repeat|more detail|elaborate|rephrase|in other words)\b",
    re.IGNORECASE,
)
FOLLOW_UP_MAX_AGE_SECS = 10 * 60

# "What should I do next?": answered from the task list the phone sends with each question
# (Cat has no access to the plan itself). Anchored so manual questions ("what should I do before starting the engine?") don't match.
_TASK_QUESTION = re.compile(
    r"\b(my|next|today'?s?|current|remaining|pending|assigned)\s+(tasks?|jobs?|assignments?|work)\b"
    r"|\b(tasks?|jobs?)\s+(for\s+)?today\b"
    r"|\b(which|what)\s+(tasks?|jobs?)\s+(should|do|shall|can|is|are|have|next)\b"
    r"|\bwhich\s+(task|job)\b"
    r"|\bwhat('?s| is)\s+next\b"
    r"|\bwhat\s+(should|do|shall|can)\s+i\s+(do|work on|start)(\s+(next|now|today|first))?\W*$",
    re.IGNORECASE,
)

# How each video appears in the app's library (TrainingVideo fields the index doesn't have).
VIDEO_INFO = {
    "controls-tour": {
        "summary": "Every numbered control in the cab, from the Cat 320D manual: what it does and where it is.",
        "category": "machinery",
        "required": True,
    },
    "start-to-finish": {
        "summary": "Getting on, seat belt, starting and stopping the engine, and leaving the machine safely.",
        "category": "safety",
        "required": True,
    },
    "cat-320d-overview": {
        "summary": "Caterpillar's official overview of the 320D Series 2.",
        "category": "machinery",
        "required": False,
    },
}

router = APIRouter(prefix="/api/app", tags=["operator app"])


# ---------- the app's types (app/src/types) ----------


class Camel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class AgentContext(Camel):
    taskId: str | None = None
    videoId: str | None = None
    timestamp: float | None = Field(None, description="Playback position in seconds")
    videoTitle: str | None = None
    chapterTitle: str | None = None
    taskTitle: str | None = None
    imageUri: str | None = Field(None, description="Set when the question is about the photo just analysed")
    # Extras: where the operator pointed on the paused frame (0-1 across and down).
    tap: tuple[float, float] | None = None
    circle: list[tuple[float, float]] | None = None


class ShiftTask(Camel):
    """One of the operator's tasks as the phone has it (app/src/services/local/shiftTasks.ts)."""

    id: str
    title: str
    machine: str = ""
    location: str = ""
    status: str = "pending"  # pending | in_progress | completed | blocked | cancelled
    priority: str = "normal"
    scheduledStart: str = ""  # HH:mm
    safety: list[str] = []


@dataclass
class TaskAnswer(ExpertAnswer):
    """An answer about the shift plan; `task_id` is the task to open."""

    task_id: str | None = None


class MessageIn(Camel):
    message: str
    context: AgentContext | None = None
    sessionId: str = LOCAL_SESSION
    tasks: list[ShiftTask] | None = Field(None, description="The operator's tasks, for \"what should I do next?\"")
    mode: str = Field("auto", description="auto | manual (general question) | screen (about the screen)")


class Mark(Camel):
    circle: list[tuple[float, float]] | None = None
    tap: tuple[float, float] | None = None
    question: str | None = None
    sessionId: str = LOCAL_SESSION


# ---------- helpers ----------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _absolute(request: Request, url: str | None) -> str | None:
    return f"{str(request.base_url).rstrip('/')}{url}" if url and url.startswith("/") else url


def _mmss(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def _citations(answer: ExpertAnswer, seen: dict | None) -> list[dict]:
    citations = []
    if answer.page:
        pages = f"p. {answer.page}" if answer.page_end in (None, answer.page) else f"pp. {answer.page}-{answer.page_end}"
        citations.append({"source": MANUAL_SOURCE, "locator": f"{pages}" + (f" · {answer.topic}" if answer.topic else "")})
    if seen and seen.get("kind") == "video" and seen.get("video_id"):
        video = get_video(seen["video_id"])
        if video:
            citations.append({"source": video.title, "locator": _mmss(seen.get("t", 0))})
    return citations


def _extras(request: Request, answer: ExpertAnswer, seen: dict | None) -> dict:
    extras = {
        "manual": {"page": answer.page, "pageEnd": answer.page_end, "topic": answer.topic} if answer.page else None,
        "imageUrl": _absolute(request, f"{IMAGE_URL_PREFIX}{answer.image.path.name}") if answer.image else None,
    }
    if seen:
        extras["screen"] = {
            "kind": seen.get("kind"),
            "headline": seen.get("headline"),
            "meant": seen.get("meant", []),
            "annotatedUrl": _absolute(request, seen.get("annotated_url")),
            "manualCloseups": [
                {"callout": c["callout"], "url": _absolute(request, c["url"])} for c in seen.get("manual_closeups", [])
            ],
            "recognized": seen.get("recognized"),
        }
    return extras


def _agent_response(request: Request, answer: ExpertAnswer, seen: dict | None, kind: str, ms: float) -> dict:
    return {
        "id": _id("MSG"),
        "text": answer.text,
        "citations": _citations(answer, seen),
        "actions": [{"type": "OPEN_TASK", "taskId": answer.task_id}]
        if isinstance(answer, TaskAnswer) and answer.task_id
        else [{"type": "ANSWER"}],
        "createdAt": _now(),
        # extras
        "kind": kind,  # "manual" (general RAG) | "screen" (paused video / photo) | "task" (shift plan)
        **_extras(request, answer, seen),
        "ms": round(ms),
    }


def _image_analysis(request: Request, answer: ExpertAnswer | None, seen: dict, ms: float) -> dict:
    """An answer about a photo, as the app's ImageAnalysis."""
    controls = [c for c in seen.get("controls", []) if c.get("emphasis")]
    recognized = seen.get("recognized")
    matched = seen.get("matched", False)
    if matched and controls:
        limitations = ("Identified by matching your photo to a known Cat 320D console layout. "
                       "Compare it with the manual picture before acting on it.")
        confidence = "high" if any(("circled" in c["emphasis"] or "tapped" in c["emphasis"]) for c in controls) else "medium"
    elif recognized and controls:
        best = recognized[0]
        limitations = (f"Recognised by shape only ({best['part']}, {best['score']:.0%} sure): the photo didn't match a known "
                       "Cat 320D layout, so it may be a different machine or angle.")
        confidence = "medium" if best["score"] >= 0.6 else "low"
    else:
        limitations = "No known 320D control was found where you pointed."
        confidence = "low"
    findings = [
        {"label": f"{c['name']} (callout {c['callout']}) · manual p. {c['page']}", "severity": "info"} for c in controls
    ]
    if answer and answer.page:
        recommended = f"See the {MANUAL_SOURCE}, page {answer.page}" + (f" ({answer.topic})." if answer.topic else ".")
    else:
        recommended = "Circle a single switch or lever and ask again, or tell Cat its name."
    return {
        "id": _id("IMG"),
        "summary": answer.text if answer else NOTHING_ON_SCREEN,
        "findings": findings,
        "limitations": limitations,
        "recommendedAction": recommended,
        "confidence": confidence,
        "createdAt": _now(),
        # extras
        "citations": _citations(answer, seen) if answer else [],
        **(_extras(request, answer, seen) if answer else {"screen": None}),
        "ms": round(ms),
    }


def _training_video(request: Request, video) -> dict:
    info = VIDEO_INFO.get(video.id, {})
    chapters, last = [], None
    for segment in video.segments:
        title = (segment.get("caption") or "").split(" · ")[0].strip()
        if segment.get("kind") == "footage":
            title = " ".join(segment.get("on_screen_text", [])) or ""
        if title and title != last:
            chapters.append({"title": title, "startsAt": segment["start"]})
            last = title
    return {
        "id": video.id,
        "title": video.title,
        "summary": info.get("summary", video.source),
        "category": info.get("category", "machinery"),
        "durationSeconds": round(video.duration),
        "videoUrl": _absolute(request, video.url),
        "chapters": chapters,
        "progressSeconds": 0,
        "completed": False,
        "required": info.get("required", False),
        "machineType": "excavator",
        # extras
        "posterUrl": _absolute(request, video.poster),
        "subtitlesUrl": _absolute(request, video.subtitles),
    }


# ---------- endpoints ----------


@router.get("/videos")
def app_videos(request: Request):
    """TrainingVideo[] for the learning library."""
    return [_training_video(request, v) for v in videos().values()]


@router.get("/videos/{video_id}")
def app_video(request: Request, video_id: str):
    video = get_video(video_id)
    if video is None:
        raise HTTPException(404, "no such video")
    return _training_video(request, video)


@router.post("/agent/message")
async def agent_message(request: Request, body: MessageIn):
    """AgentService.sendMessage: an AgentResponse answered from the manual.

    With `context.videoId` + `context.timestamp` the paused frame becomes what's on
    screen (optionally `context.tap` / `context.circle`). Questions that point at
    the screen ("this", "that", "the one I circled", "in the photo") are answered
    from it; questions that name something are answered by manual search.
    `mode` forces one or the other.
    """
    t0 = time.perf_counter()
    answer, seen, kind = await _answer(body.message, body.context, body.sessionId, body.mode, body.tasks)
    return _agent_response(request, answer, seen, kind, 1000 * (time.perf_counter() - t0))


_SHIFT_TASKS = TypeAdapter(list[ShiftTask])


def _spoken(text: str) -> str:
    return text.replace(" · ", ", ")


def _clock(hhmm: str) -> str:
    return hhmm.removeprefix("0")  # "09:30" -> "9:30", as it's said


def _task_answer(tasks: list[ShiftTask] | None) -> TaskAnswer:
    """What to do next, from the phone's task list: the task in progress, else the next one due."""
    if not tasks:
        return TaskAnswer("I can't see your task list yet. Open the Home tab, then ask me again.")
    left = [t for t in tasks if t.status in ("in_progress", "pending")]
    if not left:
        return TaskAnswer("You've finished all your tasks for this shift. Nice work.")
    left.sort(key=lambda t: (t.status != "in_progress", t.scheduledStart))
    now, later = left[0], left[1:3]
    where = f"{_spoken(now.machine)}, at {_spoken(now.location)}" if now.location else _spoken(now.machine)
    if now.status == "in_progress":
        text = f"You're in the middle of {now.title}, {where}. Finish that first."
    else:
        text = f"Your next task is {now.title}, {where}"
        text += f", at {_clock(now.scheduledStart)}." if now.scheduledStart else "."
        if now.priority == "high":
            text += " It's high priority."
        if now.safety:
            text += " Before you start: " + "; ".join(s.rstrip(".") for s in now.safety) + "."
    if later:
        text += " After that, " + ", then ".join(
            f"{t.title}" + (f" at {_clock(t.scheduledStart)}" if t.scheduledStart else "") for t in later
        ) + "."
    return TaskAnswer(text, task_id=now.id)


async def _answer(
    message: str, ctx: AgentContext | None, session_id: str, mode: str = "auto", tasks: list[ShiftTask] | None = None
) -> tuple[ExpertAnswer, dict | None, str]:
    """(answer, what was on screen, "screen" | "manual") for a question, typed or spoken."""
    from cat.server import report_video_pause  # avoid an import cycle

    if _TASK_QUESTION.search(message):
        return _task_answer(tasks), None, "task"
    ctx = ctx or AgentContext()
    if ctx.videoId is not None and ctx.timestamp is not None:
        try:
            await report_video_pause(ctx.videoId, ctx.timestamp, ctx.tap, session_id, ctx.circle)
        except KeyError:
            raise HTTPException(404, f"no such video: {ctx.videoId}")
    on_screen = get_screen_store().get(session_id) is not None
    points = bool(_POINTING.search(message)) or ctx.tap is not None or ctx.circle is not None
    # "What does this do?" with nothing on screen is about the screen too: Cat says it can't see
    # anything, rather than searching the manual for "this".
    use_screen = mode == "screen" or (mode == "auto" and (points or (on_screen and ctx.imageUri)))
    if use_screen:
        answer, seen = await answer_about_screen(message, session_id)
        if answer is None:
            answer, seen = ExpertAnswer(NOTHING_ON_SCREEN), None
        remember_answer(message, answer)
        return answer, seen, "screen"
    last = get_manual_memory().last()
    follows_up = last and _FOLLOW_UP.search(message) and time.monotonic() - last.at < FOLLOW_UP_MAX_AGE_SECS
    answer = await answer_from_manual(message, earlier=last if follows_up else None)
    remember_answer(message, answer)
    return answer, None, "manual"


@router.post("/photo/analyze")
async def photo_analyze(
    request: Request,
    file: UploadFile = File(..., description="The photo (JPEG/PNG)"),
    question: str = Form("What is this?"),
    circle: str | None = Form(None, description="JSON [[x, y], ...], 0-1 across and down the photo"),
    tapX: float | None = Form(None),
    tapY: float | None = Form(None),
    sessionId: str = Form(LOCAL_SESSION),
):
    """MediaService.analyzeMachineryPhoto: upload, (optionally) circle, and answer in one call."""
    from cat.server import report_photo

    t0 = time.perf_counter()
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "photo too large")
    try:
        points = json.loads(circle) if circle else None
    except json.JSONDecodeError:
        raise HTTPException(400, "circle must be JSON [[x, y], ...]")
    tap = (tapX, tapY) if tapX is not None and tapY is not None else None
    try:
        await report_photo(data, tap, sessionId, points)
    except ValueError:
        raise HTTPException(400, "not an image")
    answer, seen = await answer_about_screen(question or "What is this?", sessionId)
    if answer:
        remember_answer(question, answer)
    return _image_analysis(request, answer, seen, 1000 * (time.perf_counter() - t0))


@router.post("/photo/mark")
async def photo_mark(request: Request, body: Mark):
    """Circle (or tap) again on the photo already sent, and answer. No re-upload or re-matching."""
    from cat.server import report_mark

    t0 = time.perf_counter()
    try:
        await report_mark(body.tap, body.circle, body.sessionId)
    except LookupError:
        raise HTTPException(409, "no photo yet: call /api/app/photo/analyze first")
    question = body.question or "What's this one I circled?"
    answer, seen = await answer_about_screen(question, body.sessionId)
    if answer:
        remember_answer(question, answer)
    return _image_analysis(request, answer, seen, 1000 * (time.perf_counter() - t0))


@router.get("/manual/open")
async def manual_open(request: Request, sessionId: str = LOCAL_SESSION, page: int = 0):
    """ "Open it": the manual pages of the last answer (or of what's on screen, if newer), as an image."""
    found = await find_pages(page, sessionId)
    if isinstance(found, str):
        return {"opened": False, "message": found}
    pages, topic = found
    return {
        "opened": True,
        "message": f"Opened {pages.label()} of the manual.",
        "page": pages.first,
        "pageEnd": pages.last,
        "topic": topic,
        "url": _absolute(request, f"{PAGES_URL_PREFIX}{pages.path.name}"),
        "width": pages.width,
        "height": pages.height,
    }


@router.post("/screen/clear")
def screen_clear(body: Mark):
    """The video is playing again (or the photo was dismissed): "this" no longer means it."""
    get_screen_store().clear(body.sessionId)
    return {"cleared": True}


# ---------- push-to-talk ----------

MAX_AUDIO_BYTES = 10 * 1024 * 1024
DIDNT_CATCH = "I didn't catch that. Tap the mic and ask again."
# "Open it", "show me the page", "open the manual for this": show pages, don't search.
_OPEN_IT = re.compile(r"\b(open|show)\b.*\b(it|that|this|page|pages|manual)\b", re.IGNORECASE)


@router.post("/voice")
async def voice(
    request: Request,
    file: UploadFile = File(..., description="The recorded question (m4a / 3gp / wav)"),
    context: str | None = Form(None, description="JSON AgentContext, as for /agent/message"),
    sessionId: str = Form(LOCAL_SESSION),
    tasks: str | None = Form(None, description="JSON list of ShiftTask, as for /agent/message"),
):
    """Push-to-talk: a recorded question in, an AgentResponse plus Cat's spoken answer out.

    For phones without the live voice session (Expo Go). Extras: `transcript` (what
    Cat heard, without "Hey Cat"), `audioUrl` (MP3 of the answer) and, for "open
    it", `pages` (the manual pages, as GET /manual/open returns them).
    """
    from cat.speech import queue_reply, transcribe
    from cat.wake_word import strip_wake_phrase

    t0 = time.perf_counter()
    audio = await file.read(MAX_AUDIO_BYTES + 1)
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "recording too long")
    try:
        ctx = AgentContext.model_validate_json(context) if context else None
    except ValueError:
        raise HTTPException(400, "context must be a JSON AgentContext")
    try:
        heard = await transcribe(audio, file.content_type)
    except Exception as e:
        raise HTTPException(502, f"speech-to-text failed: {e}")
    question = strip_wake_phrase(heard).strip(" ,.")
    t_heard = time.perf_counter()

    pages = None
    if not question:
        answer, seen, kind = ExpertAnswer(DIDNT_CATCH), None, "none"
    elif _OPEN_IT.search(question):
        found = await find_pages(0, sessionId)
        if isinstance(found, str):
            answer, seen, kind = ExpertAnswer(found), None, "manual"
        else:
            opened, topic = found
            answer, seen, kind = ExpertAnswer(f"I've opened {opened.label()} of the manual."), None, "manual"
            pages = {
                "page": opened.first,
                "pageEnd": opened.last,
                "topic": topic,
                "url": _absolute(request, f"{PAGES_URL_PREFIX}{opened.path.name}"),
                "width": opened.width,
                "height": opened.height,
            }
    else:
        try:
            shift = _SHIFT_TASKS.validate_json(tasks) if tasks else None
        except ValueError:
            shift = None  # an unreadable list only costs the task answer
        answer, seen, kind = await _answer(question, ctx, sessionId, tasks=shift)

    # The phone plays this URL; speech is made while it streams (see voice_audio).
    audio_url = _absolute(request, f"/api/app/voice/{queue_reply(answer.text)}.mp3")
    t_end = time.perf_counter()
    logger.info(
        f"PUSH-TO-TALK: {question!r} -> {answer.text!r} "
        f"(heard {1000 * (t_heard - t0):.0f}ms, answer {1000 * (t_end - t_heard):.0f}ms)"
    )
    return {
        **_agent_response(request, answer, seen, kind, 1000 * (t_end - t0)),
        "transcript": question,
        "audioUrl": audio_url,
        "pages": pages,
    }


@router.get("/voice/{reply_id}.mp3")
async def voice_audio(reply_id: str):
    """A push-to-talk answer spoken in Cat's voice, streamed as it's synthesised."""
    from cat.speech import reply_text, stream_speech

    text = reply_text(reply_id)
    if text is None:
        raise HTTPException(404, "no such reply (they expire after 10 minutes)")
    return StreamingResponse(stream_speech(text), media_type="audio/mpeg")
