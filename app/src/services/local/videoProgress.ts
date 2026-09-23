import { nowIso } from '@/utils/format';
import { storage } from './storage';

/**
 * Watch progress kept on the phone: the Cat agent serves videos but does not
 * track who watched what.
 */
export interface VideoProgress {
  seconds: number;
  completed: boolean;
  lastWatchedAt: string;
}

const KEY = 'video.progress.v1';
let cache: Record<string, VideoProgress> | null = null;

async function load(): Promise<Record<string, VideoProgress>> {
  if (!cache) cache = (await storage.get<Record<string, VideoProgress>>(KEY)) ?? {};
  return cache;
}

export const videoProgress = {
  all: load,
  async save(videoId: string, seconds: number, durationSeconds: number) {
    const map = await load();
    const prev = map[videoId];
    const best = Math.max(prev?.seconds ?? 0, Math.floor(seconds));
    map[videoId] = {
      seconds: best,
      completed: prev?.completed || best >= durationSeconds - 5,
      lastWatchedAt: nowIso(),
    };
    await storage.set(KEY, map);
  },
};
