# Driver Sleep Detection

Rule-based drowsiness detection on Modal. A YOLO face detector finds the
driver, MediaPipe FaceLandmarker reads the eyes and mouth, and a temporal rule
engine decides whether the person is actually falling asleep — as opposed to
blinking, talking, or glancing away.

No training required. Every threshold is explicit and tunable in one file.

```
frame ──▶ YOLO (yolov12m-face.pt) ──▶ crop the driver's face
                                      │
                                      ▼
                       MediaPipe FaceLandmarker (478 pts)
                       ├── EAR   eye aspect ratio
                       ├── MAR   mouth aspect ratio
                       ├── blendshapes: eyeBlink / jawOpen
                       └── head pose: pitch / yaw / roll
                                      │
                                      ▼
                         DrowsinessMonitor (temporal rules)
                                      │
                       ALERT · MILD · DROWSY · CRITICAL
```

YOLO does detection because it is much more robust than MediaPipe's own face
detector at a dashcam angle, in poor light, or with a partly occluded face.
MediaPipe then landmarks a tight crop, which is where it is strongest.

## Why a temporal rule engine

A single frame cannot tell you anything. Closed eyes in one frame is a blink;
closed eyes for a second is a safety event. Every rule is therefore defined
over wall-clock time, so the verdict is identical at 8 fps or 30 fps.

| Signal | Rule | Threshold |
|---|---|---|
| **Blink** | closure ≤ 0.55 s | ignored — never scored, at any rate |
| **Microsleep** | closure ≥ 1.0 s | +55, fires *during* the closure |
| **Eyes shut** | closure ≥ 2.5 s | +80 → CRITICAL |
| **Head dropped** | pitch ≥ 18° below their normal, ≥ 1.2 s | +55; +80 past 2.5 s |
| **Head turned / tilted** | \|yaw\| ≥ 35° or \|roll\| ≥ 28°, ≥ 1.2 s | +55; +80 past 2.5 s |
| **Face not visible** | gone ≥ 3 s | +45; +75 past 6 s |
| **Yawn** | mouth *fully* open ≥ 1.5 s | +50 — one is enough |
| **PERCLOS** | % eyelid closure over 60 s | ≥ 18% +15, ≥ 28% +25 (caps at MILD) |

Three deliberate choices in that table:

- **Blinking is never scored.** Not rate, not duration. Only sustained closure
  counts, and PERCLOS is capped so it can reach MILD but never DROWSY on its
  own — a driver gets alerted for eyes *shut*, not for blinking often.
- **Talking cannot start a yawn.** The mouth bar is "fully open" (MAR 0.72 /
  jawOpen 0.60), which speech does not reach, and it must hold for 1.5 s.
- **Head posture is a primary signal.** Someone dozing off drops their chin or
  rolls their head to one side, and their eyes are usually invisible by then.
  Eye-only detection goes silent at exactly the wrong moment.

Score is clamped to 0–100: `<25 ALERT`, `25–49 MILD`, `50–74 DROWSY`,
`≥75 CRITICAL`. `UNKNOWN` when the face has not been visible for most of the
last 10 seconds — the system says "I can't see" rather than guessing.

Three details that matter in practice:

- **Per-driver EAR baseline.** Everyone's open-eye EAR differs (eye shape,
  glasses, camera angle). Closure is judged against the 85th percentile of
  that driver's own recent EAR, learned over a rolling 90 s window. The 85th
  percentile rather than the max, so one wide-eyed frame can't inflate the
  baseline and mask real closures.
- **Yawning is a duration, not a threshold.** A mouth open for 0.4 s is
  speech. The rule requires 1.2 s sustained, and caps at 8 s so a mis-tracked
  jaw doesn't log an endless yawn.
- **Losing the face never invents an event, but never goes quiet either.** Any
  closure or yawn in progress is aborted, so a head-turn cannot fabricate a
  microsleep — but a face missing for seconds is itself scored as "head turned
  away". Reporting UNKNOWN there would go silent at the exact moment a slumped
  driver most needs the alarm.
- **Head pitch is learned, not assumed.** A dash-mounted camera looks up at the
  face, so an attentive driver can sit at −10° all day; measured on
  `tired_driver` their forward pitch runs −8° to −10°. A chin-drop is judged
  against the driver's own rolling median, not an absolute angle.

## Setup

```bash
pip install -r requirements.txt
python3 -m modal setup            # opens a browser, one time

python scripts/upload_model.py ~/Downloads/yolov12m-face.pt
modal deploy modal_app/app.py
```

`upload_model.py` puts the checkpoint in a Modal Volume so the 40 MB file is
not rebaked into the image on every rebuild.

