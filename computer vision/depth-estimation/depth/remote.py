"""Remote detector: the construction-equipment model deployed on Ultralytics.

`detect.py` says it plainly -- COCO has no heavy-machinery class, and the
open-vocabulary backend only reaches an excavator at low confidence. A model
trained on the actual equipment is the fix, and this is the client for it: a
dedicated Ultralytics Platform endpoint running on Cloud Run.

    POST <endpoint>/predict
      Authorization: Bearer ul_xxx
      multipart: file=<image>, conf, iou, imgsz

    -> {"images": [{"shape": [h, w],
                    "speed": {...},
                    "results": [{"name", "class", "confidence",
                                 "box": {"x1","y1","x2","y2"}}]}],
        "metadata": {...}}

`RemoteDetector.detect()` returns the same `Detection` list as the local
`Detector`, so it drops into the proximity alert unchanged -- YOLO-over-HTTP
for the "what", Depth Anything V2 locally for the "how far".

Stdlib only: this deliberately adds no dependency to requirements.txt.
"""

from __future__ import annotations

import json
import mimetypes
import os
import pathlib
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Optional

from detect import Detection, classify

# The deployment this was built against. Override per site with
# ULTRALYTICS_ENDPOINT or --endpoint; nothing here is secret.
DEFAULT_ENDPOINT = "https://predict-6ab48246c110ba6e8c06e896-dproatj77a-em.a.run.app"

# The key is. It never belongs in the repo -- export ULTRALYTICS_API_KEY.
API_KEY_ENV = "ULTRALYTICS_API_KEY"

# Where predict_* records how much it shrank the image, so parse() can undo it
# without depending on call ordering.
SCALE_KEY = "_presize_scale"

# Module root, i.e. the directory holding .env / models / out.
_ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_api_key() -> Optional[str]:
    """The key from the environment, falling back to a gitignored .env file.

    The env var always wins, so a one-off `ULTRALYTICS_API_KEY=... python ...`
    overrides the stored key without editing anything.
    """
    from_env = os.environ.get(API_KEY_ENV)
    if from_env:
        return from_env

    dotenv = _ROOT / ".env"
    try:
        for line in dotenv.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == API_KEY_ENV:
                return value.strip().strip("\"'")
    except OSError:
        pass
    return None


