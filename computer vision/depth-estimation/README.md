# Depth Estimation

Monocular depth from a single image, using [Depth Anything V2][dav2]. No stereo
rig, no LiDAR, no calibration — one RGB frame in, a per-pixel depth map out, at
~333 ms/frame on an M-series GPU.

```
image ──▶ DepthAnythingV2 (DINOv2 encoder + DPT head)
                      │
                      ▼
          HxW float32 relative inverse depth
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
      .npy          gray          Spectral_r
   (downstream)   (uint8)        (red near / blue far)
```

## What the numbers mean

The output is **relative inverse depth**: larger is closer, and it carries no
metric scale. On the construction-site sample the values run 0.00–14.41 — that
14.41 is the foreground, not 14 metres. The sky sits at exactly 0.00.

Normalisation is also **per-image**, so two frames of the same scene are not
comparable as pictures. Only the `.npy` values are, and even those are only
comparable up to an unknown per-image scale and shift. For real distances use
the upstream `metric_depth/` checkpoints instead — **vkitti** for outdoor and
site scenes, hypersim for indoor.

## Setup

The model *code* comes from the upstream checkout, which is gitignored at the
repo root — it is a clone, not our source:

```bash
git clone https://github.com/DepthAnything/Depth-Anything-V2 ../../Depth-Anything-V2
```

or point `DAV2_ROOT` at a copy you already have. Then:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./scripts/fetch_model.sh          # vitb, 372 MB
```

Weights are found in `models/` first, then the upstream `checkpoints/`, so an
existing download is picked up without copying. `--checkpoint` or
`DAV2_CHECKPOINT` override both.

## Use

```bash
# one image
.venv/bin/python scripts/run_image.py inputs/site.avif

# a folder, or a glob
.venv/bin/python scripts/run_image.py inputs/
.venv/bin/python scripts/run_image.py 'frames/*.jpg' --no-side-by-side

# faster, for a video-rate loop
.venv/bin/python scripts/run_image.py inputs/ --input-size 266
```

Four files per image land in `out/`: `_depth_raw.npy` (the real output),
`_depth_gray.png`, `_depth_color.png`, and `_side_by_side.png` for eyeballing.
Any of them can be turned off with `--no-npy` / `--no-gray` / `--no-color` /
`--no-side-by-side`.

cv2 reads `.avif` and `.webp` directly on OpenCV 4.13 — no conversion step.

### Video

```bash
.venv/bin/python scripts/run_video.py clip.mp4
.venv/bin/python scripts/run_video.py clip.mp4 --mode color --max-height 720
.venv/bin/python scripts/run_video.py clip.mp4 --stride 3 --input-size 266   # rough + fast
```

The model has no temporal component — this is `run_image` in a loop — but
video needs one thing stills do not: **a normalisation range fixed for the
whole clip**.

Normalising each frame to its own min/max makes the output pulse, because the
raw range moves as the scene does. Measured on the sample clip below, the
per-frame p99 wanders between 12.18 and 15.61 — a **25% swing**, with jumps up
to 0.91 between samples. Identical geometry would be painted a different colour
frame to frame.

So `--norm global` (the default) pre-scans 24 frames spread across the clip,
takes the p1/p99 range of each, and keeps the widest. Percentiles rather than
min/max, so a few speckle pixels cannot set the range for the entire video.
The scan costs one extra pass over those 24 frames. `--norm frame` restores the
per-frame behaviour if you want it.

Output defaults to `--max-height 960`: a 4K side-by-side is 4320x3840 and
neither watchable nor cheap to write.

### From Python

```python
import sys; sys.path.insert(0, "computer vision/depth-estimation/depth")
import cv2
from model import DepthEstimator

