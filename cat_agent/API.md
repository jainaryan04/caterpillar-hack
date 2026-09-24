# Cat API for the operator app

Base URL: `http://<laptop-ip>:8765`. Cat serves it while `uv run main.py` is running.

- **Android emulator:** `http://10.0.2.2:8765`
- **iOS simulator:** `http://localhost:8765`
- **Real phone:** the laptop's IPv4 address from `ipconfig`. The phone must be on the same Wi-Fi, and Windows Firewall must allow Python.

**Interactive docs:** `http://<laptop-ip>:8765/docs`. You can try every call there.

The `/api/app/...` endpoints return the app's own types from `app/src/types`, so each one plugs into a
service in `app/src/services`. Every answer comes from the Cat 320D Operation & Maintenance Manual. All
URLs in responses are absolute. There's no auth yet, so use a trusted network.

| Endpoint | Returns | Replaces in the app |
|---|---|---|
| `GET /api/app/videos` | `TrainingVideo[]` | `VideoService.getVideos` / `getLibrary` |
| `GET /api/app/videos/{id}` | `TrainingVideo` | `VideoService.getVideo` |
| `POST /api/app/agent/message` | `AgentResponse` | `AgentService.sendMessage` |
| `POST /api/app/photo/analyze` (multipart) | `ImageAnalysis` | `MediaService.analyzeMachineryPhoto` |
| `POST /api/app/photo/mark` | `ImageAnalysis` | Circling again on the same photo |
| `GET /api/app/manual/open` | Manual page image | "Open it" / "Show me the page" |
| `POST /api/app/screen/clear` | `{cleared}` | The video plays again, or the photo is closed |
| `POST /api/app/voice` (multipart) | `AgentResponse` + `audioUrl` | Push-to-talk (Expo Go, no live voice) |

`sessionId` is optional on every call (default `"local"`). With the default, the laptop's voice session
("Hey Cat, what does this do?") sees the same pause or photo as the app. Give each phone its own id when
there are several operators.

## 1. Questions: `POST /api/app/agent/message`

One endpoint for all three kinds of question:

```jsonc
// General manual question: hybrid search over the manual
{ "message": "How do I wear the seat belt?" }

// About the paused video: pass where it's paused
{ "message": "What does this button do?",
  "context": { "videoId": "controls-tour", "timestamp": 190 } }

// ...optionally with where they tapped or circled on the paused frame (0-1 across and down the video)
{ "message": "What's this one?",
  "context": { "videoId": "controls-tour", "timestamp": 158,
               "circle": [[0.28, 0.40], [0.33, 0.46], [0.28, 0.52], [0.23, 0.46]] } }

// About the photo just sent to /photo/analyze
{ "message": "What does it do?", "context": { "imageUri": "file:///..." } }
```

**How Cat decides** (`mode: "auto"`, the default):
- The question points at the screen ("this", "that", "these", "here", "the one I circled", "in the photo",
  "number 7 here"), or `context` has a tap or circle: Cat answers from what's on the screen.
- The question names something ("what does the AEC switch do?"): Cat searches the manual, even while a video
  is paused.
- To force one or the other, pass `"mode": "manual"` or `"mode": "screen"`.
- "What does this do?" with nothing paused and no photo gets "I can't see anything on your screen yet…".

**Response** (`AgentResponse`, plus extras):

```jsonc
{
  "id": "MSG-3f2a...", "createdAt": "2026-09-24T01:30:00Z",
  "text": "That's the Travel Alarm Cancel Switch... That's on page 101 of the manual.",
  "citations": [
    { "source": "Cat 320D Operation & Maintenance Manual", "locator": "p. 101 · Travel Alarm Cancel Switch" },
    { "source": "Cat 320D Operator Controls Tour", "locator": "3:10" }
  ],
  "actions": [{ "type": "ANSWER" }],
  // extras
  "kind": "screen",                       // "manual" (general) | "screen" (video/photo)
  "manual": { "page": 101, "pageEnd": 101, "topic": "Travel Alarm Cancel Switch" },
  "imageUrl": "http://.../manual-images/g03666599.png",   // the manual's picture, or null
  "screen": { "kind": "video", "headline": "...", "meant": ["15"], "annotatedUrl": null,
              "manualCloseups": [{ "callout": "15", "url": "http://.../screen-images/manual-15.jpg" }] },
  "ms": 820
}
```

