import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useCallback, useState } from 'react';
import type { Playback } from './useMockPlayback';

/** Seeking is a property write on the native player object. */
function setTime(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
}

/**
 * Playback for a real stream (expo-video), in the same `Playback` shape as the
 * simulated clock so VideoPlayer renders either.
 */
export function useStreamPlayback(url: string, durationSeconds: number, initialPosition = 0): Playback & { player: VideoPlayer } {
  const start = Math.max(0, Math.min(initialPosition, durationSeconds - 1));
  const player = useVideoPlayer(url, (p) => {
    p.timeUpdateEventInterval = 0.25;
    setTime(p, start);
  });
  const [position, setPosition] = useState(start);
  const [ended, setEnded] = useState(false);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status: playerStatus, error } = useEvent(player, 'statusChange', { status: player.status });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => setPosition(currentTime));
  useEventListener(player, 'playToEnd', () => setEnded(true));

  const play = useCallback(() => {
    if (ended) {
      setTime(player, 0);
      setEnded(false);
    }
    player.play();
  }, [ended, player]);
  const pause = useCallback(() => player.pause(), [player]);
  const toggle = useCallback(() => (player.playing ? player.pause() : play()), [player, play]);
  const seek = useCallback(
    (seconds: number) => {
      const t = Math.max(0, Math.min(durationSeconds, seconds));
      setTime(player, t);
      setPosition(t);
      setEnded(false);
    },
    [durationSeconds, player],
  );

  return {
    player,
    status: isPlaying ? 'playing' : ended ? 'ended' : 'paused',
    loadState: playerStatus === 'error' ? 'error' : playerStatus === 'readyToPlay' ? 'ready' : 'loading',
    error: error?.message,
    position,
    play,
    pause,
    toggle,
    seek,
  };
}
