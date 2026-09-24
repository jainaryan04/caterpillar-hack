"""Cross-detector merge tests. No models, no network.

    python scripts/test_fuse.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "depth"))

import fuse  # noqa: E402
from detect import Detection  # noqa: E402

FAILURES = 0


def D(label, kind, box, conf, src):
    return Detection(label=label, confidence=conf, box=box, kind=kind, source=src)


def check(name, got, want):
    global FAILURES
    if got != want:
        FAILURES += 1
        print(f"  FAIL  {name}\n        got  {got}\n        want {want}")
    else:
        print(f"  PASS  {name}")


def main() -> int:
    # Vehicles belong to the equipment model, even when COCO is more confident:
    # COCO calling an excavator a "truck" is the failure this exists to fix.
    check("overlapping vehicle -> equipment model wins",
          [(d.label, d.source) for d in fuse.merge([
              [D("truck", "vehicle", (100, 100, 200, 200), 0.90, "coco")],
              [D("excavator", "vehicle", (105, 102, 198, 205), 0.40, "remote")]])],
          [("excavator", "remote")])

    # People belong to COCO, which has seen far more of them.
    check("overlapping person -> coco wins",
          [(d.label, d.source) for d in fuse.merge([
              [D("person", "person", (10, 10, 40, 90), 0.60, "coco")],
              [D("worker", "person", (11, 12, 41, 92), 0.95, "remote")]])],
          [("person", "coco")])

    check("disjoint objects both kept",
          sorted(d.label for d in fuse.merge([
              [D("person", "person", (0, 0, 20, 50), 0.8, "coco")],
              [D("crane", "vehicle", (300, 300, 400, 400), 0.5, "remote")]])),
          ["crane", "person"])

    # A truck the specialist misses must still be reported, not dropped for
    # not having a match.
    check("unmatched coco vehicle survives",
          sorted(d.label for d in fuse.merge([
              [D("truck", "vehicle", (500, 230, 630, 295), 0.88, "coco")],
              [D("excavator", "vehicle", (100, 100, 200, 200), 0.7, "remote")]])),
          ["excavator", "truck"])

    # A worker standing on a machine shares the box but not the kind.
    check("different kinds are never deduped",
          len(fuse.merge([[D("person", "person", (100, 100, 150, 200), 0.8, "coco")],
                          [D("excavator", "vehicle", (100, 100, 150, 200), 0.8, "remote")]])),
          2)

    check("coco alone passes through",
          len(fuse.merge([[D("person", "person", (0, 0, 10, 10), 0.5, "coco")]])), 1)

    check("boxes below the IoU threshold are both kept",
          len(fuse.merge([[D("truck", "vehicle", (0, 0, 100, 100), 0.9, "coco")],
                          [D("crane", "vehicle", (60, 60, 160, 160), 0.9, "remote")]])), 2)

    check("iou identical", round(fuse.iou((0, 0, 10, 10), (0, 0, 10, 10)), 2), 1.0)
    check("iou disjoint", round(fuse.iou((0, 0, 10, 10), (10, 10, 20, 20)), 2), 0.0)
    check("iou half", round(fuse.iou((0, 0, 10, 10), (0, 0, 5, 10)), 2), 0.5)

    print(f"\n{'all passed' if not FAILURES else f'{FAILURES} FAILED'}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