## 2. Photos: `POST /api/app/photo/analyze` (multipart)

Upload, circle and answer in one call.

| Field | |
|---|---|
| `file` | the photo (JPEG/PNG, ≤ 12 MB) |
| `question` | optional, default "What is this?" |
| `circle` | optional JSON string `[[x, y], ...]`: the circle they drew, 0-1 across and down the **photo** |
| `tapX`, `tapY` | optional: a tap instead of a circle |
| `sessionId` | optional |

**How Cat reads the photo:**
- **Known layout:** if the photo matches one Cat has a reference for (for now, the right console and the
  manual's drawings), it knows exactly which control is where. Then the circled one is certain
  (`confidence: "high"`).
- **Otherwise:** the circled part is recognised by its shape on the laptop, and the answer starts
  "That looks like a joystick…" (`confidence: "medium"` / `"low"`).
- **Nothing that's a control:** a circle on a window, the floor or an empty area gets "That isn't one of the
  controls…".

**Response** (`ImageAnalysis`, plus extras):

```jsonc
{
  "id": "IMG-9c1d...", "createdAt": "...",
  "summary": "That looks like a joystick. On the 320D the joystick controls the functions of the work tools. That's on page 98 of the manual.",
  "findings": [{ "label": "Joystick Controls (callout 6) · manual p. 98", "severity": "info" }],
  "limitations": "Recognised by shape only (joystick, 83% sure): the photo didn't match a known Cat 320D layout...",
  "recommendedAction": "See the Cat 320D Operation & Maintenance Manual, page 98 (Joystick Controls).",
  "confidence": "medium",
  // extras
  "citations": [...], "manual": {...}, "imageUrl": "...",
  "screen": {
    "annotatedUrl": "http://.../screen-images/photo-local.jpg?v=...",  // their photo + their circle + Cat's label
    "manualCloseups": [{ "callout": "6", "url": "http://.../screen-images/manual-6.jpg" }],  // same control in the manual
    "recognized": [{ "part": "joystick", "score": 0.83 }, ...]
  },
  "ms": 770
}
```

To show "what Cat understood", put `screen.annotatedUrl` and `screen.manualCloseups[0].url` side by side.

## 3. Circle again: `POST /api/app/photo/mark`

The photo is already on the server, so this needs no re-upload and no re-matching (about 20 ms plus the answer).

```jsonc
{ "circle": [[0.30, 0.62], [0.42, 0.70], [0.36, 0.95], [0.27, 0.80]], "question": "What does this lever do?" }
// or { "tap": [0.36, 0.80] }
```

It returns an `ImageAnalysis`. You get a 409 if no photo was sent yet.

## 4. "Open it": `GET /api/app/manual/open?sessionId=local`

This returns the manual page(s) behind the last answer, or behind what's on screen if that's newer, as one image:

```json
{ "opened": true, "message": "Opened page 101 of the manual.", "page": 101, "pageEnd": 101,
  "topic": "Travel Alarm Cancel Switch", "url": "http://.../manual-pages/page-101.png", "width": 935, "height": 1210 }
```

With nothing to open it returns `{ "opened": false, "message": "..." }`. Add `&page=96` to open a given page.

## 5. Push-to-talk: `POST /api/app/voice` (multipart)

For phones without the live voice session (Expo Go has no WebRTC). The app records one question and sends it:

| Field | |
|---|---|
| `file` | the recording (m4a/AAC from `expo-audio`, or wav/mp3), ≤ 10 MB |
| `context` | optional JSON `AgentContext`, as for `/agent/message` (a paused video, a photo) |
| `sessionId` | optional |

Cat transcribes it (Deepgram nova-3), drops a leading "Hey Cat", and answers exactly like `/agent/message`.
"Open it" / "show me the page" opens the manual pages instead. The response is an `AgentResponse` plus:
- `transcript`: what Cat heard (`""` if nothing; the answer then says it didn't catch that);
- `audioUrl`: `GET /api/app/voice/{id}.mp3`, Cat's spoken answer. It streams while Deepgram synthesises it,
  so play it straight away. Replies expire after 10 minutes;
- `pages`: for "open it", the manual pages (as `/manual/open` returns them), else `null`.

## 6. Videos: `GET /api/app/videos`

This returns `TrainingVideo[]`:
- `videoUrl` is a playable mp4 (with HTTP range requests).
- `chapters` come from the video's index.
- Extras: `posterUrl` and `subtitlesUrl` (WebVTT).

The ids are `controls-tour` and `start-to-finish`, plus `cat-320d-overview` if it was downloaded locally (see
README). When the operator pauses and asks, send the video's `id` and `positionSeconds` as `context.videoId`
and `context.timestamp`.

## Drop-in code for `app/src/services`

```ts
// app/src/services/cat/catApi.ts
import type { AgentContext, AgentResponse, ImageAnalysis } from '@/types/agent';
import type { TrainingVideo } from '@/types/domain';

export const CAT_URL = 'http://192.168.1.20:8765'; // the laptop's IP
const SESSION = 'local';                            // or one id per phone

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `Cat error ${res.status}`);
  return res.json() as Promise<T>;
}

export const catAgentService = {
  async sendMessage(message: string, context?: AgentContext): Promise<AgentResponse> {
    return json(await fetch(`${CAT_URL}/api/app/agent/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context, sessionId: SESSION }),
    }));
  },
};

