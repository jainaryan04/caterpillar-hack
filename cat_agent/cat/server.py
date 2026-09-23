"""HTTP API for the operator's phone app: videos, "what's on my screen", photos, media.

Runs inside the Cat process (main.py) next to the voice loop, on
CAT_HTTP_HOST:CAT_HTTP_PORT (default 0.0.0.0:8765 so a phone on the same
network can reach it). No auth yet: run it on a trusted network.

    GET  /api/videos                       training videos (title, url, poster, subtitles)
    GET  /api/videos/{video_id}            a video's index: what's on screen when
    POST /api/screen/video                 {"video_id", "t", "tap": [x, y]?, "session_id"?}  paused (or tapped)
    POST /api/screen/playing               {"session_id"?}                                    playing again
    POST /api/screen/photo                 multipart: file, tap_x?, tap_y?, circle?, session_id?  a photo
    POST /api/screen/mark                  {"circle": [[x, y], ...]?, "tap": [x, y]?, "session_id"?}
                                           the operator drew a circle (or tapped) on the photo or paused
                                           frame already on screen; no new upload or matching needed
    GET  /api/screen?session_id=           what Cat currently thinks is on that screen
    POST /api/ask                          {"question", "session_id"?}  text question about the screen
    GET  /videos/..., /manual-images/..., /manual-pages/...   media (Range requests supported)
    GET  /ref                              a bare reference page to try it all in a browser

Every call answers with what Cat now "sees", so the app can show it. Voice
questions ("Hey Cat, what does this do?") read the same state. Heavy work is
done here, before the question: a pause is a lookup, a photo is ~150ms of CPU.
"""

import asyncio
import contextlib
import json
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pydantic import BaseModel

from cat.annotate import SCREEN_DIR, SCREEN_URL_PREFIX, annotate_photo, manual_closeup
from cat.display import IMAGE_URL_PREFIX, PAGES_URL_PREFIX
from cat.part_recognition import box_for, recognize
from cat.photo_match import match_photo
from cat.pointing import CIRCLED, TAPPED
from cat.rag.images import IMAGES_DIR
from cat.rag.pages import PAGES_DIR
from cat.screen import LOCAL_SESSION, apply_recognition, get_screen_store, view_from_photo, view_from_video
from cat.video_index import VIDEOS_DIR, get_video, videos

WEB_DIR = Path(__file__).resolve().parents[1] / "web"
MAX_PHOTO_BYTES = 12 * 1024 * 1024


Point = tuple[float, float]  # 0-1 across and down the picture
MAX_CIRCLE_POINTS = 400


class VideoPause(BaseModel):
    video_id: str
    t: float
    tap: Point | None = None  # where the operator tapped the frame
    circle: list[Point] | None = None  # a circle they drew around what they mean
    session_id: str = LOCAL_SESSION


class Mark(BaseModel):
    tap: Point | None = None
    circle: list[Point] | None = None
    session_id: str = LOCAL_SESSION


def _clean_circle(circle) -> list[Point] | None:
    if not circle:
        return None
    points = [(min(max(float(x), 0.0), 1.0), min(max(float(y), 0.0), 1.0)) for x, y in circle[:MAX_CIRCLE_POINTS]]
    return points if len(points) >= 3 else None


class Session(BaseModel):
    session_id: str = LOCAL_SESSION


class Question(BaseModel):
    question: str
    session_id: str = LOCAL_SESSION


def _cross_reference(view) -> None:
    """The manual's drawing of each control the operator means, for the app to show next to their picture."""
    meant = [vc.control.callout for vc in view.controls if vc.emphasis]
    view.details["meant"] = meant
    view.details["manual_closeups"] = [{"callout": c, "url": url} for c in meant[:3] if (url := manual_closeup(c))]


def _frame_at(video_id: str, t: float):
    """The video frame at t seconds (BGR), for recognising a circled part in real footage."""
    capture = cv2.VideoCapture(str(VIDEOS_DIR / f"{video_id}.mp4"))
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = capture.read()
        return frame if ok else None
    finally:
        capture.release()


async def _recognize_circled(view, image, tap, circle) -> None:
    """No known control positions under the operator's mark: say what the marked part looks like."""
    box = box_for(circle, tap)
    if box is None or image is None:
        return
    recognition = await asyncio.to_thread(recognize, image, box)
    apply_recognition(view, recognition, CIRCLED if circle else TAPPED)


async def report_video_pause(video_id: str, t: float, tap=None, session_id: str = LOCAL_SESSION, circle=None) -> dict:
    """Call from the event loop: real footage starts its manual search here, before the question."""
    video = get_video(video_id)
    if video is None:
        raise KeyError(video_id)
    tap, circle = (tuple(tap) if tap else None), _clean_circle(circle)
    view = view_from_video(video, t, tap, circle)
    footage = (video.segment_at(t) or {}).get("kind") == "footage"
    if (tap or circle) and (footage or view.missed):
        frame = await asyncio.to_thread(_frame_at, video_id, t)
        await _recognize_circled(view, frame, tap, circle)
    _cross_reference(view)
    view.prefetch()
    get_screen_store().set(session_id, view)
    logger.info(f"SCREEN [{session_id}]: {view.headline}")
    return view.as_json()


def report_playing(session_id: str = LOCAL_SESSION) -> None:
    get_screen_store().clear(session_id)


