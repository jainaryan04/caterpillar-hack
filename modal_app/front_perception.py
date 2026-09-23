"""Front-of-vehicle perception: YOLO26 detection + Depth Anything V2 metric depth.

The two models are fused so every detection carries a real distance in metres and a
bird's-eye-view coordinate, and so that obstacles with no class label (spoil heaps,
rocks, trench edges, barriers) are still caught as ground-plane protrusions.
"""

import base64
import os

import modal

from .common import WEIGHTS_DIR, app, gpu_image, weights_volume

# Bigger is better here: Modal absorbs the compute, so we default to the top of each
# family. Override per-deploy without touching code.
YOLO_WEIGHTS = os.environ.get("CAT_YOLO_WEIGHTS", "yolo26x.pt")
DEPTH_MODEL = os.environ.get(
    "CAT_DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Metric-Outdoor-Large-hf"
)

# COCO ids we care about on a construction approach.
VEHICLE_IDS = {1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
PERSON_ID = 0
KEEP_IDS = {PERSON_ID, *VEHICLE_IDS}

# Depth map streamed back to the client for rendering, kept small on purpose.
DEPTH_PREVIEW_W, DEPTH_PREVIEW_H = 320, 180
# Resolution the obstacle geometry runs at.
GEOM_W, GEOM_H = 320, 180


@app.cls(
    image=gpu_image,
    gpu="A100-40GB",
    volumes={WEIGHTS_DIR: weights_volume},
    scaledown_window=300,
    min_containers=1,  # keep one warm; cold start on a ViT-L is ~30s
    timeout=120,
)
@modal.concurrent(max_inputs=4)
class FrontPerception:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
        from ultralytics import YOLO

        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        weights_path = os.path.join(WEIGHTS_DIR, YOLO_WEIGHTS)
        if not os.path.exists(weights_path):
            # Ultralytics downloads into cwd; stage it into the volume for reuse.
            YOLO(YOLO_WEIGHTS)
            if os.path.exists(YOLO_WEIGHTS):
                os.replace(YOLO_WEIGHTS, weights_path)
        self.detector = YOLO(weights_path if os.path.exists(weights_path) else YOLO_WEIGHTS)
        self.detector.to(self.device)

        self.depth_processor = AutoImageProcessor.from_pretrained(DEPTH_MODEL)
        self.depth_model = (
            AutoModelForDepthEstimation.from_pretrained(
                DEPTH_MODEL, torch_dtype=torch.float16
            )
            .to(self.device)
            .eval()
        )
        weights_volume.commit()

        # Warm both graphs so the first real frame isn't the slow one.
        import numpy as np

        warm = np.zeros((GEOM_H, GEOM_W, 3), dtype=np.uint8)
        self.detector.predict(warm, verbose=False, device=self.device)
        self._depth(warm)
        self.torch = torch

    # ------------------------------------------------------------------ depth

    def _depth(self, frame_bgr):
        """Return a metric depth map in metres, same HxW as the input frame."""
        import numpy as np
        import torch
        from PIL import Image

        rgb = Image.fromarray(frame_bgr[:, :, ::-1])
        inputs = self.depth_processor(images=rgb, return_tensors="pt").to(self.device)
        inputs["pixel_values"] = inputs["pixel_values"].half()

        with torch.inference_mode():
            out = self.depth_model(**inputs)

        depth = torch.nn.functional.interpolate(
            out.predicted_depth.unsqueeze(1).float(),
            size=frame_bgr.shape[:2],
            mode="bicubic",
            align_corners=False,
        )[0, 0]
        return depth.cpu().numpy().astype(np.float32)

    # -------------------------------------------------------------- geometry

    @staticmethod
    def _intrinsics(width, height, hfov_deg):
        import math

        fx = (width / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)
        # Square pixels: the same focal length governs the vertical axis.
        return fx, fx, width / 2.0, height / 2.0

    def _box_distance(self, depth, x1, y1, x2, y2):
        """Median depth over the box's inner core, so background doesn't bleed in."""
        import numpy as np

        h, w = depth.shape
        bw, bh = x2 - x1, y2 - y1
        cx1 = int(max(0, x1 + bw * 0.25))
        cx2 = int(min(w, x2 - bw * 0.25))
        cy1 = int(max(0, y1 + bh * 0.25))
        cy2 = int(min(h, y2 - bh * 0.25))
        if cx2 <= cx1 or cy2 <= cy1:
            return None
        core = depth[cy1:cy2, cx1:cx2]
        core = core[np.isfinite(core) & (core > 0.1)]
        if core.size == 0:
            return None
        return float(np.median(core))

    def _obstacles(self, depth, cam_height_m, hfov_deg, corridor_half_width_m, max_range_m):
        """Class-agnostic hazards: anything standing proud of the ground plane
        inside the machine's forward corridor. Catches what a detector never will."""
        import cv2
        import numpy as np

        small = cv2.resize(depth, (GEOM_W, GEOM_H), interpolation=cv2.INTER_NEAREST)
        fx, fy, cx, cy = self._intrinsics(GEOM_W, GEOM_H, hfov_deg)

        us, vs = np.meshgrid(np.arange(GEOM_W), np.arange(GEOM_H))
        z = small
        valid = np.isfinite(z) & (z > 0.4) & (z < max_range_m)

        # Pinhole un-projection into camera frame (X right, Y down, Z forward).
        x_cam = (us - cx) * z / fx
        y_cam = (vs - cy) * z / fy
        height_above_ground = cam_height_m - y_cam

        hazard = (
            valid
            & (np.abs(x_cam) < corridor_half_width_m)
            & (height_above_ground > 0.35)   # taller than surface roughness
            & (height_above_ground < 4.0)    # ignore gantries, sky, overhead structure
        )

        mask = (hazard * 255).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        blobs = []
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if area < 120:  # reject speckle
                continue
            sel = labels == i
            zs = z[sel]
            blobs.append(
                {
                    "distance_m": round(float(np.percentile(zs, 10)), 2),  # nearest edge
                    "lateral_m": round(float(np.median(x_cam[sel])), 2),
                    "height_m": round(float(np.percentile(height_above_ground[sel], 90)), 2),
                    "area_px": int(area),
                    "bbox_norm": [
                        round(stats[i, cv2.CC_STAT_LEFT] / GEOM_W, 4),
                        round(stats[i, cv2.CC_STAT_TOP] / GEOM_H, 4),
                        round((stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH]) / GEOM_W, 4),
                        round((stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT]) / GEOM_H, 4),
                    ],
                }
            )
        blobs.sort(key=lambda b: b["distance_m"])
        return blobs[:12]

    @staticmethod
    def _depth_preview(depth, max_range_m):
        """Small PNG of the depth map for the dashboard's depth pane."""
        import cv2
        import numpy as np

        small = cv2.resize(depth, (DEPTH_PREVIEW_W, DEPTH_PREVIEW_H), interpolation=cv2.INTER_AREA)
        clipped = np.clip(small, 0.0, max_range_m) / max_range_m
        u8 = ((1.0 - clipped) * 255).astype(np.uint8)  # near = bright
        ok, buf = cv2.imencode(".png", u8)
        if not ok:
            return None
        return base64.b64encode(buf.tobytes()).decode("ascii")

    # --------------------------------------------------------------- inference

    @modal.method()
    def perceive(
        self,
        frame_jpeg: bytes,
        with_depth: bool = True,
        conf: float = 0.35,
        hfov_deg: float = 70.0,
        cam_height_m: float = 2.6,
        corridor_half_width_m: float = 2.5,
        max_range_m: float = 40.0,
        track: bool = True,
    ) -> dict:
        import time

        import numpy as np

        from .common import decode_jpeg

        t0 = time.perf_counter()
        frame = decode_jpeg(frame_jpeg)
        h, w = frame.shape[:2]

        runner = self.detector.track if track else self.detector.predict
        kwargs = dict(conf=conf, verbose=False, device=self.device, classes=sorted(KEEP_IDS))
        if track:
            kwargs.update(persist=True, tracker="bytetrack.yaml")
        result = runner(frame, **kwargs)[0]
        t_det = time.perf_counter()

        depth = self._depth(frame) if with_depth else None
        t_depth = time.perf_counter()

        fx, fy, cx, cy = self._intrinsics(w, h, hfov_deg)
        detections = []
        if result.boxes is not None and len(result.boxes):
            xyxy = result.boxes.xyxy.cpu().numpy()
            cls = result.boxes.cls.cpu().numpy().astype(int)
            confs = result.boxes.conf.cpu().numpy()
            ids = (
                result.boxes.id.cpu().numpy().astype(int)
                if getattr(result.boxes, "id", None) is not None
                else np.full(len(cls), -1)
            )
            for (x1, y1, x2, y2), c, cf, tid in zip(xyxy, cls, confs, ids):
                label = "person" if c == PERSON_ID else VEHICLE_IDS.get(int(c), str(c))
                dist = self._box_distance(depth, x1, y1, x2, y2) if depth is not None else None
                lateral = None
                if dist is not None:
                    lateral = float(((x1 + x2) / 2.0 - cx) * dist / fx)
                detections.append(
                    {
                        "label": label,
                        "is_person": bool(c == PERSON_ID),
                        "conf": round(float(cf), 3),
                        "track_id": int(tid),
                        "bbox_norm": [
                            round(float(x1 / w), 4), round(float(y1 / h), 4),
                            round(float(x2 / w), 4), round(float(y2 / h), 4),
                        ],
                        "distance_m": round(dist, 2) if dist is not None else None,
                        "lateral_m": round(lateral, 2) if lateral is not None else None,
                    }
                )

        obstacles, depth_png = [], None
        if depth is not None:
            obstacles = self._obstacles(
                depth, cam_height_m, hfov_deg, corridor_half_width_m, max_range_m
            )
            depth_png = self._depth_preview(depth, max_range_m)

        return {
            "detections": detections,
            "obstacles": obstacles,
            "depth_png_b64": depth_png,
            "depth_preview_size": [DEPTH_PREVIEW_W, DEPTH_PREVIEW_H],
            "frame_size": [w, h],
            "timing_ms": {
                "detect": round((t_det - t0) * 1000, 1),
                "depth": round((t_depth - t_det) * 1000, 1),
                "total": round((time.perf_counter() - t0) * 1000, 1),
            },
        }
