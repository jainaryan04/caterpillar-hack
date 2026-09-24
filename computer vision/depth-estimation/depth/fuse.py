"""Merging detections from the local COCO model and the remote equipment model.

The two detectors overlap: COCO knows `person`, `truck`, `car`; the deployed
construction model knows `excavator`, `crane`, `tractor`, `truck`. Run both and
the same dump truck comes back twice, once under each name.

Rather than trusting whichever fired harder, ownership is decided by *kind*:

* **people belong to COCO.** It is trained on 200k+ person instances; an
  equipment model has seen people only incidentally, if at all.
* **vehicles and machinery belong to the equipment model.** That is the whole
  reason it exists -- COCO has no machinery class, measured on the site sample
  it misses both excavators outright.

A detection is dropped only when a box from the owning source covers the same
object. Everything else survives, so a truck the specialist misses is still
reported by COCO.
"""

from __future__ import annotations

from typing import Iterable, Sequence

from detect import Detection

# kind -> the source whose verdict wins when the two overlap
OWNER = {"person": "coco", "vehicle": "remote"}


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def tag(detections: Iterable[Detection], source: str) -> list[Detection]:
    """Stamp a source onto detections without mutating the originals."""
    out = []
    for d in detections:
        out.append(Detection(label=d.label, confidence=d.confidence,
                             box=d.box, kind=d.kind, source=source))
    return out


def merge(groups: Sequence[Sequence[Detection]], iou_thresh: float = 0.55) -> list[Detection]:
    """Combine per-source detection lists, dropping cross-source duplicates.

    Within one source the detector has already run NMS, so only cross-source
    pairs are compared.
    """
    everything = [d for group in groups for d in group]
    keep: list[Detection] = []

    for det in everything:
        owner = OWNER.get(det.kind)
        drop = False
        for other in everything:
            if other is det or other.source == det.source:
                continue
            if other.kind != det.kind:
                continue
            if iou(det.box, other.box) < iou_thresh:
                continue
            # Same object, two sources. The owning source wins; if neither is
            # the owner, confidence breaks the tie.
            if owner is not None and det.source != owner and other.source == owner:
                drop = True
                break
            if owner is None or (det.source != owner and other.source != owner):
                if (other.confidence, other.source) > (det.confidence, det.source):
                    drop = True
                    break
        if not drop:
            keep.append(det)
    return keep
