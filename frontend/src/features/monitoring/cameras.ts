export interface Camera {
  id: string;
  /** What the computer-vision model on this feed detects. */
  detection: string;
  location: string;
  /** Served from public/cameras/. Missing → the tile shows "No signal". */
  src?: string;
}

export const CAMERAS: Camera[] = [
  {
    id: "CAM-01",
    detection: "Worker safety",
    location: "Bench 4 · pit floor",
    src: "/cameras/worker-safety.mp4",
  },
  {
    id: "CAM-02",
    detection: "Thermal distance",
    location: "Haul road · ramp",
    src: "/cameras/thermal-distance.mp4",
  },
  {
    id: "CAM-03",
    detection: "Sleep detection",
    location: "Operator cab",
    src: "/cameras/sleep-detection.mp4",
  },
  { id: "CAM-04", detection: "Not assigned", location: "Workshop" },
];