export const catMediaService = {
  /** circle: points 0-1 across/down the photo, from the drawing overlay (optional). */
  async analyzeMachineryPhoto(input: { imageUri: string; question?: string; context?: AgentContext;
                                       circle?: [number, number][] }): Promise<ImageAnalysis> {
    const form = new FormData();
    form.append('file', { uri: input.imageUri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    if (input.question) form.append('question', input.question);
    if (input.circle) form.append('circle', JSON.stringify(input.circle));
    form.append('sessionId', SESSION);
    return json(await fetch(`${CAT_URL}/api/app/photo/analyze`, { method: 'POST', body: form }));
  },
  async markPhoto(circle: [number, number][], question?: string): Promise<ImageAnalysis> {
    return json(await fetch(`${CAT_URL}/api/app/photo/mark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circle, question, sessionId: SESSION }),
    }));
  },
};

export const catVideoService = {
  async getVideos(): Promise<TrainingVideo[]> { return json(await fetch(`${CAT_URL}/api/app/videos`)); },
  async getVideo(id: string): Promise<TrainingVideo> { return json(await fetch(`${CAT_URL}/api/app/videos/${id}`)); },
};
```

Then in `services/index.ts`, swap `mockAgentService` for an object that uses `catAgentService.sendMessage`
(keep the mock's `getHistory` / `onSosStatus` until those exist). Do the same with `catMediaService` for
`mediaService`.

**Circle coordinates:** record the finger path over the photo, and divide each point by the **displayed
image's** width and height. If the image is letterboxed (`resizeMode="contain"`), subtract the empty borders
first. About 20-60 points is plenty.

## Timings (laptop, India → US services)

| Call | Time |
|---|---|
| Question about a paused video | ~0.5-1.4 s |
| General manual question | ~1.2-2 s (search + answer) |
| Photo analyze with a circle | ~0.8 s |
| Circle again | ~0.8 s (~20 ms before the answer) |
| Open manual page | ~0.1 s |

Photos and pauses are processed on the laptop's CPU at no cost. Each answer is one Cerebras call.
