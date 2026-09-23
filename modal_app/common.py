"""Shared Modal app, images and volumes for the CAT Smart Operator Assistant."""

import modal

APP_NAME = "cat-operator-safety"

app = modal.App(APP_NAME)

# Weights persist across containers so cold starts don't re-download multi-GB checkpoints.
weights_volume = modal.Volume.from_name("cat-safety-weights", create_if_missing=True)
WEIGHTS_DIR = "/weights"

# Incident clips + structured event log survive container death.
incidents_volume = modal.Volume.from_name("cat-safety-incidents", create_if_missing=True)
INCIDENTS_DIR = "/incidents"

_CV_APT = ["libgl1", "libglib2.0-0", "libsm6", "libxext6", "libxrender1"]

# GPU image: YOLO26 detector + Depth Anything V2. Torch comes from the ultralytics/
# transformers deps resolved against Modal's CUDA driver.
gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(*_CV_APT)
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "ultralytics==8.3.40",
        "transformers==4.46.3",
        "accelerate==1.1.1",
        "opencv-python-headless==4.10.0.84",
        "numpy==1.26.4",
        "pillow==11.0.0",
        "fastapi[standard]==0.115.5",
    )
    .env({"YOLO_CONFIG_DIR": "/tmp/ultralytics", "HF_HOME": f"{WEIGHTS_DIR}/hf"})
)

# CPU image: MediaPipe runs the face landmarker fine on CPU and costs ~20x less.
cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(*_CV_APT)
    .pip_install(
        "mediapipe==0.10.18",
        "opencv-python-headless==4.10.0.84",
        "numpy==1.26.4",
        "fastapi[standard]==0.115.5",
    )
)


def decode_jpeg(payload: bytes):
    """Decode a JPEG byte payload to a BGR numpy array."""
    import cv2
    import numpy as np

    buf = np.frombuffer(payload, dtype=np.uint8)
    frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("could not decode frame payload as JPEG")
    return frame
