import type { LearningCategory, TrainingVideo } from '@/types/domain';
import type { VideoService } from '../types';
import { mockRecommendedIds, mockVideos } from './data/videos';
import { clone, MockNetworkError, simulateRequest } from './mockConfig';
import { nowIso } from '@/utils/format';

const videos: TrainingVideo[] = clone(mockVideos);
const CATEGORIES: LearningCategory[] = ['safety', 'machinery', 'maintenance', 'emergency'];

export const mockVideoService: VideoService = {
  async getVideo(videoId) {
    await simulateRequest();
    const video = videos.find((v) => v.id === videoId);
    if (!video) throw new MockNetworkError(`Video ${videoId} not found`);
    return clone(video);
  },

  async getVideos(videoIds) {
    await simulateRequest();
    return clone(videos.filter((v) => videoIds.includes(v.id)));
  },

  async getLibrary() {
    await simulateRequest();
    const recentlyWatched = videos
      .filter((v) => v.lastWatchedAt && !v.completed)
      .sort((a, b) => (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? ''));
    const byCategory = Object.fromEntries(
      CATEGORIES.map((c) => [c, videos.filter((v) => v.category === c)]),
    ) as Record<LearningCategory, TrainingVideo[]>;
    return clone({
      recommended: mockRecommendedIds
        .map((id) => videos.find((v) => v.id === id))
        .filter((v): v is TrainingVideo => Boolean(v)),
      recentlyWatched,
      byCategory,
    });
  },

  async saveProgress(videoId, positionSeconds) {
    const video = videos.find((v) => v.id === videoId);
    if (!video) return;
    video.progressSeconds = Math.max(video.progressSeconds, Math.floor(positionSeconds));
    video.lastWatchedAt = nowIso();
    if (video.progressSeconds >= video.durationSeconds - 5) video.completed = true;
  },
};