est = DepthEstimator(encoder="vitb")          # load once
depth = est.infer(cv2.imread("site.avif"))    # HxW float32, per frame
```

`DepthEstimator` holds no per-frame state, so the same instance serves a video
loop. Device is picked automatically: CUDA, else Apple MPS, else CPU.

## Encoder choice

| Encoder | Size | Notes |
|---|---|---|
| `vits` | 99 MB | fastest; use when depth is a coarse prior |
| `vitb` | 372 MB | **default** — what the samples below were run on |
| `vitl` | 1.3 GB | best quality, ~3.5x the weights of vitb |
| `vitg` | — | not released upstream |

## Cost

Measured on an M-series Mac (MPS), 740x555 input, median of 4 warm runs:

| `--input-size` | vitb |
|---|---|
| 266 | 65 ms |
| 392 | 161 ms |
| 518 (default) | 333 ms |
| 700 | 824 ms |

Roughly quadratic in input size, as the ViT patch count implies. Model load is
a one-off 2.9 s.

Two measurement traps worth knowing, both hit while producing that table:

- **The first frame is not representative.** 486 ms against a 333 ms steady
  median — MPS compiles the graph on first use.
- **Each new `input_size` pays that cost again.** Timed cold, `--input-size
  266` came out at 538 ms, i.e. *slower* than 518, which is backwards. It is
  actually 5x faster once its shape is warm. Warm per shape before timing
  anything.

## What it gets right, and where it softens

Run on a construction site — excavators, a dump truck, workers in a pit:

- **Excavator booms segment cleanly against the sky**, thin arms intact rather
  than smeared into the background. This is the detail that usually fails on
  heavy equipment.
- **The excavation pit reads as a bowl** — both walls show a symmetric gradient
  converging to the far end, near lip correctly closest.
- **Workers on the slab resolve as distinct nearer blobs**, separated from the
  concrete they stand on.
- **The far bank and treeline compress into a narrow band.** Inverse depth
  spends most of its resolution up close, so anything at range flattens. The
  dump truck partly blends into the spoil pile behind it for this reason.

That last point is the one to watch for any proximity or standoff-distance use:
the compression is inherent to inverse depth, not a tuning problem, and it is
the reason metric checkpoints exist.

### At night

A 7.2 s night-time concrete pour (2160x3840, 216 frames) is the harder case,
and it degrades in a specific way rather than failing outright:

- **Foreground geometry still separates cleanly.** The boom pole nearest the
  camera is unambiguously the closest thing in frame, and the mixer chute
  behind it sits correctly between pole and background.
- **Workers in hi-vis survive only as faint silhouettes.** They are visible in
  the depth map but poorly separated from the ground they stand on — the
  opposite of the daylight site, where they came out as distinct blobs.
- **Unlit regions are confidently wrong.** The top of the frame has real
  structure (gantry, parked trucks) that the model flattens into one smooth
  far-field wash. Where there is no light there is no texture, and the model
  fills in plausibly rather than abstaining.

The practical read: this is usable for *what is near the camera* at night, and
not usable for scene inventory. Nothing in the output marks the unlit regions
as low-confidence, so a downstream consumer cannot tell the difference —
that distinction has to come from somewhere else.

## Proximity alerts

`run_alert.py` answers "is anything too close?" over people, road vehicles and
construction equipment. It needs three models, because **Depth Anything V2
cannot do it alone**: it is a dense regression model, one float per pixel, no
semantics. It will say a region is near; it has no notion that the region *is
a worker*.

| model | where it runs | what it contributes |
|---|---|---|
| `yolo11m` | local | people and road vehicles (COCO) |
| construction-equipment model | HTTP endpoint | excavator, crane, tractor, truck |
| Depth Anything V2 | local | how near each of them is |

```bash
export ULTRALYTICS_API_KEY=ul_...             # for the equipment model

