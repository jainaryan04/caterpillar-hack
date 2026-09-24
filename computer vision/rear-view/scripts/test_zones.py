"""Band and debounce tests. No models, no network.

    python scripts/test_zones.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "rearview"))

from zones import CLEAR, DANGER, WARN, Bands, Debounce, RearView  # noqa: E402

FAILURES = 0


def check(name, got, want):
    global FAILURES
    if got != want:
        FAILURES += 1
        print(f"  FAIL  {name}: got {got!r}, want {want!r}")
    else:
        print(f"  PASS  {name}")


class Obj:
    """Stand-in for a scored detection."""

    def __init__(self, proximity, label="person", source="coco"):
        self.proximity, self.label, self.source = proximity, label, source
        self.level = CLEAR
        self.box = (0, 0, 10, 10)


def main() -> int:
    b = Bands(danger=0.75, warn=0.55)
    check("above danger -> DANGER", b.band(0.80), DANGER)
    check("exactly danger -> DANGER", b.band(0.75), DANGER)
    check("between -> WARN", b.band(0.60), WARN)
    check("exactly warn -> WARN", b.band(0.55), WARN)
    check("below warn -> CLEAR", b.band(0.54), CLEAR)

    try:
        Bands(danger=0.4, warn=0.8)
        check("inverted bands rejected", "no error", "ValueError")
    except ValueError:
        check("inverted bands rejected", "ValueError", "ValueError")

    # Escalation is immediate -- a late warning is the dangerous failure.
    d = Debounce(hold=3)
    check("first DANGER fires at once", d.update(DANGER), DANGER)

    # ...and standing down waits, so one dropped detection cannot clear it.
    check("one calm frame holds DANGER", d.update(CLEAR), DANGER)
    check("two calm frames hold DANGER", d.update(CLEAR), DANGER)
    check("three calm frames stand down", d.update(CLEAR), CLEAR)

    # A flicker mid-stand-down restarts the count.
    d2 = Debounce(hold=3)
    d2.update(DANGER)
    d2.update(CLEAR)
    d2.update(DANGER)
    check("re-escalation resets", d2.level, DANGER)
    check("calm again 1", d2.update(CLEAR), DANGER)
    check("calm again 2", d2.update(CLEAR), DANGER)
    check("calm again 3", d2.update(CLEAR), CLEAR)

    # Standing down to WARN, not straight to CLEAR, when WARN is what is there.
    d3 = Debounce(hold=2)
    d3.update(DANGER)
    d3.update(WARN)
    check("steps down to WARN not CLEAR", d3.update(WARN), WARN)

    check("hold=1 stands down immediately",
          [Debounce(hold=1).update(x) for x in (DANGER, CLEAR)][-1], CLEAR)

    rv = RearView(Bands(0.75, 0.55), hold=1)
    verdict, objs = rv.assess([Obj(0.2), Obj(0.9), Obj(0.6)])
    check("verdict is the worst band present", verdict, DANGER)
    check("objects sorted nearest first", [round(o.proximity, 1) for o in objs],
          [0.9, 0.6, 0.2])
    check("levels rewritten per band", [o.level for o in objs], [DANGER, WARN, CLEAR])

    check("no objects -> CLEAR", RearView(hold=1).assess([])[0], CLEAR)

    print(f"\n{'all passed' if not FAILURES else f'{FAILURES} FAILED'}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
