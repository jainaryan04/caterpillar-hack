"""Turning a raw depth map into something you can look at.

The raw map is unbounded float32, so every visualisation starts by normalising
to 0-1. That normalisation is per-image: two frames of the same scene are not
comparable as pictures, only the .npy values are.
"""

from __future__ import annotations

import numpy as np


def normalize(depth: np.ndarray) -> np.ndarray:
    """Depth map -> 0-1 float32, flat-image safe."""
    lo, hi = float(depth.min()), float(depth.max())
    return ((depth - lo) / (hi - lo + 1e-8)).astype(np.float32)


def to_grayscale(depth: np.ndarray) -> np.ndarray:
    """Depth map -> HxW uint8. White is near."""
    return (normalize(depth) * 255).astype(np.uint8)


def to_color(depth: np.ndarray, cmap: str = 'Spectral_r') -> np.ndarray:
    """Depth map -> HxWx3 uint8 BGR, ready for cv2.imwrite.

    Spectral_r is what the upstream demo uses: red near, blue far. matplotlib
    hands back RGB, hence the channel flip.
    """
    import matplotlib

    colors = matplotlib.colormaps.get_cmap(cmap)(normalize(depth))
    return (colors[:, :, :3] * 255).astype(np.uint8)[:, :, ::-1]


def side_by_side(bgr: np.ndarray, vis: np.ndarray, gap: int = 40) -> np.ndarray:
    """Original beside its depth map, white gutter between."""
    import cv2

    if vis.ndim == 2:
        vis = cv2.cvtColor(vis, cv2.COLOR_GRAY2BGR)
    split = np.full((bgr.shape[0], gap, 3), 255, dtype=np.uint8)
    return cv2.hconcat([bgr, split, vis])
