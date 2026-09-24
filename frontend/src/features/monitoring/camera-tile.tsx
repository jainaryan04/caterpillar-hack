"use client";

import { useEffect, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import type { Camera } from "./cameras";

/** CCTV-style timestamp: 2026-09-24 14:32:07 */
function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * One camera on the wall: the clip plays muted on a loop under a CCTV
 * overlay. A camera without a clip — or whose file isn't there yet — shows
 * "No signal". Click to view it full screen.
 */
export function CameraTile({
  camera,
  now,
}: {
  camera: Camera;
  now: Date | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const live = !!camera.src && !failed;

  // The <video> is rendered only after mount: video-speed browser extensions
  // inject controls next to it in the server HTML, which breaks hydration,
  // and a load error before hydration would never reach onError.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`${camera.id} · ${camera.detection} — view full screen`}
      onClick={() => void ref.current?.requestFullscreen?.()}
      onKeyDown={(e) =>
        e.key === "Enter" && void ref.current?.requestFullscreen?.()
      }
      className="relative aspect-video cursor-zoom-in overflow-hidden rounded-md border bg-black font-mono text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {live ? (
        mounted && (
          <video
            src={camera.src}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        )
      ) : (
        <div className="cctv-noise absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
          <VideoOff className="size-6" aria-hidden />
          <span className="text-caption tracking-widest uppercase">
            No signal
          </span>
        </div>
      )}

      {/* scanlines */}
      <div
        className="cctv-scanlines pointer-events-none absolute inset-0"
        aria-hidden
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-black/75 px-2 py-1 text-caption [text-shadow:0_1px_2px_#000]">
        <span className="flex items-center gap-1.5">
          {live ? (
            <>
              <span className="size-2 rounded-full bg-red-500" aria-hidden />
              REC
            </>
          ) : (
            "OFFLINE"
          )}
          <span className="text-white/80">{camera.id}</span>
        </span>
        <span className="text-white/80">{camera.location}</span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-black/75 px-2 py-1 text-caption [text-shadow:0_1px_2px_#000]">
        <span>{camera.detection}</span>
        <span className="tabular-nums text-white/80">
          {now ? stamp(now) : ""}
        </span>
      </div>
    </div>
  );
}
