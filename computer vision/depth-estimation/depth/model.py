"""Depth Anything V2 loading and inference.

The model code itself lives in the upstream Depth-Anything-V2 checkout, which
is gitignored at the repo root -- it is a 1.3 GB clone, not our source. This
module locates it, puts it on the path, and wraps it in something callable.

Output is *relative inverse depth*: larger means closer, and there is no metric
scale. For real distances use the upstream `metric_depth/` checkpoints instead
(vkitti for outdoor scenes, hypersim for indoor).
"""

from __future__ import annotations

import os
import pathlib
import sys
from typing import Optional

import numpy as np

# features/out_channels per encoder, copied from the upstream run.py.
MODEL_CONFIGS = {
    'vits': {'encoder': 'vits', 'features': 64, 'out_channels': [48, 96, 192, 384]},
    'vitb': {'encoder': 'vitb', 'features': 128, 'out_channels': [96, 192, 384, 768]},
    'vitl': {'encoder': 'vitl', 'features': 256, 'out_channels': [256, 512, 1024, 1024]},
    'vitg': {'encoder': 'vitg', 'features': 384, 'out_channels': [1536, 1536, 1536, 1536]},
}

HERE = pathlib.Path(__file__).resolve().parents[1]
REPO_ROOT = HERE.parents[1]


def pick_device() -> str:
    """CUDA if present, else Apple MPS, else CPU."""
    import torch

    if torch.cuda.is_available():
        return 'cuda'
    if torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def resolve_dav2_root(explicit: Optional[str] = None) -> pathlib.Path:
    """Find the upstream Depth-Anything-V2 checkout."""
    for candidate in (explicit, os.environ.get('DAV2_ROOT')):
        if candidate:
            path = pathlib.Path(candidate).expanduser().resolve()
            if (path / 'depth_anything_v2' / 'dpt.py').is_file():
                return path
            raise FileNotFoundError(
                f'no depth_anything_v2/dpt.py under {path} -- is that the repo?'
            )

    default = REPO_ROOT / 'Depth-Anything-V2'
    if (default / 'depth_anything_v2' / 'dpt.py').is_file():
        return default

    raise FileNotFoundError(
        'Depth-Anything-V2 checkout not found. Clone it next to this repo:\n'
        f'  git clone https://github.com/DepthAnything/Depth-Anything-V2 {default}\n'
        'or point DAV2_ROOT at an existing copy.'
    )


def resolve_checkpoint(encoder: str, explicit: Optional[str] = None) -> pathlib.Path:
    """Locate the .pth weights: flag, then env, then the two usual folders."""
    name = f'depth_anything_v2_{encoder}.pth'
    searched = []

    for candidate in (explicit, os.environ.get('DAV2_CHECKPOINT')):
        if candidate:
            path = pathlib.Path(candidate).expanduser().resolve()
            if path.is_file():
                return path
            raise FileNotFoundError(f'checkpoint not found: {path}')

    for directory in (HERE / 'models', resolve_dav2_root() / 'checkpoints'):
        path = directory / name
        searched.append(str(path))
        if path.is_file():
            return path

    raise FileNotFoundError(
        f'no {name} in any of:\n  ' + '\n  '.join(searched)
        + f'\nFetch it with:  ./scripts/fetch_model.sh {encoder}'
    )


class DepthEstimator:
    """Load once, call `infer` per frame.

    >>> est = DepthEstimator(encoder='vitb')
    >>> depth = est.infer(cv2.imread('site.jpg'))   # HxW float32
    """

    def __init__(
        self,
        encoder: str = 'vitb',
        checkpoint: Optional[str] = None,
        device: Optional[str] = None,
        input_size: int = 518,
        dav2_root: Optional[str] = None,
    ):
        if encoder not in MODEL_CONFIGS:
            raise ValueError(f'encoder must be one of {list(MODEL_CONFIGS)}, got {encoder!r}')

        import torch

        root = resolve_dav2_root(dav2_root)
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from depth_anything_v2.dpt import DepthAnythingV2

        self.encoder = encoder
        self.input_size = input_size
        self.device = device or pick_device()
        self.checkpoint = resolve_checkpoint(encoder, checkpoint)

        model = DepthAnythingV2(**MODEL_CONFIGS[encoder])
        model.load_state_dict(torch.load(self.checkpoint, map_location='cpu'))
        self.model = model.to(self.device).eval()

    def infer(self, bgr: np.ndarray, input_size: Optional[int] = None) -> np.ndarray:
        """BGR frame (as cv2.imread returns) -> HxW float32 relative inverse depth."""
        if bgr is None:
            raise ValueError('got None instead of an image -- did cv2.imread fail?')
        return self.model.infer_image(bgr, input_size or self.input_size)