async def _photo_view(data: bytes, match, tap, circle, session_id: str):
    view = view_from_photo(match, tap, circle)
    view.photo = data
    # No known layout (or the circle missed every known control): look at what's inside the mark.
    if (tap or circle) and (match is None or view.missed):
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        await _recognize_circled(view, image, tap, circle)
    meant = [vc.control.callout for vc in view.controls if vc.emphasis]
    recognized = view.details.get("recognized")
    note = f"looks like: {recognized[0]['part']}" if recognized and not view.missed and match is None else None
    if match is not None or tap or circle:
        view.details["annotated_url"] = await asyncio.to_thread(
            annotate_photo, data, match.visible if match else {}, meant if match else [], tap, circle, session_id, note
        )
    _cross_reference(view)
    return view


async def report_photo(data: bytes, tap=None, session_id: str = LOCAL_SESSION, circle=None) -> dict:
    tap, circle = (tuple(tap) if tap else None), _clean_circle(circle)
    match = await asyncio.to_thread(match_photo, data)
    view = await _photo_view(data, match, tap, circle, session_id)
    get_screen_store().set(session_id, view)
    logger.info(f"SCREEN [{session_id}]: {view.headline} pointed: "
                f"{next((vc.control.name for vc in view.controls if vc.emphasis), '-')}")
    return view.as_json()


async def report_mark(tap=None, circle=None, session_id: str = LOCAL_SESSION) -> dict:
    """A circle or tap on what's already on screen: reuses the photo's match (~1ms + drawing)."""
    tap, circle = (tuple(tap) if tap else None), _clean_circle(circle)
    view = get_screen_store().get(session_id)
    if view is None:
        raise LookupError("nothing on screen")
    if view.kind == "video":
        return await report_video_pause(view.details["video_id"], view.details["t"], tap, session_id, circle)
    if view.photo is None:
        raise LookupError("no photo")
    new = await _photo_view(view.photo, view.photo_match, tap, circle, session_id)
    get_screen_store().set(session_id, new)
    logger.info(f"SCREEN [{session_id}]: marked on the photo -> {new.details.get('meant')}")
    return new.as_json()


def create_app() -> FastAPI:
    from cat.app_api import router as app_router

    app = FastAPI(title="Cat operator API")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.include_router(app_router)  # /api/app/...: the operator app's own types (cat/app_api.py)

    @app.get("/api/videos")
    def list_videos():
        return [v.summary() for v in videos().values()]

    @app.get("/api/videos/{video_id}")
    def video_index(video_id: str):
        video = get_video(video_id)
        if video is None:
            raise HTTPException(404, "no such video")
        return {**video.summary(), "segments": video.segments}

    @app.post("/api/screen/video")
    async def screen_video(body: VideoPause):
        try:
            return await report_video_pause(body.video_id, body.t, body.tap, body.session_id, body.circle)
        except KeyError:
            raise HTTPException(404, "no such video")

    @app.post("/api/screen/playing")
    def screen_playing(body: Session):
        report_playing(body.session_id)
        return {"kind": None}

    @app.post("/api/screen/photo")
    async def screen_photo(
        file: UploadFile = File(...),
        tap_x: float | None = Form(None),
        tap_y: float | None = Form(None),
        circle: str | None = Form(None),  # JSON [[x, y], ...]
        session_id: str = Form(LOCAL_SESSION),
    ):
        data = await file.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "photo too large")
        tap = (tap_x, tap_y) if tap_x is not None and tap_y is not None else None
        try:
            points = json.loads(circle) if circle else None
        except json.JSONDecodeError:
            raise HTTPException(400, "circle must be JSON [[x, y], ...]")
        try:
            return await report_photo(data, tap, session_id, points)
        except ValueError:
            raise HTTPException(400, "not an image")

    @app.post("/api/screen/mark")
    async def screen_mark(body: Mark):
        try:
            return await report_mark(body.tap, body.circle, body.session_id)
        except LookupError as e:
            raise HTTPException(409, f"{e}: pause a video or send a photo first")

    @app.get("/api/screen")
    def screen(session_id: str = LOCAL_SESSION):
        view = get_screen_store().get(session_id)
        return view.as_json() if view else {"kind": None}

    @app.post("/api/ask")
    async def ask(body: Question):
        from cat.tools.screen import NOTHING_ON_SCREEN, answer_about_screen

        answer, seen = await answer_about_screen(body.question, body.session_id)
        if answer is None:
            return {"answer": NOTHING_ON_SCREEN, "screen": None}
        return {
            "answer": answer.text,
            "page": answer.page,
            "page_end": answer.page_end,
            "topic": answer.topic,
            "image_url": f"{IMAGE_URL_PREFIX}{answer.image.path.name}" if answer.image else None,
            "screen": seen,
        }

    @app.get("/ref")
    def reference_page():
        return FileResponse(WEB_DIR / "ref.html")

    media = ((IMAGE_URL_PREFIX, IMAGES_DIR), (PAGES_URL_PREFIX, PAGES_DIR), ("/videos/", VIDEOS_DIR), (SCREEN_URL_PREFIX, SCREEN_DIR))
    for prefix, directory in media:
        directory.mkdir(parents=True, exist_ok=True)
        app.mount(prefix.rstrip("/"), StaticFiles(directory=directory), name=prefix.strip("/"))
    return app


class _Server(uvicorn.Server):
    # The voice loop's runner owns Ctrl+C; don't let uvicorn take the signal handlers.
    @contextlib.contextmanager
    def capture_signals(self):
        yield


def make_server(host: str, port: int) -> uvicorn.Server:
    return _Server(uvicorn.Config(create_app(), host=host, port=port, log_level="warning", access_log=False))
