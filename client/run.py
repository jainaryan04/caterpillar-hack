"""Entry point: two cameras in, one operator HUD out.

    python -m client.run \
        --endpoint https://<workspace>--cat-operator-safety-web.modal.run \
        --driver-source media/driver.mp4 \
        --front-source media/front.mp4
"""

import argparse
import json
import time

import cv2
import requests

from .capture import FrameSource, InferenceWorker, encode_jpeg
from .fatigue import FatigueMonitor
from .render import compose
from .safety_rules import ProximityMonitor


def build_front_infer(session, endpoint, args):
    params = {
        "with_depth": "true",
        "conf": str(args.conf),
        "hfov_deg": str(args.hfov),
        "cam_height_m": str(args.cam_height),
        "corridor_half_width_m": str(args.corridor_width / 2.0),
        "max_range_m": str(args.max_range),
    }

    def infer(frame):
        payload = encode_jpeg(frame, quality=args.jpeg_quality, max_width=args.upload_width)
        resp = session.post(
            f"{endpoint}/front", params=params, data=payload,
            headers={"Content-Type": "image/jpeg"}, timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    return infer


def build_driver_infer(session, endpoint, args):
    def infer(frame):
        payload = encode_jpeg(frame, quality=args.jpeg_quality, max_width=640)
        resp = session.post(
            f"{endpoint}/driver", data=payload,
            headers={"Content-Type": "image/jpeg"}, timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    return infer


def log_incident(session, endpoint, event):
    try:
        session.post(f"{endpoint}/incident", json=event, timeout=5)
    except requests.RequestException:
        pass  # never let logging stall the safety loop


def main():
    p = argparse.ArgumentParser(description="CAT Smart Operator Assistant — safety client")
    p.add_argument("--endpoint", required=True, help="Modal web endpoint base URL")
    p.add_argument("--driver-source", default="0", help="webcam index or video path")
    p.add_argument("--front-source", required=True, help="webcam index or video path")
    p.add_argument("--front-fps", type=float, default=6.0, help="front inference rate cap")
    p.add_argument("--driver-fps", type=float, default=8.0, help="driver inference rate cap")
    p.add_argument("--conf", type=float, default=0.35)
    p.add_argument("--hfov", type=float, default=70.0, help="forward camera horizontal FOV")
    p.add_argument("--cam-height", type=float, default=2.6, help="forward camera height (m)")
    p.add_argument("--corridor-width", type=float, default=5.0, help="machine path width (m)")
    p.add_argument("--max-range", type=float, default=30.0, help="radar range (m)")
    p.add_argument("--jpeg-quality", type=int, default=80)
    p.add_argument("--upload-width", type=int, default=960)
    p.add_argument("--record", default=None, help="write the HUD to this mp4")
    p.add_argument("--headless", action="store_true", help="no window; use with --record")
    p.add_argument("--max-seconds", type=float, default=None, help="auto-stop after N seconds")
    p.add_argument("--width", type=int, default=1600)
    p.add_argument("--height", type=int, default=940)
    args = p.parse_args()

    endpoint = args.endpoint.rstrip("/")
    session = requests.Session()

    try:
        health = session.get(f"{endpoint}/health", timeout=15)
        health.raise_for_status()
        print(f"endpoint healthy: {health.json()}")
    except requests.RequestException as exc:
        raise SystemExit(f"cannot reach {endpoint}: {exc}")

    driver_src = FrameSource(args.driver_source, loop=True, width=640).start()
    front_src = FrameSource(args.front_source, loop=True, width=960).start()

    driver_worker = InferenceWorker(
        "driver", driver_src, build_driver_infer(session, endpoint, args),
        min_interval_s=1.0 / args.driver_fps,
    ).start()
    front_worker = InferenceWorker(
        "front", front_src, build_front_infer(session, endpoint, args),
        min_interval_s=1.0 / args.front_fps,
    ).start()

    fatigue_monitor = FatigueMonitor()
    proximity_monitor = ProximityMonitor()

    writer = None
    if args.record:
        writer = cv2.VideoWriter(
            args.record, cv2.VideoWriter_fourcc(*"mp4v"), 20.0, (args.width, args.height)
        )

    incidents = 0
    started_at = time.monotonic()
    fps, last_t = 0.0, time.monotonic()
    print("running — press q to quit")

    try:
        while True:
            driver_frame = driver_src.read()
            front_frame = front_src.read()
            if driver_frame is None or front_frame is None:
                time.sleep(0.02)
                continue

            driver_signal = driver_worker.latest()
            perception = front_worker.latest()

            fatigue = fatigue_monitor.update(driver_signal)
            proximity = proximity_monitor.update(perception)

            # Incident logging, rate-limited per kind so one event isn't fifty rows.
            for kind, level, detail in (
                ("fatigue", fatigue.level, fatigue.alerts),
                ("proximity", proximity.zone, proximity.alerts),
            ):
                critical = level in ("CRITICAL", "RED")
                if critical and detail and proximity_monitor.should_log_incident(kind):
                    incidents += 1
                    log_incident(session, endpoint, {
                        "kind": kind,
                        "severity": level,
                        "alerts": detail,
                        "perclos": round(fatigue.perclos, 3),
                        "nearest_person_m": proximity.nearest_person_m,
                        "min_ttc_s": proximity.min_ttc_s,
                    })

            now = time.monotonic()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - last_t, 1e-6))
            last_t = now

            hud = compose(
                driver_frame, front_frame, perception, proximity, fatigue,
                stats={
                    "driver_signal": driver_signal,
                    "render_fps": fps,
                    "front_ms": front_worker.latency_ms,
                    "driver_ms": driver_worker.latency_ms,
                    "incidents": incidents,
                },
                size=(args.width, args.height),
                max_range_m=args.max_range,
                hfov_deg=args.hfov,
            )

            if writer:
                writer.write(hud)
            if not args.headless:
                cv2.imshow("CAT Smart Operator Assistant", hud)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            if args.max_seconds and time.monotonic() - started_at >= args.max_seconds:
                break
    except KeyboardInterrupt:
        pass
    finally:
        for worker in (driver_worker, front_worker):
            worker.stop()
            if worker.errors:
                print(f"{worker.name}: {worker.errors} errors, last={worker.last_error}")
        driver_src.stop()
        front_src.stop()
        if writer:
            writer.release()
        cv2.destroyAllWindows()
        print(f"logged {incidents} incidents")


if __name__ == "__main__":
    main()