python scripts/run_alert.py inputs/site.avif
python scripts/run_alert.py clip.mp4 --alert 0.5 --remote-every 5
python scripts/run_alert.py inputs/site.avif --no-remote      # COCO only
python scripts/run_alert.py clip.mp4 --people-only            # drop vehicles
```

Without a key it prints one line and runs COCO-only rather than failing. The
endpoint client is `depth/remote.py`; `scripts/run_remote.py` drives it on its
own (`--info` shows what is deployed) with no depth involved.

Output is an annotated image or mp4 plus a JSON of every detection with its
box, depth, proximity, level and source.

### Why two detectors

COCO has 80 classes and **not one is heavy machinery** — no excavator, dozer,
loader, tractor or crane. Measured on the sample site image, COCO YOLO returns
12 people and 1 truck and misses *both excavators entirely*. They are the
largest objects in the frame.

Open-vocabulary detection was tried and rejected: at `imgsz 1280` YOLO-World's
"construction machine" prompt lands the correct box at **confidence 0.09**,
"excavator" and "bulldozer" do not fire at all, and the low threshold needed to
see it drags in duplicate person boxes — 26 detections against COCO's 11 on the
same frame. A model trained on the actual equipment is the fix, and that is
what the endpoint serves.

### The endpoint is an AERIAL model — check your viewpoint

The deployed model (`exp-delhi`, classes crane / excavator / other / tractor /
truck) is trained on **aerial worksite imagery**, and that is the single most
important thing to know before trusting it.

Measured both ways:

* **In domain it is excellent.** Given one of its own dataset images (2560x1440
  aerial) it returns 19 confident detections, and its top box
  `(314,789)-(458,915)` matches the ground-truth excavator `(317,790)-(463,914)`
  almost exactly.
* **On ground-level footage it is actively wrong.** On the sample site photo it
  misses *both* excavators and the dump truck — the largest objects in frame —
  and instead labels **a worker in the pit "excavator" at confidence 0.78** and
  another worker "truck" at 0.40, which raises a spurious ALERT at proximity
  1.00.

Calling a worker a truck is worse than missing the truck, so for a
ground-mounted camera run `--no-remote`, or keep `--remote-conf` high and treat
the equipment boxes as advisory. For drone or mast footage looking down, turn
it on.

The kind-ownership rule in `fuse.py` limits the damage: a mislabelled worker
comes back as kind `vehicle`, so it never displaces COCO's `person` box for the
same worker — both are drawn, and the safety-relevant one survives. It does not
prevent the extra false box.

### Who wins when both fire

Both detectors see the same dump truck, under different names. `depth/fuse.py`
decides by **kind**, not by confidence:

* **people belong to COCO** — trained on 200k+ person instances; the equipment
  model has seen people only incidentally.
* **vehicles and machinery belong to the equipment model** — that is the whole
  reason it exists.

A detection is dropped only when a box from the owning source covers the same
object (IoU ≥ `--iou`, default 0.55), so a truck the specialist misses is still
reported by COCO. Different kinds are never deduped — a worker standing on a
machine shares the box but not the class. `scripts/test_fuse.py` pins all of
this down with no models and no network.

Equipment-model boxes are drawn heavier and their labels prefixed with `*`.

### Cost of the endpoint

It is a network round trip per frame, far slower than either local model. For
video, `--remote-every N` calls it every Nth frame and reuses the last answer
in between; machinery does not move much between frames at 30 fps, so this
costs little and saves a lot.

### How the score is computed

Per detection, from the box and the depth map:

1. **Shrink the box by 20%.** A bounding box is a rectangle around a
   non-rectangular thing; its corners are the scene behind. On a person those
   corners drag the value toward "far" exactly when they step close.
2. **Take p80 of the depth inside it.** The alert cares about the *nearest*
   part of the object — an arm, a bucket — but the single max pixel is noise.
3. **Normalise against a reference range** (the frame's p1–p99, or the whole
   clip's for video) into `proximity` ∈ 0–1, where 1 is the near end.

On the daylight site image the ranking is exactly right: the crouching worker
at the bottom of the pit scores **0.85**, the workers mid-pit 0.38–0.66, and
the dump truck at the back **0.24**.

### Thresholds do not port between cameras

`--alert` is an absolute cut on a *relative* score, and the reference range is
set by whatever is nearest **in the whole scene** — often foreground clutter no
detector reports. On the night clip a boom pole and the concrete apron own the
near end, so detections top out at **proximity 0.57 across all 216 frames** and
the 0.75 default never fires, even though a worker is plainly close. Same code,
correct ranking, no alert.

`run_alert.py` prints the observed spread after a video run and says so when
nothing reached the threshold:

```
proximity observed: max 0.57, p90 0.55
NOTE: nothing reached --alert 0.75; lower it to suit this camera.
```

Set `--alert` from footage of *your* camera. The score is deliberately
relative — no calibration, no metres, no camera intrinsics to supply.

### Known rough edges

- **One scalar per object is wrong for large objects.** The concrete mixer
  spans most of the night frame; a single number for it means little. For
  anything that large the near corner matters more than the box average.
- **No tracking.** Every frame is scored independently, so a detector flicker
  is an alert flicker. ByteTrack is already in ultralytics; an N-of-M temporal
  gate is the obvious next step — the sibling sleep-detector makes the same
  argument about single frames.
- **Unlit regions are confidently wrong**, as above, and nothing in the score
  marks them low-confidence.

## Layout

```
depth/
  model.py      checkpoint + checkout resolution, device pick, DepthEstimator
  colorize.py   normalize / grayscale / colormap / side-by-side
  detect.py     YOLO wrapper, filtered to people and vehicles
  proximity.py  box + depth map -> proximity score and alert level
  remote.py     HTTP client for the equipment model on Ultralytics
scripts/
  fetch_model.sh  download a checkpoint into models/
  run_image.py    file, folder or glob -> out/
  run_video.py    video -> annotated mp4, clip-wide normalisation
  run_alert.py    image or video -> proximity alerts + JSON
  run_remote.py   image, folder, glob or URL -> equipment detections + JSON
```

[dav2]: https://github.com/DepthAnything/Depth-Anything-V2
