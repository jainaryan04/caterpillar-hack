import { useCallback, useEffect, useRef, useState } from 'react';

export type PlaybackStatus = 'playing' | 'paused' | 'ended';

export interface Playback {
  status: PlaybackStatus;
  /** Seconds */
  position: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
}

const TICK_MS = 250;

/**
 * Simulated playback clock so the player UI works without a stream.
 * When real videos arrive, replace this with a hook over expo-video's player
 * that returns the same `Playback` shape; VideoPlayer won't need to change.
 */
export function useMockPlayback(durationSeconds: number, initialPosition = 0): Playback {
  const [status, setStatus] = useState<PlaybackStatus>('paused');
  const [position, setPosition] = useState(() => Math.min(initialPosition, durationSeconds));
  const durationRef = useRef(durationSeconds);
  useEffect(() => {
    durationRef.current = durationSeconds;
  }, [durationSeconds]);

  useEffect(() => {
    if (status !== 'playing') return;
    const id = setInterval(() => {
      setPosition((p) => {
        const next = p + TICK_MS / 1000;
        if (next >= durationRef.current) {
          setStatus('ended');
          return durationRef.current;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [status]);

  const play = useCallback(() => {
    setPosition((p) => (p >= durationRef.current ? 0 : p));
    setStatus('playing');
  }, []);
  const pause = useCallback(() => setStatus((s) => (s === 'playing' ? 'paused' : s)), []);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') pause();
    else play();
  }, [pause, play]);
  const seek = useCallback((seconds: number) => {
    setPosition(Math.max(0, Math.min(durationRef.current, seconds)));
    setStatus((s) => (s === 'ended' ? 'paused' : s));
  }, []);

  return { status, position, play, pause, toggle, seek };
}
