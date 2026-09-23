"""The operator HUD: four live panes plus an alert ribbon.

Pane layout is deliberate - raw driver feed, annotated front feed, metric depth, and a
bird's-eye radar. The radar is the one that makes the system legible at a glance,
because it turns per-pixel depth into "where are the people relative to my machine".
"""

import math

import cv2
import numpy as np

# Dark instrument-panel palette, CAT yellow as the single accent. BGR throughout.
BG = (20, 18, 18)
PANEL = (32, 30, 30)
EDGE = (58, 55, 55)
TEXT = (240, 238, 235)
MUTED = (138, 133, 130)
CAT_YELLOW = (17, 205, 255)
GREEN = (110, 200, 120)
AMBER = (60, 185, 250)
RED = (75, 70, 245)

ZONE_COLOR = {"GREEN": GREEN, "AMBER": AMBER, "RED": RED}
LEVEL_COLOR = {"OK": GREEN, "WARN": AMBER, "CRITICAL": RED}

FONT = cv2.FONT_HERSHEY_DUPLEX
FONT_S = cv2.FONT_HERSHEY_SIMPLEX


def _text(img, s, org, scale=0.5, color=TEXT, thickness=1, font=FONT_S):
    cv2.putText(img, s, org, font, scale, color, thickness, cv2.LINE_AA)


def _panel(img, x, y, w, h, title, accent=CAT_YELLOW):
    cv2.rectangle(img, (x, y), (x + w, y + h), PANEL, -1)
    cv2.rectangle(img, (x, y), (x + w, y + h), EDGE, 1)
    cv2.rectangle(img, (x, y), (x + 4, y + 26), accent, -1)
    _text(img, title.upper(), (x + 14, y + 19), 0.48, TEXT, 1, FONT)
    return x + 1, y + 30, w - 2, h - 31