class RemoteError(RuntimeError):
    """The endpoint refused, failed, or answered with something unreadable."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _encode_multipart(fields: dict[str, Any],
                      files: dict[str, tuple[str, bytes]]) -> tuple[bytes, str]:
    """Build a multipart/form-data body. urllib has no equivalent of requests'
    `files=`, and adding requests for one POST is not worth a dependency."""
    boundary = uuid.uuid4().hex
    sep = f"--{boundary}".encode()
    parts: list[bytes] = []

    for name, value in fields.items():
        if value is None:
            continue
        if isinstance(value, bool):
            value = "true" if value else "false"
        parts += [sep,
                  f'Content-Disposition: form-data; name="{name}"'.encode(),
                  b"", str(value).encode()]

    for name, (filename, blob) in files.items():
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts += [sep,
                  f'Content-Disposition: form-data; name="{name}"; '
                  f'filename="{filename}"'.encode(),
                  f"Content-Type: {ctype}".encode(),
                  b"", blob]

    parts += [f"--{boundary}--".encode(), b""]
    return b"\r\n".join(parts), f"multipart/form-data; boundary={boundary}"


class RemoteDetector:
    """The deployed equipment model, behind the local `Detector` interface.

    Args mirror the endpoint's own bounds, checked here so a typo comes back
    as a Python error rather than a 422 from Cloud Run.

    `unknown_kind` is the one judgement call. `detect.classify()` maps COCO
    names onto person/vehicle and drops the rest, but a custom model's class
    names are its own -- "dump truck", "mobile crane", whatever the dataset
    used. Since every class of an equipment model *is* machinery, unknown
    labels default to "vehicle" rather than being silently dropped. Pass
    None to get the strict COCO-style filtering instead.
    """

    def __init__(
        self,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        conf: float = 0.25,
        iou: float = 0.7,
        imgsz: int = 640,
        timeout: float = 120.0,
        retries: int = 3,
        unknown_kind: Optional[str] = "vehicle",
        presize: bool = True,
    ):
        endpoint = endpoint or os.environ.get("ULTRALYTICS_ENDPOINT") or DEFAULT_ENDPOINT
        # The key is checked at request time, not here: health() is an
        # unauthenticated GET, so "what is deployed?" should work without one.
        api_key = api_key or load_api_key()
        if not 0.01 <= conf <= 1.0:
            raise ValueError("conf must be in 0.01-1.0")
        if not 0.0 <= iou <= 0.95:
            raise ValueError("iou must be in 0-0.95")
        if not 32 <= imgsz <= 1280:
            raise ValueError("imgsz must be in 32-1280")

        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.conf = conf
        self.iou = iou
        self.imgsz = imgsz
        self.timeout = timeout
        self.retries = retries
        self.unknown_kind = unknown_kind
        # Downscale so the longest side is `imgsz` before sending, which is
        # what the Platform UI does client-side. It is not cosmetic: on the
        # site sample, posting 740x555 returns nothing on the excavator, while
        # the same image resized to 640x480 returns `crane` at 33% with a
        # 92x121px box on it. The model is that sensitive to input scale.
        self.presize = presize
        self._scale = 1.0          # set per request; boxes are scaled back by it
        self.backend = "remote"
        # No /names route on the endpoint, so the class list is whatever has
        # come back so far. Useful for "what can this model even see?".
        self.names: set[str] = set()
        self.last_speed: dict[str, float] = {}

    # -- HTTP ------------------------------------------------------------

    def _post(self, fields: dict, files: dict) -> dict:
        if not self.api_key:
            raise RemoteError(
                f"no API key. Export {API_KEY_ENV}=ul_... (Ultralytics Platform > "
                f"API keys), put it in {_ROOT / '.env'}, or pass --api-key."
            )
        body, ctype = _encode_multipart(fields, files)
        delay = 1.0

        for attempt in range(self.retries):
            req = urllib.request.Request(
                f"{self.endpoint}/predict", data=body, method="POST",
                headers={"Authorization": f"Bearer {self.api_key}",
                         "Content-Type": ctype,
                         "Content-Length": str(len(body))},
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:400]
                # 429 is "endpoint at capacity" and carries its own backoff;
                # 5xx on Cloud Run is usually a cold start losing the race.
                if exc.code in (429, 500, 502, 503, 504) and attempt < self.retries - 1:
                    wait = float(exc.headers.get("Retry-After") or delay)
                    time.sleep(wait)
                    delay *= 2
                    continue
                raise RemoteError(f"HTTP {exc.code} from {self.endpoint}: {detail}",
                                  status=exc.code) from exc
            except urllib.error.URLError as exc:
                if attempt < self.retries - 1:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RemoteError(f"could not reach {self.endpoint}: {exc.reason}") from exc

        raise RemoteError("exhausted retries")  # unreachable

    def health(self) -> dict:
        """GET / -- deployment name, model id, library versions. No auth needed."""
        try:
            with urllib.request.urlopen(self.endpoint + "/", timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.URLError as exc:
            raise RemoteError(f"could not reach {self.endpoint}: {exc}") from exc

    # -- prediction ------------------------------------------------------

    def _params(self, **over) -> dict:
        p = {"conf": self.conf, "iou": self.iou, "imgsz": self.imgsz}
        p.update({k: v for k, v in over.items() if v is not None})
        return p

    def predict_file(self, path: str | pathlib.Path, **over) -> dict:
        """Raw endpoint JSON for an image or video file.

        Images go through the same presize as `predict_array`; anything OpenCV
        cannot decode (video) is posted untouched.
        """
        path = pathlib.Path(path)
        if self.presize:
            import cv2

            img = cv2.imread(str(path))
            if img is not None:
                return self.predict_array(img, **over)
        self._scale = 1.0
        payload = self._post(self._params(**over),
                             {"file": (path.name, path.read_bytes())})
        payload[SCALE_KEY] = 1.0
        return payload

    def predict_source(self, source: str, **over) -> dict:
        """Raw endpoint JSON for an image URL or a base64 string."""
        fields = self._params(**over)
        fields["source"] = source
        return self._post(fields, {})

    def _shrink(self, bgr, imgsz: Optional[int] = None):
        """Resize so the longest side is imgsz. Returns (image, scale).

        `scale` is what the sent image was multiplied by, so boxes coming back
        are divided by it to land in the caller's coordinate space.
        """
        import cv2

        target = imgsz or self.imgsz
        h, w = bgr.shape[:2]
        longest = max(h, w)
        if not self.presize or longest <= target:
            return bgr, 1.0
        s = target / float(longest)
        return cv2.resize(bgr, (max(1, round(w * s)), max(1, round(h * s))),
                          interpolation=cv2.INTER_AREA), s

    def predict_array(self, bgr, **over) -> dict:
        """Raw endpoint JSON for an in-memory BGR frame (cv2 order)."""
        import cv2  # local: the file/URL paths need no OpenCV

        sent, self._scale = self._shrink(bgr, over.get("imgsz"))
        ok, buf = cv2.imencode(".jpg", sent, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if not ok:
            raise RemoteError("cv2 could not JPEG-encode the frame")
        payload = self._post(self._params(**over),
                             {"file": ("frame.jpg", buf.tobytes())})
        # Carry the scale on the payload, so parse() cannot be thrown off by a
        # second predict happening before the first is parsed.
        payload[SCALE_KEY] = self._scale
        return payload

    # -- parsing ---------------------------------------------------------

    def parse(self, payload: dict, index: int = 0) -> list[Detection]:
        """One image's worth of endpoint JSON -> `Detection` objects."""
        images = payload.get("images") or []
        if index >= len(images):
            return []
        image = images[index]
        self.last_speed = image.get("speed") or {}

        out: list[Detection] = []
        for r in image.get("results") or []:
            label = str(r.get("name", r.get("class", "?")))
            self.names.add(label)
            kind = classify(label)
            if kind is None:
                # Not a COCO name the alert knows. An equipment model's own
                # classes land here -- keep them as machinery by default.
                if self.unknown_kind is None:
                    continue
                kind = "person" if "person" in label.lower() else self.unknown_kind
            b = r.get("box") or {}
            try:
                # Undo the presize so boxes match the caller's image, not the
                # smaller one that was actually sent.
                inv = 1.0 / (payload.get(SCALE_KEY) or self._scale or 1.0)
                box = tuple(int(round(float(b[k]) * inv))
                            for k in ("x1", "y1", "x2", "y2"))
            except (KeyError, TypeError, ValueError):
                continue  # normalize=true, or a task with no boxes
            out.append(Detection(label=label, confidence=float(r.get("confidence", 0.0)),
                                 box=box, kind=kind))
        return out

    def detect(self, bgr, **over) -> list[Detection]:
        """Same signature and return type as `Detector.detect`."""
        return self.parse(self.predict_array(bgr, **over))
