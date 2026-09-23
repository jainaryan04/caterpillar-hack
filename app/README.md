# Cat Operator (mobile)

The field operator's companion to the Supervisor dashboard (`../frontend`).
Expo SDK 57 · React Native · TypeScript · Expo Router. Android first.

**This is frontend only.** All backend data, the agent, speech and image
analysis are mocked behind service interfaces (see [Integration boundary](#integration-boundary)).

## Run

```bash
npm install
npx expo start          # press "a" for Android (Expo Go or emulator)
npm run typecheck
npm run lint
```

`expo-image-picker` is included in Expo Go, so no development build is needed yet.

## Screens

| Route | Screen |
| --- | --- |
| `(tabs)/home` | Greeting, shift, today's progress, next task, quick actions, task list |
| `(tabs)/learn` | Training library: required progress, recommended, continue watching, categories |
| `(tabs)/agent` | Jarvis: wake-word bar, chat, suggestions, text / mic / camera composer |
| `task/[id]` | Task details: facts, description, safety checklist (gates **Start task**), tutorial, steps, related training |
| `video/[id]` | Video player (simulated) with chapters. Pausing shows **Ask Jarvis about this** |
| `camera/` → `camera/preview` | Take photo / choose from gallery → question → analyzing → result |

The Jarvis voice overlay (`components/agent/VoiceOverlay.tsx`) is mounted once at
the root, so it opens on top of any screen: from the wake word, the mic
buttons, or the paused video. Its phases (listening, thinking, responding) each
look different: yellow orb with pulsing rings and a live waveform, then a
rotating arc, then a light core with the answer revealed word by word.

## Demo flows

- **Video → Jarvis:** Home → Pump Inspection → Watch tutorial → pause → *Ask Jarvis about this*.
  The question carries `{ taskId, videoId, timestamp, videoTitle, chapterTitle }`.
  *Resume video* closes the overlay and resumes playback.
- **Wake word:** Jarvis tab → **DEMO “Jarvis”** button (simulates detection). The wake
  word picks up context from the current screen (a task or a video moment).
- **Text chat:** type, or tap a suggestion. Answers show cautions, sources and action buttons.
- **SOS state:** ask something containing "emergency", "SOS" or "hurt". The mock backend
  reports *Emergency alert sent*, then *acknowledged* about 7 s later. The app only
  displays this state; the Supervisor side owns the incident.
- **Photo check:** Jarvis tab → camera icon (or Home → Photo check).

Mock knobs such as latency, forced failures and starting offline are in
`src/services/mock/mockConfig.ts`. Use them to see the error and offline states.

## Integration boundary

```
src/services/types.ts      ← interfaces: OperatorService, TaskService, VideoService,
                             AgentService, VoiceService, MediaService, ConnectionService
src/services/index.ts      ← the ONLY place that picks implementations (mocks today)
src/services/mock/         ← mock implementations + mock data (data/)
src/services/device/       ← real on-device camera / gallery (expo-image-picker)
src/types/                 ← domain + agent types (AgentAction, AgentContext, SosStatus, …)
```

To connect the backend, implement an interface and swap it in `services/index.ts`.
Screens don't import mocks directly.

- **Agent:** `AgentService.sendMessage(message, context)` returns an `AgentResponse`
  (`text`, `caution`, `citations`, `actions`). `onSosStatus` is where realtime SOS
  updates should be pushed.
- **Voice:** `VoiceService` owns the mic, wake word and STT. The UI only uses
  `startListening / stopListening / cancel` and subscribes to `onWakeWordDetected`,
  `onTranscript`, `onAmplitude` (drives the waveform) and `onError`.
  Leave `simulateWakeWord` undefined in the real implementation; the demo button then hides itself.
- **Agent actions:** `AgentAction` union in `src/types/agent.ts`. Navigation actions are
  handled in `AgentProvider.runAction`. `PAUSE_VIDEO` / `RESUME_VIDEO` go over
  `state/agentActionBus.ts` to the focused video screen.
- **Video:** `VideoPlayer` renders from a `Playback` object (`hooks/useMockPlayback.ts`).
  Once `TrainingVideo.videoUrl` is real, replace that hook with one backed by
  `expo-video` that returns the same shape.

## Design

Tokens in `src/theme/tokens.ts` mirror the Supervisor dashboard's dark theme
(`frontend/src/app/globals.css`) and rules (`frontend/docs/DESIGN_SPEC.md`):
brand yellow means "act here" (primary action, current task) and is never used as a status.
Status is always icon + label + colour. Red is only for critical and SOS.
The font is IBM Plex Sans / Mono. Touch targets are ≥ 48 dp, and primary actions are 56 dp.
