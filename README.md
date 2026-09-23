# Smart Operator Assistant — Safety Subsystem

Real-time CV safety for CAT machinery. Two cameras, three models, one operator HUD.
All inference runs on Modal, so the demo laptop only captures and draws.

| Camera | Models | Detects |
|---|---|---|
| Operator-facing | MediaPipe Face Landmarker (CPU) | eye closure, PERCLOS, microsleep, yawning, head drop, gaze-off-path, operator absence |
| Forward | YOLO26x (COCO) + ByteTrack, Depth Anything V2 Metric-Outdoor-Large (A100) | people and vehicles with **metric distance**, closing speed / time-to-contact, and class-agnostic obstacles |

## Why depth, not homography

Monocular metric depth gives a real distance in metres for every pixel, so proximity
zones need no camera calibration and obstacle detection needs no class list. A spoil
heap, a trench edge or a concrete barrier is never a COCO class — but it is always a
protrusion above the ground plane, and that is what `_obstacles()` looks for.

## Setup

```bash
pip install -r requirements.txt
python scripts/fetch_demo_media.py      # 4 verified construction clips into ./media
modal token new                          # one-time
modal deploy modal_app/api.py
```

Deploy prints the endpoint. Then:

```bash
python -m client.run \
  --endpoint https://<workspace>--cat-operator-safety-web.modal.run \
  --driver-source 0 \
  --front-source media/front_workers.mp4 \
  --record out/demo.mp4
```

`--driver-source 0` is your webcam — close your eyes on stage and the fatigue alert
fires live. That demos better than any video file.

Check it renders before deploying anything:

```bash
python scripts/smoke_test.py            # writes out/hud_preview.png against mocked responses
```

## Tuning

| Flag | Default | Notes |
|---|---|---|
| `--hfov` | 70 | forward camera horizontal FOV; wrong value skews every distance |
| `--cam-height` | 2.6 | camera height above ground, metres — sets the ground plane |
| `--corridor-width` | 5.0 | machine path width; obstacles outside it are ignored |
| `--front-fps` | 6 | forward inference rate. Depth dominates cost; the HUD still draws at full rate |
| `--driver-fps` | 8 | fatigue is a multi-second state, so more frames buy nothing |

Zone thresholds (`DANGER_M = 3`, `CAUTION_M = 7`) live in `client/safety_rules.py`.
Fatigue thresholds live at the top of `client/fatigue.py`.

## Architecture notes

- **No queues.** `FrameSource` and `InferenceWorker` hold at most one frame and
  overwrite it. A FIFO between capture and inference is what makes "real-time" demos
  drift seconds behind reality.
- **Render never blocks on the network.** The HUD draws the most recent result at
  full frame rate while inference happens at whatever the round trip allows.
- **Temporal logic is client-side.** PERCLOS, microsleep and closing speed all need
  history, and the state machines are time-based so dropped frames skew nothing.
- **Per-operator calibration.** Eye shape varies enough between people that a fixed
  EAR threshold misfires; `FatigueMonitor` learns a baseline over the first 4 seconds
  and fuses it with MediaPipe's blendshape score so either signal can fail alone.

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `POST /front` | raw JPEG | detections with distance + lateral offset, obstacles, depth preview PNG, timings |
| `POST /driver` | raw JPEG | EAR/MAR, blendshapes, head pose, face box |
| `POST /incident` | JSON | appends to durable incident log |
| `GET /incidents` | — | recent incidents |
| `GET /health` | — | liveness |

Raw JPEG bodies rather than multipart or base64 — upload time dominates the round trip.

## Data

Models are pretrained; nothing here requires a training run. If you want a trained
component to talk about, the highest-leverage one is a small GRU over a window of
`[eyeBlinkL, eyeBlinkR, jawOpen, pitch, yaw]` trained on
[UTA-RLDD](https://www.kaggle.com/datasets/mathiasviborg/uta-rldd-videos-cropped-by-faces) —
it beats hand-tuned thresholds and trains on CPU in minutes.
