# Cat Operator (mobile)

The field operator's companion to the Supervisor dashboard (`../frontend`).
Expo SDK 57 · React Native · TypeScript · Expo Router. Android first.

Data comes from two backends in this repo (neither was modified for the app):

| Backend | Used for | Default URL (Android emulator) |
| --- | --- | --- |
| `Prediction/` Fleet Scheduler API | Worker list, my tasks (assignments in the published plan), start/complete, `/health` | `http://10.0.2.2:8000` |
| `cat_agent/` Cat phone API | Cat answers, photo check, training videos, manual pages | `http://10.0.2.2:8765` |

Voice (wake word, speech-to-text) is still mocked on the phone.

## Run

```bash
# 1. Backends (from the repo root)
cd Prediction && uvicorn api.main:app --host 0.0.0.0 --port 8000   # needs DATABASE_URL + a published run
cd cat_agent  && uv run main.py                                      # serves :8765

# 2. App
cd app
cp .env.example .env    # set the two URLs; a real phone needs the laptop's LAN IP
npm install
npx expo start -c       # press "a" for Android
```

`EXPO_PUBLIC_USE_MOCKS=1` in `.env` runs the whole app on built-in mock data, with no servers.

**What the Fleet API must have:** rosters synced (`POST /v1/rosters/sync`) and a run published
(`POST /v1/plan` with `"publish": true`, or `POST /v1/runs/{id}/publish`). Without a published run,
Home shows "No plan published yet".

## Voice ("Hey Cat")

Voice is a live [Pipecat](https://docs.pipecat.ai) session with `cat_agent`, over WebRTC
(`POST /api/offer` on the Cat server, added in `cat_agent/cat/phone_voice.py`). The phone streams the
mic; the agent runs the same pipeline as on the laptop: "Hey Cat" wake phrase, Deepgram
speech-to-text and voice, manual tools. Its RTVI events drive the overlay (listening → thinking →
Cat speaking → answered) and push manual pictures and pages to the screen.

- **Needs a development build** (native WebRTC): `npx expo run:android` with the Android SDK, or
  `eas build --profile development --platform android`. In **Expo Go** a demo voice stands in
  (scripted question, real answers from Cat over HTTP, no microphone or audio).
- **Hands-free:** turn it on from the Cat tab (or tap any mic). The session listens for "Hey Cat"
  from every screen while the app is open, and stops in the background.
- **Networking:** WebRTC audio is UDP straight between the phone and the Cat server. The phone must
  reach the server's own IP: run `cat_agent` on Windows directly, or use WSL mirrored networking.
  A WSL2 NAT address (172.x) with `netsh portproxy` is not enough (TCP only).
- Screen-aware voice ("what does this do?") uses the agent's `local` screen session, so it follows
  one phone at a time.

## Screens

| Route | Screen |
| --- | --- |
| `(tabs)/home` | Greeting, shift, today's progress, next task, quick actions, task list |
| `(tabs)/learn` | Training library: required progress, recommended, continue watching, categories |
| `(tabs)/agent` | Cat: wake-word bar, chat, suggestions, text / mic / camera composer |
| `task/[id]` | Task details: facts, description, safety checklist (gates **Start task**), tutorial, steps, related training |
| `video/[id]` | Video player (simulated) with chapters. Pausing shows **Ask Cat about this** |
| `camera/` → `camera/preview` | Take photo / choose from gallery → question → analyzing → result |

The Cat voice overlay (`components/agent/VoiceOverlay.tsx`) is mounted once at
the root, so it opens on top of any screen: from the wake word, the mic
buttons, or the paused video. Its phases (listening, thinking, responding) each
look different: yellow orb with pulsing rings and a live waveform, then a
rotating arc, then a light core with the answer revealed word by word.

## Demo flows

- **Video → Cat:** Home → Pump Inspection → Watch tutorial → pause → *Ask Cat about this*.
  The question carries `{ taskId, videoId, timestamp, videoTitle, chapterTitle }`.
  *Resume video* closes the overlay and resumes playback.
- **Wake word:** Cat tab → **DEMO “Cat”** button (simulates detection). The wake
  word picks up context from the current screen (a task or a video moment).
- **Text chat:** type, or tap a suggestion. Answers show cautions, sources and action buttons.
- **SOS state:** ask something containing "emergency", "SOS" or "hurt". The mock backend
  reports *Emergency alert sent*, then *acknowledged* about 7 s later. The app only
  displays this state; the Supervisor side owns the incident.
- **Photo check:** Cat tab → camera icon (or Home → Photo check).

Mock knobs such as latency, forced failures and starting offline are in
`src/services/mock/mockConfig.ts`. Use them to see the error and offline states.

## Integration

On launch the operator picks their **worker ID** (the last one is preselected). The choice is
kept on the phone and can be changed from Home ("Switch worker").

| App feature | Endpoint |
| --- | --- |
| Worker picker | `GET /v1/rosters?source=db` (falls back to `csv`), `GET /v1/runs/active/workers` |
| Home / task list / task details | `GET /v1/runs/active/assignments?worker_id=…` joined with roster tasks (weather, quantity) |
| Start task / Mark complete | `PATCH /v1/assignments/{id}` with `IN_PROGRESS` / `DONE` |
| Connection banner | `GET /health` every 20 s (`degraded` = API up, database down) |
| Cat text + voice answers | `POST /api/app/agent/message` (paused video → `context.videoId` + `timestamp`) |
| Video resumed | `POST /api/app/screen/clear` |
| "Manual p. N" | `GET /api/app/manual/open` |
| Photo check (+ circle / tap) | `POST /api/app/photo/analyze` (multipart) |
| Learn / tutorials | `GET /api/app/videos`, `/api/app/videos/{id}` (played with `expo-video`) |

Notes on the mapping:
- One **assignment** (a portion of a task on one machine) is one task card; its id is the assignment id.
- Home shows assignments that **start today**, plus any in progress. If none start today, it shows the next 5.
- The Fleet API has no instructions, so safety checklists and steps come from `src/content/procedures.ts`,
  keyed by task type, with extra checks for bad weather and night shifts. Excavator tasks link the Cat
  320D videos as tutorials.
- Watch progress is stored on the phone. The Cat session id is the worker id, so each phone has its own
  paused frame / photo.
- **Not backed yet:** SOS status (no endpoint), chat history (the conversation lives on the phone).

Code layout:

```
src/config.ts                  ← backend URLs / mock switch (EXPO_PUBLIC_*)
src/services/types.ts          ← service interfaces the UI uses
src/services/index.ts          ← picks real vs mock implementations
src/services/fleet/            ← Fleet Scheduler client + assignment → Task mapping
src/services/cat/              ← Cat agent client
src/services/mock/             ← mock implementations + data
src/services/local/            ← on-device storage (last worker, video progress)
src/state/SessionProvider.tsx  ← selected worker
```

## Design

Tokens in `src/theme/tokens.ts` mirror the Supervisor dashboard's dark theme
(`frontend/src/app/globals.css`) and rules (`frontend/docs/DESIGN_SPEC.md`):
brand yellow means "act here" (primary action, current task) and is never used as a status.
Status is always icon + label + colour. Red is only for critical and SOS.
The font is IBM Plex Sans / Mono. Touch targets are ≥ 48 dp, and primary actions are 56 dp.