def _fit(frame, w, h):
    """Letterbox into the pane without distorting aspect ratio."""
    canvas = np.full((h, w, 3), BG, dtype=np.uint8)
    if frame is None or frame.size == 0:
        _text(canvas, "no signal", (w // 2 - 45, h // 2), 0.6, MUTED)
        return canvas
    fh, fw = frame.shape[:2]
    scale = min(w / fw, h / fh)
    nw, nh = int(fw * scale), int(fh * scale)
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_AREA)
    ox, oy = (w - nw) // 2, (h - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = resized
    return canvas


# ------------------------------------------------------------------ driver pane

def draw_driver(frame, driver_signal, fatigue):
    out = frame.copy()
    h, w = out.shape[:2]

    if driver_signal and driver_signal.get("face_found"):
        x1, y1, x2, y2 = driver_signal["face_bbox_norm"]
        p1 = (int(x1 * w), int(y1 * h))
        p2 = (int(x2 * w), int(y2 * h))
        colour = LEVEL_COLOR.get(fatigue.level, GREEN)
        cv2.rectangle(out, p1, p2, colour, 2)

        closure = driver_signal.get("blink_score", 0.0)
        label = "EYES CLOSED" if closure > 0.55 else "EYES OPEN"
        _text(out, label, (p1[0], max(18, p1[1] - 10)), 0.5, colour, 1)

    overlay = out.copy()
    cv2.rectangle(overlay, (0, h - 74), (w, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, out, 0.45, 0, out)

    if fatigue.operator_present:
        _text(out, f"PERCLOS {fatigue.perclos:.0%}", (12, h - 50), 0.52, TEXT)
        _text(out, f"yawns/3min  {fatigue.yawns_recent}", (12, h - 30), 0.45, MUTED)
        pose = fatigue.head_pose or {}
        _text(
            out,
            f"yaw {pose.get('yaw', 0):+.0f}  pitch {pose.get('pitch', 0):+.0f}",
            (12, h - 12), 0.45, MUTED,
        )
        if not fatigue.calibrated:
            _text(out, "calibrating...", (w - 110, h - 12), 0.45, CAT_YELLOW)

        bar_x, bar_w = w - 150, 130
        cv2.rectangle(out, (bar_x, h - 52), (bar_x + bar_w, h - 40), (45, 43, 43), -1)
        filled = int(bar_w * min(fatigue.score, 100) / 100)
        cv2.rectangle(
            out, (bar_x, h - 52), (bar_x + filled, h - 40),
            LEVEL_COLOR.get(fatigue.level, GREEN), -1,
        )
        _text(out, f"FATIGUE {fatigue.score}", (bar_x, h - 58), 0.4, MUTED)
    else:
        _text(out, "OPERATOR NOT DETECTED", (12, h - 30), 0.6, RED)

    return out


# ------------------------------------------------------------------- front pane

def draw_front(frame, perception, proximity, corridor_half_width_m=2.5, hfov_deg=70.0):
    out = frame.copy()
    h, w = out.shape[:2]

    # Forward corridor, drawn as a ground-plane trapezoid.
    fx = (w / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)
    near_half = int(fx * corridor_half_width_m / 4.0)
    far_half = int(fx * corridor_half_width_m / 25.0)
    corridor = np.array([
        [w // 2 - near_half, h], [w // 2 + near_half, h],
        [w // 2 + far_half, int(h * 0.55)], [w // 2 - far_half, int(h * 0.55)],
    ], dtype=np.int32)
    shade = out.copy()
    cv2.fillPoly(shade, [corridor], ZONE_COLOR.get(proximity.zone, GREEN))
    cv2.addWeighted(shade, 0.10, out, 0.90, 0, out)
    cv2.polylines(out, [corridor], True, ZONE_COLOR.get(proximity.zone, GREEN), 1)

    for track in (proximity.tracks or {}).values():
        bbox = track.get("bbox_norm")
        if not bbox:
            continue
        x1, y1, x2, y2 = bbox
        p1 = (int(x1 * w), int(y1 * h))
        p2 = (int(x2 * w), int(y2 * h))
        colour = ZONE_COLOR.get(track["zone"], GREEN)
        thickness = 3 if track["zone"] == "RED" else 2
        cv2.rectangle(out, p1, p2, colour, thickness)

        dist = track.get("distance_m")
        caption = f"{track['label']}"
        if dist is not None:
            caption += f"  {dist:.1f}m"
        if track.get("ttc_s"):
            caption += f"  TTC {track['ttc_s']}s"

        (tw, th), _ = cv2.getTextSize(caption, FONT_S, 0.46, 1)
        cv2.rectangle(out, (p1[0], p1[1] - th - 8), (p1[0] + tw + 10, p1[1]), colour, -1)
        _text(out, caption, (p1[0] + 5, p1[1] - 5), 0.46, (15, 15, 15), 1)

    for ob in (perception or {}).get("obstacles", [])[:6]:
        x1, y1, x2, y2 = ob["bbox_norm"]
        p1 = (int(x1 * w), int(y1 * h))
        p2 = (int(x2 * w), int(y2 * h))
        cv2.rectangle(out, p1, p2, CAT_YELLOW, 1)
        _text(out, f"obstacle {ob['distance_m']:.1f}m", (p1[0], max(14, p1[1] - 6)), 0.4, CAT_YELLOW)

    return out


# ------------------------------------------------------------------- depth pane

def draw_depth(perception, w, h, max_range_m=40.0):
    canvas = np.full((h, w, 3), BG, dtype=np.uint8)
    b64 = (perception or {}).get("depth_png_b64")
    if not b64:
        _text(canvas, "depth idle", (w // 2 - 45, h // 2), 0.55, MUTED)
        return canvas

    import base64

    raw = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
    grey = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
    if grey is None:
        return canvas
    coloured = cv2.applyColorMap(grey, cv2.COLORMAP_TURBO)
    canvas = _fit(coloured, w, h)

    # Scale legend: near is bright in the encoding, so the bar runs near -> far.
    bar_w, bar_h = 14, h - 60
    bx, by = w - 34, 30
    for i in range(bar_h):
        value = int(255 * (1.0 - i / bar_h))
        colour = cv2.applyColorMap(np.array([[value]], np.uint8), cv2.COLORMAP_TURBO)[0, 0]
        cv2.line(canvas, (bx, by + i), (bx + bar_w, by + i), tuple(int(c) for c in colour), 1)
    cv2.rectangle(canvas, (bx, by), (bx + bar_w, by + bar_h), EDGE, 1)
    _text(canvas, "0m", (bx - 24, by + 8), 0.36, TEXT)
    _text(canvas, f"{max_range_m:.0f}m", (bx - 30, by + bar_h), 0.36, TEXT)
    return canvas


# ------------------------------------------------------------------- BEV radar

def draw_radar(proximity, perception, w, h, max_range_m=30.0, hfov_deg=70.0):
    """Top-down plan view. Metric depth means these positions are real, not inferred
    from box height - which is what makes the rings trustworthy.

    Range is square-root scaled: the danger zone is what the operator must react to,
    so it gets the screen space. A linear scale squashes 0-7m into a few pixels.
    """
    canvas = np.full((h, w, 3), (14, 13, 13), dtype=np.uint8)
    margin = 30
    origin = (w // 2, h - margin)
    reach = h - 2 * margin

    def radius_for(distance_m):
        d = max(0.0, min(distance_m, max_range_m))
        return reach * math.sqrt(d / max_range_m)

    def to_px(lateral_m, distance_m):
        """Place by true bearing, then apply the compressed radial scale."""
        r = radius_for(distance_m)
        bearing = math.atan2(lateral_m, max(distance_m, 0.1))
        return (
            int(origin[0] + math.sin(bearing) * r),
            int(origin[1] - math.cos(bearing) * r),
        )

    # Camera field of view, as a filled sector centred on straight-ahead (270 deg).
    half_deg = hfov_deg / 2.0
    shade = canvas.copy()
    cv2.ellipse(shade, origin, (int(reach), int(reach)), 0,
                270 - half_deg, 270 + half_deg, (42, 40, 38), -1)
    cv2.addWeighted(shade, 0.65, canvas, 0.35, 0, canvas)

    from .safety_rules import CAUTION_M, DANGER_M

    rings = (
        (DANGER_M, RED, True),
        (CAUTION_M, AMBER, True),
        (15.0, (72, 70, 68), False),
        (max_range_m, (58, 56, 54), False),
    )
    for ring_m, colour, emphasise in rings:
        r = int(radius_for(ring_m))
        if r < 6:
            continue
        cv2.ellipse(canvas, origin, (r, r), 0, 180, 360, colour, 2 if emphasise else 1)
        # Parked on the left flank: radius alone keeps them from stacking.
        _text(canvas, f"{ring_m:.0f}m", (origin[0] - r + 6, origin[1] - 9), 0.36, colour)

    for ob in (perception or {}).get("obstacles", [])[:10]:
        if ob["distance_m"] > max_range_m:
            continue
        px = to_px(ob["lateral_m"], ob["distance_m"])
        cv2.drawMarker(canvas, px, CAT_YELLOW, cv2.MARKER_TRIANGLE_UP, 12, 2)

    # Draw far targets first so near ones sit on top.
    ordered = sorted(
        ((tid, t) for tid, t in (proximity.tracks or {}).items()
         if t.get("distance_m") is not None and t.get("lateral_m") is not None),
        key=lambda kv: -kv[1]["distance_m"],
    )
    for tid, track in ordered:
        dist, lat = track["distance_m"], track["lateral_m"]
        if dist > max_range_m:
            continue
        px = to_px(lat, dist)
        colour = ZONE_COLOR.get(track["zone"], GREEN)
        radius = 9 if track["is_person"] else 7

        if track["zone"] == "RED":  # halo on the ones that matter
            cv2.circle(canvas, px, radius + 7, colour, 2)
        cv2.circle(canvas, px, radius, colour, -1)
        cv2.circle(canvas, px, radius, (15, 15, 15), 1)

        tag = "P" if track["is_person"] else "V"
        _text(canvas, f"{tag}{tid if tid >= 0 else ''}", (px[0] + 13, px[1] + 2), 0.4, colour)
        _text(canvas, f"{dist:.1f}m", (px[0] + 13, px[1] + 16), 0.36, MUTED)

    # The machine itself, drawn last so nothing overlaps it.
    cv2.rectangle(canvas, (origin[0] - 16, origin[1] - 7), (origin[0] + 16, origin[1] + 11),
                  CAT_YELLOW, -1)
    cv2.line(canvas, (origin[0], origin[1] - 7), (origin[0], origin[1] - 22), CAT_YELLOW, 2)

    _text(canvas, "BIRD'S-EYE PROXIMITY", (12, 20), 0.42, MUTED)
    _text(canvas, "sqrt range scale", (12, 36), 0.32, (90, 88, 86))
    return canvas


# ---------------------------------------------------------------------- ribbon

def draw_ribbon(w, h, fatigue, proximity, stats):
    bar = np.full((h, w, 3), PANEL, dtype=np.uint8)

    alerts = list(fatigue.alerts) + list(proximity.alerts)
    if alerts:
        level = RED if (fatigue.level == "CRITICAL" or proximity.zone == "RED") else AMBER
        cv2.rectangle(bar, (0, 0), (w, h), (level[0] // 6, level[1] // 6, level[2] // 6), -1)
        cv2.rectangle(bar, (0, 0), (8, h), level, -1)
        for i, alert in enumerate(alerts[:3]):
            _text(bar, alert, (24, 26 + i * 24), 0.58, level, 1, FONT)
    else:
        cv2.rectangle(bar, (0, 0), (8, h), GREEN, -1)
        _text(bar, "ALL CLEAR - no active safety alerts", (24, 34), 0.58, GREEN, 1, FONT)

    right = w - 430
    _text(bar, f"machine zone  {proximity.zone}", (right, 24), 0.46, ZONE_COLOR.get(proximity.zone, GREEN))
    _text(bar, f"operator  {fatigue.level}", (right, 46), 0.46, LEVEL_COLOR.get(fatigue.level, GREEN))
    _text(bar, f"incidents logged  {stats.get('incidents', 0)}", (right, 68), 0.42, MUTED)

    right2 = w - 210
    _text(bar, f"render {stats.get('render_fps', 0):.0f} fps", (right2, 24), 0.42, MUTED)
    _text(bar, f"front {stats.get('front_ms', 0):.0f} ms", (right2, 46), 0.42, MUTED)
    _text(bar, f"driver {stats.get('driver_ms', 0):.0f} ms", (right2, 68), 0.42, MUTED)
    return bar


# --------------------------------------------------------------------- compose

def compose(driver_frame, front_frame, perception, proximity, fatigue, stats,
            size=(1600, 940), max_range_m=30.0, hfov_deg=70.0):
    W, H = size
    canvas = np.full((H, W, 3), BG, dtype=np.uint8)

    header_h, ribbon_h = 52, 86
    cv2.rectangle(canvas, (0, 0), (W, header_h), PANEL, -1)
    cv2.rectangle(canvas, (0, 0), (6, header_h), CAT_YELLOW, -1)
    _text(canvas, "SMART OPERATOR ASSISTANT", (22, 33), 0.72, TEXT, 1, FONT)
    _text(canvas, "live safety monitoring", (432, 33), 0.46, MUTED)

    gap = 10
    grid_y = header_h + gap
    grid_h = H - header_h - ribbon_h - gap * 3
    cell_w = (W - gap * 3) // 2
    cell_h = (grid_h - gap) // 2

    x0, x1 = gap, gap * 2 + cell_w
    y0, y1 = grid_y, grid_y + cell_h + gap

    ix, iy, iw, ih = _panel(canvas, x0, y0, cell_w, cell_h, "operator camera")
    canvas[iy:iy + ih, ix:ix + iw] = _fit(draw_driver(driver_frame, stats.get("driver_signal"), fatigue), iw, ih)

    ix, iy, iw, ih = _panel(canvas, x1, y0, cell_w, cell_h, "forward camera",
                            ZONE_COLOR.get(proximity.zone, CAT_YELLOW))
    canvas[iy:iy + ih, ix:ix + iw] = _fit(
        draw_front(front_frame, perception, proximity, hfov_deg=hfov_deg), iw, ih
    )

    ix, iy, iw, ih = _panel(canvas, x0, y1, cell_w, cell_h, "metric depth")
    canvas[iy:iy + ih, ix:ix + iw] = draw_depth(perception, iw, ih)

    ix, iy, iw, ih = _panel(canvas, x1, y1, cell_w, cell_h, "proximity radar")
    canvas[iy:iy + ih, ix:ix + iw] = draw_radar(
        proximity, perception, iw, ih, max_range_m=max_range_m, hfov_deg=hfov_deg
    )

    canvas[H - ribbon_h:H, 0:W] = draw_ribbon(W, ribbon_h, fatigue, proximity, stats)
    return canvas
