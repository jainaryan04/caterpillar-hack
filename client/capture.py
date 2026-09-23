"""Frame-dropping capture and async inference workers.

The single biggest cause of "real-time" demos that drift seconds behind reality is a
FIFO queue between capture and inference. Everything here holds at most one frame and
overwrites it, so a slow consumer loses frames instead of accumulating latency.
"""

import threading
import time

import cv2


class FrameSource:
    """Background capture that always hands back the most recent frame."""

    def __init__(self, source, loop=True, width=None):
        self.source = source
        self.loop = loop
        self.width = width
        self._cap = None
        self._frame = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.frames_read = 0

    def _open(self):
        source = int(self.source) if str(self.source).isdigit() else self.source
        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            raise RuntimeError(f"could not open video source: {self.source}")
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def start(self):
        self._cap = self._open()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        # Block briefly so callers don't get None on the first read.
        deadline = time.monotonic() + 5.0
        while self.read() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        return self

    def _run(self):
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                if self.loop:
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break
            if self.width and frame.shape[1] != self.width:
                scale = self.width / frame.shape[1]
                frame = cv2.resize(
                    frame, (self.width, int(frame.shape[0] * scale)),
                    interpolation=cv2.INTER_AREA,
                )
            with self._lock:
                self._frame = frame          # overwrite, never queue
                self.frames_read += 1

    def read(self):
        with self._lock:
            return None if self._frame is None else self._frame.copy()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
        if self._cap:
            self._cap.release()


class InferenceWorker:
    """Runs a blocking inference call in the background against the latest frame.

    The render loop never waits on the network; it draws whatever the most recent
    result was. That's what keeps the display at full frame rate while inference
    happens at whatever rate the round trip allows.
    """

    def __init__(self, name, source: FrameSource, infer_fn, min_interval_s=0.0):
        self.name = name
        self.source = source
        self.infer_fn = infer_fn
        self.min_interval_s = min_interval_s
        self._result = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.latency_ms = 0.0
        self.inferences = 0
        self.errors = 0
        self.last_error = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self):
        while not self._stop.is_set():
            cycle_start = time.monotonic()
            frame = self.source.read()
            if frame is None:
                time.sleep(0.05)
                continue
            try:
                t0 = time.monotonic()
                result = self.infer_fn(frame)
                self.latency_ms = (time.monotonic() - t0) * 1000.0
                with self._lock:
                    self._result = result
                self.inferences += 1
            except Exception as exc:  # keep the demo alive; surface it on the HUD
                self.errors += 1
                self.last_error = str(exc)[:120]
                time.sleep(0.4)

            elapsed = time.monotonic() - cycle_start
            if self.min_interval_s > elapsed:
                time.sleep(self.min_interval_s - elapsed)

    def latest(self):
        with self._lock:
            return self._result

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)


def encode_jpeg(frame, quality=80, max_width=960):
    """Downscale and JPEG-encode before sending. Upload time dominates round trip."""
    if frame.shape[1] > max_width:
        scale = max_width / frame.shape[1]
        frame = cv2.resize(
            frame, (max_width, int(frame.shape[0] * scale)), interpolation=cv2.INTER_AREA
        )
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return buf.tobytes()
