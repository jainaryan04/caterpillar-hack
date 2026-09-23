# Cat: voice assistant for CAT operators

A real-time voice loop built on [Pipecat](https://github.com/pipecat-ai/pipecat) 1.11. It runs locally on
your laptop's mic and speakers and uses Deepgram for speech and Cerebras for fast LLM inference.

```
mic ─► Silero VAD (local) ─► Deepgram nova-3 ─► Cerebras gpt-oss-120b (+ tools) ─► Deepgram Aura-2 ─► speaker
                                                            │
                                                            └─► ask_machine_expert (OpenAI Agents SDK agent)
                                                                  └─► Cat 320D manual in Pinecone (hybrid search)
phone app ──HTTP──► paused video second / photo ──► what's on screen ──► ask_about_screen ("what does this do?")
```

## Run it

```powershell
cd cat_agent
uv sync                      # first time only
copy .env.example .env       # then fill in the API keys
uv run ingest_manual.py      # first time only: index the machine manual in Pinecone
uv run main.py               # talk to it; Ctrl+C to stop (also serves the phone API on :8765, try /ref)
uv run check_tools.py        # test tools/agents without a mic
uv run ask_screen.py --video controls-tour --t 190 "what does this button do?"   # screen questions, no mic
```

The first run downloads a small NLTK sentence-splitting dataset, so startup can take about 30 seconds.
Later runs start in 1–2 seconds.

## Layout

| Path | What it's for |
|---|---|
| `main.py` | Entry point. Picks the transport (local mic/speaker for now). |
| `cat/pipeline.py` | The voice loop: STT → LLM → TTS, turn-taking and muting. |
| `cat/services.py` | Which STT, LLM and TTS providers to use. Change a provider here. |
| `cat/prompts.py` | Cat's personality and rules. |
| `cat/tools/` | Fast in-process tools. Add a function and list it in `TOOLS`. |
| `cat/specialists/` | Slower multi-step agents (OpenAI Agents SDK) that the voice LLM calls as tools. |
| `cat/rag/` | Manual search: PDF parsing, BM25 keywords, OpenAI embeddings + Pinecone; pictures and page renders. |
| `cat/memory.py` | What Cat has looked up in the manual this session (for "open it"). |
| `cat/controls.py` | The 320D's 27 numbered controls: name, manual section, page, position in the drawings. |
| `cat/video_index.py`, `cat/screen.py` | What's on each operator's screen: a paused video second or a photo. |
| `cat/photo_match.py` | Which controls are in a photo (OpenCV feature matching, no AI model). |
| `cat/pointing.py`, `cat/annotate.py` | Which control a tap or drawn circle means; Cat's marked-up photo and the manual close-up. |
| `cat/server.py`, `web/ref.html` | HTTP API for the phone app, and a bare reference page. |
| `video_build/` | Makes the training videos from the manual, and indexes existing footage. |
| `ingest_manual.py` / `eval_manual.py` | Build the manual index / check retrieval quality and speed. |

## The machine manual (RAG)

Cat answers control, safety and maintenance questions from Caterpillar's official
**Cat 320D Excavator Operation and Maintenance Manual (SEBU8053-20, August 2018)**.
Put the PDF at `data/manuals/cat-320d-omm-SEBU8053-20.pdf` (it is git-ignored); it can be downloaded from
https://www.gawest.com/assets/uploads/CAT-320D.pdf.

- **Chunks:** one per manual topic, and one per control (e.g. "Travel Alarm Cancel Switch (15)"),
  found from the manual's heading font sizes. Each keeps its page and illustration ids.
- **Hybrid search:** every chunk is stored in one Pinecone index as an OpenAI `text-embedding-3-small`
  vector (meaning) plus a BM25 vector (exact words like "AEC"). `CAT_RAG_ALPHA` weights them.
- **Specialist:** `ask_machine_expert` searches first, then one Cerebras call writes a short spoken answer
  with the page number. Cat says "Let me check the manual." while it works.
- **Speed:** the search starts as soon as you stop talking, before the LLM has decided to call the tool.
- **Pictures:** ingest cuts all 409 illustrations out of the PDF into `data/manuals/images/<id>.png`
  (git-ignored). Chunks mark where each picture sits (`[image g00867598]`), and control sections point at
  their numbered overview drawing ("Shown as callout (15) in [image g03666599]"). The agent picks the
  picture that fits, Cat says "I've put the picture from the manual on your screen", and
  `cat/display.py` sends it to the app.

### Pictures in the app

The app receives an RTVI server message (the Pipecat client SDKs' `onServerMessage`):

```json
{"type": "manual-image", "image_id": "g00867598", "page": 94,
 "url": "/manual-images/g00867598.png", "width": 497, "height": 310,
 "caption": "How do I wear the seat belt?"}
```

`url` is relative to the Cat server, which should serve `data/manuals/images/` at `/manual-images/`.
With the local mic/speaker transport there is no app yet, so the picture also opens on this computer
(`CAT_SHOW_IMAGES_LOCALLY`).

```powershell
uv run ingest_manual.py          # re-run after changing the parser; replaces the old vectors
uv run eval_manual.py            # 18 operator questions: hit rate + search latency
uv run eval_manual.py --sweep    # compare alpha values
uv run eval_manual.py --answers  # also print the spoken answers
```

### "Open it": manual pages on screen

Cat remembers the pages behind each manual answer (`cat/memory.py`). After an answer, "Hey Cat,
open it" (or "show me that in the manual") calls `open_manual`, which renders those pages (two side by
side at most) to `data/manuals/pages/` and sends them to the app. "Open the seat belt one again" goes
back to an earlier answer. No search or extra LLM call, so the pages appear in about 0.1s:

```json
{"type": "manual-pages", "page": 93, "page_end": 94, "topic": "Seat Belt Adjustment for Non-Retractable Seat Belts",
 "url": "/manual-pages/page-093-094.png", "width": 1870, "height": 1210}
```

`/manual-pages/` should serve `data/manuals/pages/`.

## "What does this button do?": paused videos and photos

The operator watches a training video on their phone, pauses it, and says "Hey Cat, what does this button do?".
Or they take a photo of the cab and ask about it. Cat answers from what's on their screen plus the manual, in
about a second, with **no vision model** (cheap, and the same speed for one operator or many).

The trick is the same idea Gemini uses for video (look at it as timestamped frames plus narration), done
**once, offline**, instead of on every question:

- **Paused video:** every video has an `index.json`: for each stretch of seconds, which controls are on
  screen, which is highlighted, where each one is in the frame, the narration and the manual sections. A
  pause is a binary search in memory (0ms). A tap on the paused frame picks the nearest control.
- **Photo:** matched on the CPU (~130ms) to the manual's control drawings with SIFT features and a RANSAC
  homography, which maps every known control position into the photo. The control meant is the tapped one,
  else the one in the middle. Colours are sampled from the photo so "the red one" can be resolved. The
  manual's line drawings only match photos of the manual or a screen, not real cabs, so real cab photos are
  added as references: an image plus `data/references/<name>.json` with each control's position (0-1), no
  code change. The one used for testing is a frame (5:38) of Caterpillar's official video, showing the right
  console (switches 13-20, engine speed dial 7). It isn't in git; save that frame as
  `data/references/right-console-photo.jpg` to use it. Photos with no match (a vest, the outside of the
  machine, another brand's cab) are rejected rather than guessed.
- **Circle what you mean:** after a photo (or on a paused frame) the operator draws a rough circle around the
  part they mean. The controls inside it are what they mean (a slightly-off circle counts for the nearest control;
  one around several switches gets them all). It's geometry on positions Cat already has, so each new circle
  takes ~20ms and the photo is never matched again. Cat draws its reading on the photo and cuts the same control
  out of the manual's drawing for comparison. A circle around no known control gets "that isn't one of the
  controls I can find" straight away, with no model call.
- **The question:** the voice LLM calls `ask_about_screen`. It sends one machine-expert call with a short
  text description of the screen and the manual sections behind it. The sections are looked up locally by
  title (`cat/rag/sections.py`), so there's no search round trip. For real footage, which is indexed by what
  each moment is *about*, a manual search starts when the video is paused and is ready when the question
  comes. "Open it" works afterwards as usual.

### The videos

| Video | What it is | How Cat knows what's on screen |
|---|---|---|
| `controls-tour` (5:36) | All 27 numbered controls. The camera zooms onto each in the manual's drawings, with a yellow ring, caption, page and narration in Cat's voice. | Exact: the builder drew every frame. |
| `start-to-finish` (1:46) | Getting on, seat belt, battery switch, lockout, starting, stopping, leaving: the manual's step pictures. | Exact, including each picture's own numbered parts ("knob number 2"). |
| `cat-320d-overview` (11:38) | Caterpillar's official "320D Series 2 Comprehensive Overview" (real footage). | Indexed from its narration (Deepgram) and on-screen labels (local OCR); knows what a moment is about, not where each control is. |

The narration scripts (`video_build/scripts/*.json`) were checked line by line against the manual.

```powershell
uv sync --group video                                              # video tools (ffmpeg, OCR, yt-dlp)
uv run --group video video_build/callouts.py                       # control positions in the drawings (once)
uv run python -m cat.controls                                      # control catalogue (once)
uv run video_build/write_script.py                                 # narration scripts (review them!)
uv run --group video video_build/build_video.py                    # render both videos (~12 min)
uv run --group video yt-dlp -o data/videos/_source/cat-320d-series2-overview.mp4 https://www.youtube.com/watch?v=pHSwr3CnqS0
uv run --group video video_build/index_video.py data/videos/_source/cat-320d-series2-overview.mp4 --id cat-320d-overview --title "Cat 320D Series 2: Official Overview"
uv run eval_screen.py                                              # accuracy + speed
```

Our two videos are in git (`data/videos/controls-tour.mp4`, 24 MB; `start-to-finish.mp4`, 10 MB), so
they work straight after a pull. Caterpillar's official video, and the real-console photos taken from it,
are Caterpillar's and aren't committed (this repo is public). Make them locally in ~5 minutes:

```powershell
uv sync --group video
uv run --group video yt-dlp -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]" --merge-output-format mp4 --ffmpeg-location (uv run --group video python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())") -o data/videos/_source/cat-320d-series2-overview.mp4 https://www.youtube.com/watch?v=pHSwr3CnqS0
uv run --group video video_build/index_video.py data/videos/_source/cat-320d-series2-overview.mp4 --id cat-320d-overview --title "Cat 320D Series 2: Official Overview"
# the real right-console reference photo (5:38) and test photos (5:38, 5:42):
uv run python -c "import cv2; c = cv2.VideoCapture('data/videos/_source/cat-320d-series2-overview.mp4'); [(c.set(cv2.CAP_PROP_POS_MSEC, s * 1000), cv2.imwrite(p, c.read()[1])) for s, p in ((338, 'data/references/right-console-photo.jpg'), (338, 'data/test_photos/cat-video-338.jpg'), (342, 'data/test_photos/cat-video-342.jpg'))]"
```

Without them, everything else works: the official video just isn't listed, and real-console photos fall back to
shape recognition.

### Results (`uv run eval_screen.py`)

19 questions in operator words ("what does this button do?", "what's number 2 here?", "the switch with the
rabbit and turtle", "what does this red button do?", a tapped control, an unrelated photo):

| | Correct | Screen lookup | Answer after the question (median / p90) |
|---|---|---|---|
| Paused video | 15/15 | 0ms | ~0.5-0.8s / ~1.7s |
| Photo | 4/4 | ~130ms (CPU) | ~0.7s / ~2s |

End to end by voice (question spoken → answer text ready) it's ~1.1-1.3s, faster than a normal manual
question (~2s), because there's nothing to search. Cost per question: one Cerebras call; photos and pauses
cost nothing.

### API for the phone app (`cat/server.py`)

| Call | Body | Does |
|---|---|---|
| `GET /api/videos` | | Videos: title, `url`, `poster`, `subtitles` (VTT) |
| `POST /api/screen/video` | `{"video_id", "t", "tap": [x, y]?, "session_id"?}` | Paused at `t` seconds (or tapped at x, y in 0-1) |
| `POST /api/screen/playing` | `{"session_id"?}` | Playing again: "this" no longer means that frame |
| `POST /api/screen/photo` | multipart `file`, `tap_x`?, `tap_y`?, `circle`? (JSON), `session_id`? | A photo (optionally where they tapped or circled) |
| `POST /api/screen/mark` | `{"circle": [[x, y], ...]?, "tap": [x, y]?, "session_id"?}` | They drew a circle (or tapped) on the photo or paused frame already on screen. Reuses the photo's match: ~20ms |
| `GET /api/screen` | `?session_id=` | What Cat currently sees |
| `POST /api/ask` | `{"question", "session_id"?}` | Typed question about the screen; returns the answer, page and picture |

Each call returns what Cat now "sees": the headline, the controls with the one(s) meant (`meant`), the narration,
`annotated_url` (their photo with their circle and Cat's label on the control) and `manual_closeups` (the
manual's drawing zoomed onto that control, ringed, with its page), so the app can show both side by side. The voice
session uses `session_id` `"local"`. Over a Pipecat WebRTC connection the app can instead send RTVI client
messages `video-paused` `{video_id, t, tap?}` and `video-playing`. Media: `/videos/…`, `/manual-images/…`,
`/manual-pages/…`. `http://localhost:8765/ref` is a bare page that does all of this in a browser. It listens
on `0.0.0.0` so a phone on the same Wi-Fi can reach it; there's no auth yet.

**Scaling:** all per-operator state is one small in-memory dict keyed by `session_id` with a 5-minute expiry
(`cat/screen.py`), so it can move to Redis. Indexes and photo references are read-only and shared; photo
matching is CPU-bound and runs in threads. Adding a video or a reference photo is a data change.

## Add a tool

```python
# cat/tools/tasks.py
async def get_todays_tasks(params: FunctionCallParams):
    """Get the operator's scheduled tasks for today."""
    await params.result_callback([{"task": "Trench dig, site B", "start": "09:00"}])
```

Then add `get_todays_tasks` to `TOOLS` in `cat/tools/__init__.py`. The docstring and type hints
become the tool description the LLM sees.

## Settings (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `CAT_LLM_PROVIDER` | `cerebras` | `openai` switches to `gpt-4o-mini` (needs `OPENAI_API_KEY`). |
| `CAT_LLM_MODEL` | `gpt-oss-120b` | Runs with low reasoning effort so replies start fast. |
| `CAT_STT_MODEL` | `nova-3-general` | Deepgram streaming speech-to-text. |
| `CAT_TTS_PROVIDER` | `deepgram` | `cartesia` is faster but costs more (needs `CARTESIA_API_KEY`). |
| `CAT_TTS_VOICE` | `aura-2-helena-en` | Deepgram voice name, or a Cartesia voice ID. |
| `CAT_ALLOW_INTERRUPTIONS` | `true` | Talk over Cat to stop it. On laptop speakers without headphones Cat may hear itself; raise the VAD values or set `false`. |
| `CAT_VAD_CONFIDENCE` | `0.7` | Silero VAD: how sure it must be that a sound is speech. |
| `CAT_VAD_START_SECS` | `0.2` | Speech needed before it counts as you talking (and interrupts Cat). |
| `CAT_VAD_STOP_SECS` | `0.2` | Silence needed before it decides you paused. |
| `CAT_VAD_MIN_VOLUME` | `0.6` | Ignore sounds quieter than this. |
| `CAT_PINECONE_INDEX` | `cat-320d-omm` | Created by `ingest_manual.py` (needs `PINECONE_API_KEY`). |
| `CAT_EMBED_MODEL` | `text-embedding-3-small` | OpenAI embeddings (needs `OPENAI_API_KEY`). |
| `CAT_RAG_TOP_K` | `5` | Manual passages given to the machine expert. |
| `CAT_RAG_ALPHA` | `0.8` | 1 = meaning only, 0 = keywords only. |
| `CAT_ECHO_GUARD` | `true` | Ignore Cat's own voice echoing through laptop speakers (see `cat/echo_guard.py`). With headphones set `false` for faster barge-in. |
| `CAT_WAKE_WORD` | `true` | Only listen after "Hey Cat", one request at a time: Cat sleeps again after each answer (see `cat/wake_word.py`). |
| `CAT_WAKE_TIMEOUT_SECS` | `10` | After a bare "Hey Cat" (Cat says "Yes?"), how long it waits for the question. |
| `CAT_SHOW_IMAGES_LOCALLY` | `true` | Also open manual pictures on this computer (until the app exists). |
| `CAT_HTTP_HOST` | `0.0.0.0` | Phone API address (`cat/server.py`). No auth: use a trusted network. |
| `CAT_HTTP_PORT` | `8765` | Phone API port. |
