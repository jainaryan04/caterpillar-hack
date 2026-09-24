# Rear View

Reversing-camera proximity alert. Anything that gets too close behind the
machine raises **STOP**; the band below it raises **CAUTION**.

```
frame ─┬─▶ yolo11m (local)          people, road vehicles
       ├─▶ equipment model (HTTP)   excavator / crane / tractor / truck
       └─▶ Depth Anything V2        per-pixel depth
                    │
              proximity 0-1 per object
                    │
         Bands ──▶ DANGER / WARN / CLEAR
                    │
              Debounce (hold N)
                    │
              one verdict per frame
```

## Relationship to depth-estimation

The detection and depth stack is **imported** from `../depth-estimation`, not
copied — `detect.py`, `remote.py`, `fuse.py`, `proximity.py`, `model.py` and
`overlay.py` are the same files. A fix there lands here. Keep the two folders
side by side; the script says so plainly if they are not:

```
shared modules not found at .../depth-estimation/depth --
rear-view reuses ../depth-estimation, keep them side by side
```

What this folder adds is the reversing decision, and only that:

```
rearview/
  zones.py    Bands (3-band cut) + Debounce (verdict stability) + RearView
  display.py  three-band drawing, STOP banner, full-frame border at DANGER
scripts/
  run_rearview.py  image or video -> annotated output + JSON
  test_zones.py    band and debounce tests, no models or network
```

Set up the API key and depth checkpoint once in `../depth-estimation`
(`.env` and `models/`); this reads them from there.

## Use

```bash
python scripts/run_rearview.py clip.mp4
python scripts/run_rearview.py inputs/site.avif --danger 0.7 --warn 0.45
python scripts/run_rearview.py clip.mp4 --no-remote --hold 5
```

Output is an annotated image or mp4 plus a JSON carrying the verdict per
frame, every object, and the list of verdict transitions with timestamps.

## The two things that are not just a threshold

### Escalation is immediate, standing down is not

A reversing camera is the worst case for per-frame scoring. The detector drops
a box for one frame and a STOP would blink off while the obstacle is still
there.

So `Debounce` is deliberately asymmetric: **getting closer is acted on at
once**, and clearing requires `--hold` consecutive calmer frames (default 3, a
tenth of a second at 30 fps). A late warning is the dangerous failure; a
warning that lingers a fraction of a second too long is not.

It also steps *down* rather than straight to clear — DANGER falls back to WARN
if WARN is what is actually there. Measured on the night sample at
`--danger 0.55 --hold 4`: 5 transitions across 60 frames, with the nearest
worker hovering right at the band edge.

### Bands are per-camera, and the score is relative

Proximity is 1.0 at the near end of *what this camera can see*, not at a fixed
distance. The reference range is set by whatever is nearest in frame, which is
often bodywork or ground clutter no detector reports.

So calibrate rather than trust the defaults: mount the camera, reverse toward
a cone, and read the proximity values out of the JSON at the distances you
care about. The run prints the observed spread and says so when nothing ever
reached the band:

```
proximity seen: max 0.57, p90 0.55
NOTE: nothing reached --danger 0.75; set the bands from this camera's own footage.
```

`--max-box-frac` (default 0.9) drops boxes covering most of the frame. On a
reversing camera that is the machine's own bodywork, which would otherwise be
the nearest thing in every frame and hold STOP on forever.

## Tests

```bash
python scripts/test_zones.py
```

20 tests over the band cuts and the debounce state machine — boundaries are
inclusive, inverted bands are rejected, one calm frame cannot clear a STOP,
a flicker mid-stand-down restarts the count, and the verdict steps down to
WARN rather than skipping to CLEAR.

## Inherited limitations

These come from the shared stack and are written up in
`../depth-estimation/README.md`:

- The equipment endpoint is trained on **aerial** imagery. On a ground-level
  rear-view camera it mislabels people as machinery — use `--no-remote` there.
- No tracking. Objects are matched frame to frame only by the debounce, not by
  identity, so a crossing worker and a static post are not distinguished.
- A single proximity per object is crude for anything large and close.
