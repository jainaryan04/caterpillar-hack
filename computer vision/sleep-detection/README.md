# Driver Sleep Detection

Rule-based drowsiness detection that runs entirely on your machine at ~110 fps.
MediaPipe FaceLandmarker reads the eyes, mouth and head pose; a temporal rule
engine decides whether the driver is actually falling asleep, as opposed to
blinking, talking, or glancing at a mirror.

No training, no GPU, no network. Every threshold is explicit in one file.

```
frame ──▶ MediaPipe FaceLandmarker (478 pts)
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

An earlier version ran a YOLOv12-face detector on Modal to crop the face
before landmarking. It was removed after measuring it: on the sample clips
MediaPipe's built-in BlazeFace matched YOLO frame-for-frame at webcam distance
(100% face-found on `tired_driver`) while running **28x faster** -- 8 ms
against 230 ms. YOLO only won on a deliberately distant, half-hidden face
(100% vs 84%). For a driver-facing camera it was paying 28x for nothing, and
the network hop on top of that.

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
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./scripts/fetch_model.sh          # 3.7 MB FaceLandmarker model
```

mediapipe is held below 1.0: the 1.0 line aborts the process on macOS
(`DrishtiMetalHelper: Service is unavailable`).

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
# live webcam  (q quit, r reset session)
.venv/bin/python scripts/run_webcam.py

# record the annotated view
.venv/bin/python scripts/run_webcam.py --record demo.mp4

# a camera other than the default
.venv/bin/python scripts/run_webcam.py --camera 1

# score a recorded clip, burn the verdict onto a copy
.venv/bin/python scripts/run_local.py samples/tired_driver_720p.mp4 --out out.mp4
```

Capture and display run at full camera rate on the main thread while a worker
thread does inference, so the preview never stutters.

The HUD shows the live EAR against the baseline learned for your eyes, the
head state and angles, and the reasons behind the current score. Blink rate is
displayed but marked `(not scored)`.

## Layout

```
detector/
  pipeline.py    MediaPipe FaceLandmarker -> per-frame signals
  landmarks.py   FaceMesh indices -> EAR / MAR / head pose
  rules.py       DrowsinessMonitor: the temporal state machine (pure stdlib)
scripts/
  fetch_model.sh    download the FaceLandmarker model
  fetch_samples.sh  re-download the test clips
  run_webcam.py     live webcam client with HUD
  run_local.py      batch-score a clip, render an overlay
  test_rules.py     synthetic-trace tests for the rule engine
```

## Tests

```bash
.venv/bin/python scripts/test_rules.py
```

18 tests against synthetic EAR/MAR traces — no model, no network. Normal
blinking stays ALERT; 15 fast blinks are not drowsiness; a 1.5 s closure is a
microsleep and 4 s is CRITICAL; high PERCLOS escalates; three sustained yawns
register while speech-length openings do not; a lost face reports UNKNOWN and
recovers; 8 fps and 30 fps agree; blendshape inputs drive the same rules; the
score decays back to ALERT; PERCLOS stays out of the score until its window is
populated; and an occluded mouth is still caught via MAR.

Several real bugs were found this way rather than in production — see
*Bugs the tests caught* below.

## Tuning

Every threshold is in the `Thresholds` dataclass at the top of
`detector/rules.py`. The ones worth touching first:

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
