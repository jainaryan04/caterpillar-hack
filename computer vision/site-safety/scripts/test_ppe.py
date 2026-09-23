"""Tests for PPE association and violation confirmation.

No model, no video: synthetic boxes only, so the logic that decides who is
unprotected is checked directly.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))

from ppe import (Config, ComplianceMonitor, Detection, associate,  # noqa: E402
                 containment, iou)

FRAME_H = 1080
FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        FAILURES.append(name)


def person(x, y, w=120, h=360, conf=0.9):
    return Detection("person", (x, y, x + w, y + h), conf)


def helmet_for(p: Detection, conf=0.8):
    """A helmet box sitting on top of that person, where a real one would be."""
    x1, y1, x2, y2 = p.box
    cx, w = 0.5 * (x1 + x2), (x2 - x1) * 0.45
    return Detection("helmet", (cx - w / 2, y1 + 4, cx + w / 2, y1 + 46), conf)


def vest_for(p: Detection, conf=0.8):
    x1, y1, x2, y2 = p.box
    h = y2 - y1
    return Detection("vest", (x1 + 12, y1 + 0.28 * h, x2 - 12, y1 + 0.62 * h), conf)


# ---------------------------------------------------------------------------

def test_fully_kitted_worker():
    print("\n[1] helmet + vest on one worker -> compliant")
    p = person(400, 300)
    out = associate([p, helmet_for(p), vest_for(p)], FRAME_H, Config())
    check("one person returned", len(out) == 1, f"got {len(out)}")
    check("helmet attached", out[0].has_helmet)
    check("vest attached", out[0].has_vest)
    check("compliant", out[0].compliant)
    check("nothing listed missing", out[0].missing == [], f"{out[0].missing}")


def test_missing_gear_is_named():
    print("\n[2] missing items are identified, not just counted")
    p = person(400, 300)
    out = associate([p, helmet_for(p)], FRAME_H, Config())
    check("vest reported missing", out[0].missing == ["vest"], f"{out[0].missing}")
    check("not compliant", out[0].compliant is False)

    out = associate([p, vest_for(p)], FRAME_H, Config())
    check("helmet reported missing", out[0].missing == ["helmet"], f"{out[0].missing}")

    out = associate([p], FRAME_H, Config())
    check("both reported missing", out[0].missing == ["helmet", "vest"],
          f"{out[0].missing}")


def test_one_helmet_cannot_cover_two_people():
    print("\n[3] a single helmet must not mark two overlapping people compliant")
    a = person(400, 300)
    b = person(430, 305)          # standing close behind, boxes overlap heavily
    out = associate([a, b, helmet_for(a), vest_for(a), vest_for(b)],
                    FRAME_H, Config())
    check("two people found", len(out) == 2, f"got {len(out)}")
    helmets = sum(1 for p in out if p.has_helmet)
    check("exactly one wears the helmet", helmets == 1, f"got {helmets}")
    check("one compliant, one not",
          sum(1 for p in out if p.compliant) == 1,
          f"{[p.compliant for p in out]}")


def test_helmet_held_not_worn():
    print("\n[4] a helmet at waist height is not being worn")
    p = person(400, 300)
    x1, y1, x2, y2 = p.box
    h = y2 - y1
    carried = Detection("helmet", (x1 + 10, y1 + 0.70 * h, x1 + 60, y1 + 0.82 * h), 0.9)
    out = associate([p, carried, vest_for(p)], FRAME_H, Config())
    check("not counted as worn", out[0].has_helmet is False)
    check("still flagged missing helmet", out[0].missing == ["helmet"],
          f"{out[0].missing}")


def test_gear_belonging_to_nobody():
    print("\n[5] a helmet on a bench does not make anyone compliant")
    p = person(400, 300)
    stray = Detection("helmet", (50, 900, 100, 940), 0.9)
    out = associate([p, stray, vest_for(p)], FRAME_H, Config())
    check("stray helmet ignored", out[0].has_helmet is False)


def test_distant_specks_ignored():
    print("\n[6] people too small to judge are skipped")
    tiny = person(100, 100, w=14, h=40)     # ~4% of frame height
    out = associate([tiny], FRAME_H, Config())
    check("tiny person dropped", len(out) == 0, f"got {len(out)}")
    big = person(100, 100, w=120, h=360)
    check("normal person kept", len(associate([big], FRAME_H, Config())) == 1)


def test_violation_needs_to_persist():
    print("\n[7] a one-frame dropout is not a violation")
    mon = ComplianceMonitor()
    p = person(400, 300)
    t = 0.0
    for i in range(30):            # 1s compliant at 30fps
        dets = [p, helmet_for(p), vest_for(p)]
        mon.update(associate(dets, FRAME_H, mon.cfg), t, i); t += 1 / 30
    for i in range(3):             # 0.1s where the helmet detection drops
        mon.update(associate([p, vest_for(p)], FRAME_H, mon.cfg), t, i); t += 1 / 30
    check("no violation from a 0.1s dropout", len(mon.violations) == 0,
          f"got {len(mon.violations)}")

    for i in range(60):            # 2s genuinely without a helmet
        mon.update(associate([p, vest_for(p)], FRAME_H, mon.cfg), t, i); t += 1 / 30
    check("sustained absence is a violation", len(mon.violations) == 1,
          f"got {len(mon.violations)}")
    v = mon.violations[0]
    check("names the missing item", v.missing == ["helmet"], f"{v.missing}")
    check("duration is recorded", v.duration > 1.0, f"{v.duration}")


def test_violation_closes_on_compliance():
    print("\n[8] putting the helmet on closes the violation")
    mon = ComplianceMonitor()
    p = person(400, 300)
    t = 0.0
    for i in range(90):
        mon.update(associate([p, vest_for(p)], FRAME_H, mon.cfg), t, i); t += 1 / 30
    check("violation open", len(mon.violations) == 1, f"got {len(mon.violations)}")
    end_while_open = mon.violations[0].end
    for i in range(90):
        mon.update(associate([p, helmet_for(p), vest_for(p)], FRAME_H, mon.cfg),
                   t, i); t += 1 / 30
    check("still exactly one violation", len(mon.violations) == 1,
          f"got {len(mon.violations)}")
    check("it stopped extending", mon.violations[0].end <= end_while_open + 1.2,
          f"end={mon.violations[0].end} vs {end_while_open}")


def test_two_workers_tracked_separately():
    print("\n[9] two workers get independent verdicts")
    mon = ComplianceMonitor()
    a = person(200, 300)
    b = person(800, 300)
    t = 0.0
    for i in range(90):
        dets = [a, helmet_for(a), vest_for(a), b, vest_for(b)]
        rows = mon.update(associate(dets, FRAME_H, mon.cfg), t, i); t += 1 / 30
    check("two tracks", len({r['track_id'] for r in rows}) == 2, f"{rows}")
    check("one violation only", len(mon.violations) == 1, f"got {len(mon.violations)}")
    flagged = [r for r in rows if r["flagged"]]
    check("the bare-headed one is flagged", len(flagged) == 1, f"{flagged}")
    check("and it is the right box",
          flagged and abs(flagged[0]["box"][0] - 800) < 1, f"{flagged}")


def test_geometry_helpers():
    print("\n[10] geometry helpers")
    check("iou of identical boxes is 1", abs(iou((0, 0, 10, 10), (0, 0, 10, 10)) - 1) < 1e-6)
    check("iou of disjoint boxes is 0", iou((0, 0, 10, 10), (50, 50, 60, 60)) == 0)
    check("containment of inner box is 1",
          abs(containment((2, 2, 4, 4), (0, 0, 10, 10)) - 1) < 1e-6)
    check("half-outside box is ~0.5",
          abs(containment((-5, 0, 5, 10), (0, 0, 10, 10)) - 0.5) < 1e-6)


if __name__ == "__main__":
    for fn in [test_fully_kitted_worker, test_missing_gear_is_named,
               test_one_helmet_cannot_cover_two_people, test_helmet_held_not_worn,
               test_gear_belonging_to_nobody, test_distant_specks_ignored,
               test_violation_needs_to_persist, test_violation_closes_on_compliance,
               test_two_workers_tracked_separately, test_geometry_helpers]:
        fn()
    print("\n" + "=" * 60)
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {', '.join(FAILURES)}")
        sys.exit(1)
    print("all PPE logic tests passed")
