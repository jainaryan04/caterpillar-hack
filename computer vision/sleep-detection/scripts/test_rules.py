"""Synthetic-sequence tests for the drowsiness rule engine.

No model, no network: we feed the state machine EAR/MAR traces that stand in
for known behaviours and assert it reaches the right verdict. Run with:

    python scripts/test_rules.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "modal_app"))

from rules import DrowsinessMonitor, FrameSignals, Thresholds  # noqa: E402

OPEN_EAR = 0.30
SHUT_EAR = 0.08
CLOSED_MOUTH = 0.05
OPEN_MOUTH = 0.75

FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        FAILURES.append(name)


def feed(mon, *, duration, fps=20.0, ear=OPEN_EAR, mar=CLOSED_MOUTH,
         face=True, pitch=0.0, yaw=0.0, roll=0.0, t0=0.0):
    """Push `duration` seconds of identical frames. Returns (last_verdict, t)."""
    step = 1.0 / fps
    t = t0
    v = None
    n = max(1, int(round(duration * fps)))
    for _ in range(n):
        v = mon.update(
            FrameSignals(
                timestamp=t,
                face_found=face,
                ear=ear if face else None,
                mar=mar if face else None,
                pitch_deg=pitch if face else None,
                yaw_deg=yaw if face else None,
                roll_deg=roll if face else None,
                face_confidence=0.9 if face else 0.0,
            )
        )
        t += step
    return v, t


def blink(mon, t0, fps=20.0, closed_s=0.20, open_s=3.0):
    """One ordinary blink followed by an open-eye stretch."""
    _, t = feed(mon, duration=closed_s, fps=fps, ear=SHUT_EAR, t0=t0)
    v, t = feed(mon, duration=open_s, fps=fps, ear=OPEN_EAR, t0=t)
    return v, t


# ---------------------------------------------------------------------------

def test_alert_baseline():
    print("\n[1] normal driving with ordinary blinks -> ALERT")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    for _ in range(6):
        v, t = blink(mon, t)
    check("level is ALERT", v.level == "ALERT", f"got {v.level} score={v.score}")
    check("not flagged sleepy", v.sleepy is False)
    check("no microsleeps", v.microsleeps_recent == 0)
    check("baseline learned near open EAR",
          abs(v.ear_baseline - OPEN_EAR) < 0.03, f"baseline={v.ear_baseline}")
    check("blinks counted", v.blink_rate_per_min > 0, f"rate={v.blink_rate_per_min}")


def test_blinks_are_not_microsleeps():
    print("\n[2] fast blinking is not drowsiness")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=8.0)
    for _ in range(15):
        v, t = blink(mon, t, closed_s=0.15, open_s=1.0)
    check("still ALERT after 15 blinks", v.level == "ALERT",
          f"got {v.level} score={v.score} reasons={v.reasons}")
    check("zero microsleep events", v.microsleeps_recent == 0)


def test_microsleep():
    print("\n[3] eyes shut 1.5s -> microsleep, sleepy")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    v, t = feed(mon, duration=1.5, ear=SHUT_EAR, t0=t)
    check("eyes reported closed", v.eyes_closed is True)
    check("closure duration ~1.5s", 1.2 <= v.closure_s <= 1.7, f"got {v.closure_s}")
    check("flagged sleepy", v.sleepy is True, f"level={v.level} score={v.score}")
    check("reason mentions closure",
          any("closed" in r for r in v.reasons), f"reasons={v.reasons}")


def test_long_closure_is_critical():
    print("\n[4] eyes shut 4s -> CRITICAL")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    v, t = feed(mon, duration=4.0, ear=SHUT_EAR, t0=t)
    check("level is CRITICAL", v.level == "CRITICAL", f"got {v.level} score={v.score}")
    check("score saturated high", v.score >= 75, f"score={v.score}")


def test_perclos():
    print("\n[5] heavy-lidded driving (high PERCLOS) -> elevated")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    # 0.8s shut / 1.2s open, repeatedly: each closure clears the blink bar.
    for _ in range(20):
        _, t = feed(mon, duration=0.8, ear=SHUT_EAR, t0=t)
        v, t = feed(mon, duration=1.2, ear=OPEN_EAR, t0=t)
    check("PERCLOS above drowsy threshold", v.perclos >= 0.25, f"perclos={v.perclos}")
    check("level at least MILD", v.level in ("MILD", "DROWSY", "CRITICAL"),
          f"got {v.level} score={v.score}")
    check("PERCLOS named as a reason",
          any("PERCLOS" in r for r in v.reasons), f"reasons={v.reasons}")


def test_yawning():
    print("\n[6] three sustained yawns -> elevated; talking is not a yawn")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    for _ in range(3):
        _, t = feed(mon, duration=2.5, mar=OPEN_MOUTH, t0=t)
        v, t = feed(mon, duration=6.0, mar=CLOSED_MOUTH, t0=t)
    check("three yawns counted", v.yawns_in_window == 3, f"got {v.yawns_in_window}")
    check("level at least MILD", v.level in ("MILD", "DROWSY", "CRITICAL"),
          f"got {v.level} score={v.score}")

    chatty = DrowsinessMonitor()
    v2, t2 = feed(chatty, duration=10.0)
    for _ in range(12):  # short mouth openings = speech
        _, t2 = feed(chatty, duration=0.4, mar=OPEN_MOUTH, t0=t2)
        v2, t2 = feed(chatty, duration=0.5, mar=CLOSED_MOUTH, t0=t2)
    check("speech produces no yawns", v2.yawns_in_window == 0,
          f"got {v2.yawns_in_window}")
    check("talking stays ALERT", v2.level == "ALERT",
          f"got {v2.level} score={v2.score} reasons={v2.reasons}")


def test_face_lost():
    print("\n[7] face not visible -> no phantom closure, and it recovers")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    v, t = feed(mon, duration=40.0, face=False, t0=t)
    # Sustained loss is an alert now (see test 17), but it must never be
    # reported as an eye-closure event that never happened.
    check("no microsleep invented", v.microsleeps_recent == 0)
    check("eyes not claimed closed", v.eyes_closed is False)
    check("reason is the lost face, not the eyes",
          any("face not visible" in r for r in v.reasons), f"reasons={v.reasons}")

    v, t = feed(mon, duration=15.0, t0=t)
    check("recovers to ALERT once face returns", v.level == "ALERT",
          f"got {v.level} score={v.score}")


def test_frame_rate_independence():
    print("\n[8] same scenario at 8 fps and 30 fps -> same verdict")
    results = {}
    for fps in (8.0, 30.0):
        mon = DrowsinessMonitor()
        v, t = feed(mon, duration=12.0, fps=fps)
        v, t = feed(mon, duration=2.0, fps=fps, ear=SHUT_EAR, t0=t)
        results[fps] = v
    a, b = results[8.0], results[30.0]
    check("levels agree", a.level == b.level, f"{a.level} vs {b.level}")
    check("closure durations within 0.3s", abs(a.closure_s - b.closure_s) < 0.3,
          f"{a.closure_s} vs {b.closure_s}")
    check("both sleepy", a.sleepy and b.sleepy)


def test_blendshape_path():
    print("\n[9] mediapipe blendshape inputs drive the same rules")
    mon = DrowsinessMonitor()
    t = 0.0
    for _ in range(200):  # 10s open at 20fps
        v = mon.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                    mar=CLOSED_MOUTH, blink_score=0.05,
                                    jaw_open_score=0.05))
        t += 0.05
    check("open eyes -> ALERT", v.level == "ALERT", f"got {v.level}")
    for _ in range(40):  # 2s of blink_score high
        v = mon.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                    mar=CLOSED_MOUTH, blink_score=0.95,
                                    jaw_open_score=0.05))
        t += 0.05
    check("blendshape closure overrides EAR", v.sleepy is True,
          f"level={v.level} score={v.score} closure={v.closure_s}")


def test_recovery():
    print("\n[10] driver wakes up -> score decays back to ALERT")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=10.0)
    v, t = feed(mon, duration=3.0, ear=SHUT_EAR, t0=t)
    check("sleepy during closure", v.sleepy is True, f"level={v.level}")
    v, t = feed(mon, duration=90.0, t0=t)
    check("back to ALERT after 90s alert driving", v.level == "ALERT",
          f"got {v.level} score={v.score} reasons={v.reasons}")


def test_perclos_needs_warmup():
    print("\n[11] PERCLOS does not score before enough time is observed")
    # A session that opens mid-closure: one frame of shut eyes is 100% of the
    # window, but the window is 40ms long and means nothing.
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=0.3, fps=25.0, ear=SHUT_EAR)
    check("perclos reported as 1.0", v.perclos > 0.9, f"perclos={v.perclos}")
    check("but PERCLOS is not a scoring reason",
          not any("PERCLOS" in r for r in v.reasons), f"reasons={v.reasons}")
    check("level not inflated to MILD by it", v.level == "ALERT",
          f"got {v.level} score={v.score} reasons={v.reasons}")

    # Once the window is genuinely populated, PERCLOS counts again.
    mon2 = DrowsinessMonitor()
    v2, t2 = feed(mon2, duration=10.0)
    for _ in range(12):
        _, t2 = feed(mon2, duration=0.8, ear=SHUT_EAR, t0=t2)
        v2, t2 = feed(mon2, duration=1.2, ear=OPEN_EAR, t0=t2)
    check("scores PERCLOS once warmed up",
          any("PERCLOS" in r for r in v2.reasons), f"reasons={v2.reasons}")


def test_yawn_detected_when_blendshape_is_occluded():
    print("\n[12] a hand over the mouth must not hide a yawn")
    # Real case from samples/yawning_woman_720p.mp4: her hand covers her mouth,
    # so jawOpen only reached 0.63 briefly while geometric MAR hit 0.83.
    mon = DrowsinessMonitor()
    t = 0.0
    for _ in range(200):  # 10s of calm, both signals quiet
        v = mon.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                    mar=CLOSED_MOUTH, blink_score=0.05,
                                    jaw_open_score=0.02))
        t += 0.05
    for _ in range(40):   # 2s yawn: MAR sees it, jawOpen stays under threshold
        v = mon.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                    mar=0.83, blink_score=0.05,
                                    jaw_open_score=0.20))
        t += 0.05
    check("yawn counted from MAR despite low jawOpen", v.yawns_in_window == 1,
          f"got {v.yawns_in_window}")

    # The duration gate must still reject speech on the MAR path.
    chatty = DrowsinessMonitor()
    t = 0.0
    for _ in range(200):
        v2 = chatty.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                        mar=CLOSED_MOUTH, blink_score=0.05,
                                        jaw_open_score=0.02))
        t += 0.05
    for _ in range(14):
        for _ in range(8):   # 0.4s open
            v2 = chatty.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                            mar=0.83, blink_score=0.05,
                                            jaw_open_score=0.02))
            t += 0.05
        for _ in range(10):  # 0.5s closed
            v2 = chatty.update(FrameSignals(timestamp=t, face_found=True, ear=OPEN_EAR,
                                            mar=CLOSED_MOUTH, blink_score=0.05,
                                            jaw_open_score=0.02))
            t += 0.05
    check("speech on the MAR path is still not a yawn", v2.yawns_in_window == 0,
          f"got {v2.yawns_in_window}")


# --- the two things live testing surfaced -----------------------------------

def test_talking_never_alerts():
    print("\n[13] a driver holding a conversation stays silent")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=12.0)
    # Speech: mouth opening to a speech-sized 0.55 (below the 0.72 bar),
    # 200-500ms at a time, with blinks mixed in, for a solid minute.
    for i in range(45):
        _, t = feed(mon, duration=0.25, mar=0.55, t0=t)
        _, t = feed(mon, duration=0.35, mar=0.20, t0=t)
        if i % 5 == 0:
            _, t = feed(mon, duration=0.20, ear=SHUT_EAR, t0=t)
        v, t = feed(mon, duration=0.40, t0=t)
    check("stays ALERT through 60s of talking", v.level == "ALERT",
          f"got {v.level} score={v.score} reasons={v.reasons}")
    check("no yawns logged", v.yawns_in_window == 0, f"got {v.yawns_in_window}")
    check("no microsleeps logged", v.microsleeps_recent == 0)


def test_heavy_blinking_never_alerts():
    print("\n[14] frequent, slightly slow blinking is not an alert")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=12.0)
    # ~24 blinks/min at 400ms each. Real blink rates run 15-25/min at
    # 100-400ms; this is the busy end of normal, ~16% PERCLOS.
    for _ in range(30):
        _, t = feed(mon, duration=0.40, ear=SHUT_EAR, t0=t)
        v, t = feed(mon, duration=2.10, t0=t)
    check("stays ALERT", v.level == "ALERT",
          f"got {v.level} score={v.score} reasons={v.reasons}")
    check("blink rate is still reported", v.blink_rate_per_min > 0,
          f"rate={v.blink_rate_per_min}")
    check("slow blinks are not a reason",
          not any("blink" in r.lower() for r in v.reasons), f"reasons={v.reasons}")
    check("PERCLOS stayed under the mild bar", v.perclos < 0.18,
          f"perclos={v.perclos}")


def test_doze_head_drops_forward():
    print("\n[15] chin drops toward chest -> DROWSY even with eyes visible")
    mon = DrowsinessMonitor()
    # Dash camera: their attentive forward pitch is -10, not 0.
    v, t = feed(mon, duration=20.0, pitch=-10.0)
    check("learned their forward pitch", v.pitch_baseline is not None
          and abs(v.pitch_baseline + 10.0) < 3.0, f"baseline={v.pitch_baseline}")
    check("normal posture reads forward", v.head_state == "forward",
          f"got {v.head_state}")
    v, t = feed(mon, duration=2.0, pitch=-34.0, t0=t)
    check("classified as head down", v.head_state == "down", f"got {v.head_state}")
    check("flagged sleepy", v.sleepy is True,
          f"level={v.level} score={v.score} reasons={v.reasons}")


def test_doze_head_rolls_to_the_side():
    print("\n[16] head tipping onto a shoulder -> DROWSY")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=20.0)
    v, t = feed(mon, duration=3.0, roll=-35.0, t0=t)
    check("classified as tilted", v.head_state == "tilted", f"got {v.head_state}")
    check("flagged sleepy", v.sleepy is True,
          f"level={v.level} score={v.score} reasons={v.reasons}")

    turned = DrowsinessMonitor()
    v2, t2 = feed(turned, duration=20.0)
    v2, t2 = feed(turned, duration=3.0, yaw=48.0, t0=t2)
    check("head turned far off-axis also counts", v2.sleepy is True,
          f"level={v2.level} reasons={v2.reasons}")

    # A glance at a mirror is not a doze.
    glance = DrowsinessMonitor()
    v3, t3 = feed(glance, duration=20.0)
    v3, t3 = feed(glance, duration=0.6, yaw=48.0, t0=t3)
    v3, t3 = feed(glance, duration=3.0, t0=t3)
    check("a brief mirror glance does not alert", v3.level == "ALERT",
          f"got {v3.level} score={v3.score} reasons={v3.reasons}")


def test_face_lost_long_is_an_alert_not_silence():
    print("\n[17] face gone for seconds must alert, not go quiet")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=20.0)
    v, t = feed(mon, duration=2.0, face=False, t0=t)
    check("a 2s gap does not alert", v.level in ("ALERT", "UNKNOWN") and not v.sleepy,
          f"got {v.level} score={v.score}")
    v, t = feed(mon, duration=3.0, face=False, t0=t)
    check("5s of no face is an alert", v.level != "UNKNOWN" and v.score > 0,
          f"got {v.level} score={v.score}")
    check("reason names the cause",
          any("face not visible" in r for r in v.reasons), f"reasons={v.reasons}")
    v, t = feed(mon, duration=4.0, face=False, t0=t)
    check("9s of no face is severe", v.sleepy is True,
          f"level={v.level} score={v.score}")


def test_wide_yawn_alone_alerts():
    print("\n[18] one long fully-open mouth is enough")
    mon = DrowsinessMonitor()
    v, t = feed(mon, duration=20.0)
    v, t = feed(mon, duration=2.0, mar=0.85, t0=t)
    check("flagged sleepy on a single sustained yawn", v.sleepy is True,
          f"level={v.level} score={v.score} reasons={v.reasons}")
    check("reason names the mouth",
          any("mouth" in r for r in v.reasons), f"reasons={v.reasons}")


if __name__ == "__main__":
    for fn in [
        test_alert_baseline,
        test_blinks_are_not_microsleeps,
        test_microsleep,
        test_long_closure_is_critical,
        test_perclos,
        test_yawning,
        test_face_lost,
        test_frame_rate_independence,
        test_blendshape_path,
        test_recovery,
        test_perclos_needs_warmup,
        test_yawn_detected_when_blendshape_is_occluded,
        test_talking_never_alerts,
        test_heavy_blinking_never_alerts,
        test_doze_head_drops_forward,
        test_doze_head_rolls_to_the_side,
        test_face_lost_long_is_an_alert_not_silence,
        test_wide_yawn_alone_alerts,
    ]:
        fn()

    print("\n" + "=" * 60)
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {', '.join(FAILURES)}")
        sys.exit(1)
    print("all rule-engine tests passed")