The app runs **CPU-only by default** (4 cores) because a GPU requires a payment
method on the Modal account. Detection is ~200 ms/frame that way, which is fine
for batch scoring and adequate for a ~5 fps live feed. To turn a GPU on:

```bash
SLEEP_DETECTION_GPU=T4 modal deploy modal_app/app.py
```

### Running without Modal

```bash
python3 -m venv .venv && .venv/bin/pip install mediapipe==0.10.35 ultralytics
curl -fsSL -o models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

.venv/bin/python scripts/run_local.py samples/tired_driver_720p.mp4 --out annotated.mp4
```

`run_local.py` uses the same `FacePipeline` and `DrowsinessMonitor` the
container runs, so it is a faithful dry run and a usable offline fallback.

mediapipe is pinned to **0.10.35**, not 1.0.x: the 1.0 line aborts the process
on macOS (`DrishtiMetalHelper: Service is unavailable`), and keeping one version
across laptop and container is worth more than being current.

## Test clips

```bash
./scripts/fetch_samples.sh           # KEEP_ORIGINAL=1 to also keep the 4K source
```

Downloads two clips from [Pexels](https://www.pexels.com/license/) (free for
personal and commercial use, no attribution required) into `samples/`. They are
gitignored — rerun the script to get them back.

| File | What it is | Why it is useful |
|---|---|---|
| `tired_driver_720p.mp4` | 34 s, night drive, face well framed | eyes visibly drooping early, a head-turn around t=10 s |
| `distant_driver_720p.mp4` | 35 s, same actor further back | small face, partly hidden by the wheel — a detector stress test |
| `yawning_woman_720p.mp4` | 10 s, wide yawn, glasses | the positive case: sustained eye closure; glasses stress the EAR |

The primary clip is a genuinely hard case rather than a clean lab recording:
coloured night lighting, a moving vehicle, and a driver who turns away
mid-clip. That head-turn is the interesting part — it should produce `UNKNOWN`
rather than a phantom microsleep.

Use the 720p files. The face is ~200 px wide at that size, which is plenty for
landmarking, and they upload 31x faster than the 4K source.

### What they actually show

Measured, not assumed — these numbers come from running the clips:

- **`tired_driver`: no drowsiness event at all.** 9 eye closures, every one
  40–320 ms, i.e. ordinary blinks. Jaw blendshape peaks at 0.024 — he never
  opens his mouth. He *looks* tired but never shuts his eyes or yawns, so the
  correct output is ALERT throughout. It is a false-positive test, not a
  detection test.
- **`yawning_woman`: the positive case.** Reaches CRITICAL at t=9.05 s on a
  sustained closure. The yawn itself is *not* counted: her hand covers her
  mouth, so MAR only stays wide for 0.79 s against a 1.2 s gate. Face is found
  in 67% of frames for the same reason. Catching it via the eye closure instead
  is the system working as intended.

## Use

```bash
# live webcam with HUD  (q quit, r reset session)
python scripts/run_webcam.py

# score a recorded clip and burn the verdict onto a copy
python scripts/run_video.py samples/tired_driver_720p.mp4 --out annotated.mp4

# quick one-off without deploying
modal run modal_app/app.py --video samples/tired_driver_720p.mp4
modal run modal_app/app.py --image-path face.jpg
```

The webcam client captures and draws at full camera rate on the main thread
while a worker ships frames to Modal, so the preview never stutters waiting on
the network. Default upload is 640 px JPEG at 10 fps — plenty, since every
rule is time-based rather than frame-based.

## HTTP API

`modal deploy` prints three URLs. The current deployment:

```
POST  https://akshath-r333--sleep-detection-sleepdetector-analyze.modal.run
POST  https://akshath-r333--sleep-detection-sleepdetector-measure-only.modal.run
GET   https://akshath-r333--sleep-detection-sleepdetector-health.modal.run
```

```bash
curl -X POST https://akshath-r333--sleep-detection-sleepdetector-analyze.modal.run \
  -H 'Content-Type: application/json' \
  -d '{"image":"<base64 jpeg>","session_id":"cab-7","timestamp":1727000000.0}'
```

```jsonc
{
  "verdict": {
    "level": "DROWSY", "score": 73.0, "sleepy": true,
    "reasons": ["eyes closed 1.4s", "PERCLOS 27%"],
    "perclos": 0.27, "eyes_closed": true, "closure_s": 1.4,
    "yawns_in_window": 2, "microsleeps_recent": 1,
    "blink_rate_per_min": 9.0, "avg_blink_s": 0.31,
    "ear": 0.11, "ear_baseline": 0.29, "mar": 0.05,
    "pitch_deg": -8.0, "face_visible_ratio": 0.98, "session_s": 142.6
  },
  "box": [312.0, 118.4, 508.2, 366.9, 0.94],
  "landmarks": { "left_eye": [[x,y],...], "right_eye": [...], "mouth": [...] },
  "head_pose": { "pitch": -8.0, "yaw": 3.2, "roll": -1.1 },
  "timing_ms": { "detect": 9.2, "landmark": 6.8 }
}
```

