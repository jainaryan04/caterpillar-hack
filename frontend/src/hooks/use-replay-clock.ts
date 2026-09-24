"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ReplayClock {
  /** Virtual plan minute, 0..totalMin. */
  t: number;
  progress: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  seek: (minute: number) => void;
}

/**
 * Maps a plan's real length (`totalMin`, the solver's makespan) onto
 * `wallMs` of animation. Nothing accumulates: the clock only stores an anchor
 * (plan minute + wall time it was set) and derives `t` from it each frame, so
 * seeking, restarting or changing speed mid-play is exact — and whatever the
 * replay shows at minute t is a pure function of the schedule at t.
 */
export function useReplayClock(totalMin: number, wallMs: number): ReplayClock {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const anchor = useRef({ wall: 0, t: 0 });
  const tRef = useRef(0);
  const rate = totalMin > 0 ? totalMin / wallMs : 0; // plan minutes per wall ms

  const set = useCallback((minute: number) => {
    tRef.current = minute;
    setT(minute);
  }, []);

  useEffect(() => {
    if (!playing) return;
    anchor.current = { wall: performance.now(), t: tRef.current };
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(totalMin, anchor.current.t + (now - anchor.current.wall) * rate);
      set(next);
      if (next >= totalMin) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Re-anchoring on a rate change keeps the playhead where it is.
  }, [playing, rate, totalMin, set]);

  const play = useCallback(() => {
    if (totalMin <= 0) return;
    if (tRef.current >= totalMin) set(0);
    setPlaying(true);
  }, [totalMin, set]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const restart = useCallback(() => {
    set(0);
    anchor.current = { wall: performance.now(), t: 0 };
  }, [set]);
  const seek = useCallback(
    (minute: number) => {
      const m = Math.max(0, Math.min(totalMin, minute));
      set(m);
      anchor.current = { wall: performance.now(), t: m };
    },
    [totalMin, set],
  );

  return { t, progress: totalMin > 0 ? t / totalMin : 0, playing, play, pause, toggle, restart, seek };
}
