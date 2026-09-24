# Camera feeds

Drop the computer-vision clips here with these exact names — the
Monitoring page (`/monitoring`) picks them up, no restart needed:

| File                    | Tile   | Shows                |
| ----------------------- | ------ | -------------------- |
| `worker-safety.mp4`    | CAM-01 | Worker safety    |
| `thermal-distance.mp4` | CAM-02 | Thermal distance |
| `sleep-detection.mp4`  | CAM-03 | Sleep detection  |

Use H.264 `.mp4` so every browser plays it. Clips play muted and on a loop.
A missing file shows as "No signal". To add or rename a camera, edit
`src/features/monitoring/cameras.ts`.