| Endpoint | Purpose |
|---|---|
| `POST /analyze` | full verdict; server keeps per-`session_id` history |
| `POST /measure_only` | stateless raw signals; run the rules yourself |
| `GET /health` | which detector loaded, GPU, active sessions |

Send `"reset": true` on the first frame of a session to clear prior state.

Because session history lives in container memory, the class pins
`max_containers=1` with `@modal.concurrent(max_inputs=8)` so every frame of a
session reaches the same container. That is ample for a demo; to scale out,
use `/measure_only` and run `DrowsinessMonitor` on the client — the rule engine
is pure Python and imports anywhere.

## Layout

```
modal_app/
  app.py         Modal app: image, volume, endpoints, video batch job
  pipeline.py    FacePipeline: YOLO + FaceLandmarker (runs local AND remote)
  landmarks.py   FaceMesh indices -> EAR / MAR / head pose
  rules.py       DrowsinessMonitor: the temporal state machine (no deps)
scripts/
  upload_model.py   push the YOLO checkpoint to the Modal Volume
  fetch_samples.sh  re-download the test clips
  run_webcam.py     live webcam client with HUD
  run_video.py      batch-score a clip on Modal, render an overlay
  run_local.py      same pipeline, no Modal
  test_rules.py     synthetic-trace tests for the rule engine
```

## Tests

```bash
python scripts/test_rules.py
```

12 tests against synthetic EAR/MAR traces — no model, no network. Normal
blinking stays ALERT; 15 fast blinks are not drowsiness; a 1.5 s closure is a
microsleep and 4 s is CRITICAL; high PERCLOS escalates; three sustained yawns
register while speech-length openings do not; a lost face reports UNKNOWN and
recovers; 8 fps and 30 fps agree; blendshape inputs drive the same rules; the
score decays back to ALERT; PERCLOS stays out of the score until its window is
populated; and an occluded mouth is still caught via MAR.

Four real bugs were found this way rather than in production — see
*Bugs the tests caught* below.

## Tuning

Every threshold is in the `Thresholds` dataclass at the top of
`modal_app/rules.py`. The ones worth touching first:

- `microsleep_s` (1.0) — lower for an earlier alarm, raise to cut false positives
- `perclos_drowsy` (0.25) — the standard fatigue measure; 0.15 is aggressive
- `eye_closed_ratio` (0.65) — raise if closures are missed on squinty drivers
- `yawn_min_s` (1.5) — raise if talking is being logged as yawning
- `yaw_away_deg` (35) / `roll_tilt_deg` (28) — lower to catch subtler slumps;
  a mirror glance on `tired_driver` peaks at 28° yaw, so 35 clears it
- `face_lost_alert_s` (3.0) — how long a missing face stays merely unknown

Yaw and roll are judged on magnitude, so the sign convention of MediaPipe's
transformation matrix cannot silently invert those rules. Pitch is the one
signed quantity, and it is compared against a learned baseline rather than
zero, which absorbs the camera's mounting angle.

## Graceful degradation

If the YOLO checkpoint is missing or fails to load, the app logs the reason and
falls back to landmarking the full frame instead of crashing. `GET /health`
reports `detector` and `yolo_error` so you can tell which path is live.

## Bugs the tests caught

Kept here because each one would have been painful to diagnose from a live feed.

1. **`_trim()` assumed tuples** but the event deque holds dataclasses —
   `TypeError` on the first microsleep, i.e. a crash on the exact case the
   system exists to detect.
2. **Face visibility was gated on the 60 s PERCLOS window**, so after a driver
   looked away and came back the verdict stayed `UNKNOWN` for a full minute.
   Now gated on 10 s.
3. **PERCLOS had no warm-up guard.** A session opening mid-blink read
   `PERCLOS 100%` off a single 40 ms frame and scored +35 immediately. On the
   yawn clip this alone inflated the drowsy fraction from 9.6% to 90%.
4. **Mouth opening preferred the blendshape and ignored MAR.** With a hand
   across the mouth, `jawOpen` held above threshold for 290 ms while geometric
   MAR read 0.83 across 20 frames — the better signal was being discarded. The
   two are now fused. Eye closure deliberately is *not* fused: on the driver
   clip the blendshape agreed with EAR on only 46 of 79 low-EAR frames, and
   OR-ing them would have stitched ordinary blinks into phantom microsleeps.

Items 3 and 4 were only visible because the pipeline was run against real
footage before deploying.
