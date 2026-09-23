# Site Safety — PPE Compliance Detection

Hosts a YOLOv12 checkpoint (`vest`, `helmet`, `person`) on Modal and scores a
video for PPE compliance: who is missing a helmet or vest, and for how long.

> **Status: the pipeline is deployed and verified; the supplied checkpoint does
> not detect on real site footage.** See *Model evaluation* below before using
> this for anything. The hosting, association and violation logic are sound and
> will work with any checkpoint exposing these three classes.

## Why association, not counting

The model detects `person`, `helmet` and `vest` as independent boxes. "Three
helmets in frame" says nothing about whether the five people on site are
protected, so the boxes have to be tied together:

- **Containment + body band.** A helmet must fall in the top ~38% of a person's
  box, a vest across the torso band. A helmet carried at waist height, or one
  sitting on a bench, does not count as worn.
- **One-to-one assignment.** Gear is claimed greedily by confidence, so a single
  helmet cannot mark two overlapping people compliant — the failure that makes
  naive counting useless on a crowded site.
- **Temporal confirmation.** A detection dropping for a few frames is normal. A
  violation must persist 1.5 s before it is opened, and 1 s of compliance closes
  it. Each person is tracked by IoU across frames so violations attach to a
  person, not a frame.

## Use

```bash
pip install modal opencv-python
python3 -m modal setup

python scripts/upload_model.py ~/Downloads/yolov12m-builder.pt
modal deploy modal_app/app.py

python scripts/run_video.py site.mp4 --out annotated.mp4 \
    --snapshots shots/ --json result.json --stride 3
```

Output is per-person and time-bounded:

```
confirmed violations : 2
  person #3   t=  4.2-  9.8s ( 5.6s)  missing: helmet
  person #7   t= 12.0- 20.0s ( 8.0s)  missing: helmet, vest
```

`--snapshots` writes a JPEG of each frame where a violation opened.

| Endpoint | Purpose |
|---|---|
| `POST /analyze` | single frame → per-person compliance + raw boxes |
| `GET /health` | class map, GPU/CPU config |

Runs CPU-only by default (8 cores, batched inference). `SITE_SAFETY_GPU=T4
modal deploy modal_app/app.py` enables a GPU, which needs a payment method.

## Model evaluation

The supplied `yolov12m-builder.pt` reports strong numbers on its own validation
split — precision 0.971, recall 0.951, mAP50 0.980, mAP50-95 0.720, 50 epochs
from `yolo12m.pt` on `builder.yaml`. It does not transfer to stock construction
footage:

| test | result |
|---|---|
| 3 Pexels site clips, 8 sampled frames | 0–1 detections per frame; **never a `person`** |
| conf swept to 0.05, imgsz to 1280 | still zero |
| 8 tight single-worker crops, upscaled to 640 | 1 detection total (a helmet) |
| 2×2 tiled inference at 2× upscale | zero |
| clean crop of 2 workers in yellow helmets + hi-vis vests, 3× upscale | zero |
| **stock `yolo11n.pt` (5.4 MB) on the same frame** | **12 people, heights 149–240 px** |

The control matters: those people are large and obvious, and a nano COCO model
finds them instantly. So this is neither a small-object nor a threshold problem.
Near-perfect validation metrics alongside zero real-world recall is the
signature of a train/val split drawn from one narrow domain.

Hosted inference was checked against local inference on the same frames and
matches exactly (`helmet 0.638`, `vest 0.153`, none), so the deployment is not
at fault.

## Layout

```
detector/
  ppe.py         association, tracking, violation confirmation (pure stdlib)
  inference.py   YOLO wrapper: frames -> Detections
modal_app/
  app.py         Modal app: image, volume, endpoints, batched video job
scripts/
  upload_model.py  push the checkpoint to the Modal Volume
  run_video.py     score a video on Modal, render the result locally
  test_ppe.py      tests for the association and violation logic
```

## Tests

```bash
python scripts/test_ppe.py
```

10 tests, 28 assertions, no model or network needed: gear is attached to the
right person, one helmet cannot cover two people, a carried helmet is not worn,
stray gear is ignored, distant specks are skipped, a 0.1 s dropout is not a
violation while a sustained absence is, violations close when gear goes on, and
two workers get independent verdicts.
