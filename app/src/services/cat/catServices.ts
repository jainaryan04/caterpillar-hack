import { config } from '@/config';
import type { AgentResponse, ImageAnalysis } from '@/types/agent';
import type { LearningCategory, LearningLibrary, TrainingVideo } from '@/types/domain';
import { request } from '../http';
import { shiftTasks } from '../local/shiftTasks';
import { videoProgress } from '../local/videoProgress';
import type { AgentService, MediaService, VideoService } from '../types';
import type { CatAgentResponse, CatImageAnalysis, CatManualOpen, CatTrainingVideo } from './catTypes';

const base = () => config.catApiUrl;
/**
 * The agent's voice tools read the 'local' screen session, so the app reports
 * pauses and photos there too; that way "Hey Cat, what does this do?" sees
 * what's on this phone. (One screen-aware phone at a time.)
 */
const sessionId = () => 'local';

export const catAgentService: AgentService = {
  async getHistory() {
    // The Cat agent keeps no chat history for the app; the conversation lives on the phone.
    return [];
  },

  async sendMessage(message, context) {
    const r = await request<CatAgentResponse>(base(), '/api/app/agent/message', {
      method: 'POST',
      body: { message, context, sessionId: sessionId(), tasks: shiftTasks() },
      timeoutMs: 30000,
    });
    const response: AgentResponse = {
      id: r.id,
      text: r.text,
      citations: r.citations ?? [],
      actions: r.actions ?? [],
      createdAt: r.createdAt,
      imageUrl: r.imageUrl ?? null,
      manual: r.manual ?? null,
    };
    return response;
  },

  async reportVideoPause(videoId, seconds) {
    await request(base(), '/api/screen/video', {
      method: 'POST',
      body: { video_id: videoId, t: seconds, session_id: sessionId() },
      timeoutMs: 8000,
    });
  },

  async clearScreen() {
    await request(base(), '/api/app/screen/clear', { method: 'POST', body: { sessionId: sessionId() }, timeoutMs: 5000 });
  },

  async openManual(page) {
    const q = `sessionId=${encodeURIComponent(sessionId())}${page ? `&page=${page}` : ''}`;
    const r = await request<CatManualOpen>(base(), `/api/app/manual/open?${q}`, { timeoutMs: 10000 });
    // Keep the server's reason: "nothing looked up yet" and "couldn't render" need different help.
    if (!r.opened || !r.url) return { opened: false, message: r.message };
    return {
      opened: true,
      page: {
        url: r.url,
        width: r.width ?? 935,
        height: r.height ?? 1210,
        page: r.page ?? page ?? 0,
        pageEnd: r.pageEnd,
        topic: r.topic,
        message: r.message,
      },
    };
  },

  onSosStatus() {
    // No SOS channel on the Cat agent yet; the Supervisor backend will own this.
    return () => undefined;
  },
};

export const catMediaService: MediaService = {
  async analyzeMachineryPhoto({ imageUri, question, circle, tap }) {
    const form = new FormData();
    // React Native's FormData takes a { uri, name, type } descriptor for files.
    form.append('file', { uri: imageUri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
    if (question) form.append('question', question);
    if (circle?.length) form.append('circle', JSON.stringify(circle));
    if (tap) {
      form.append('tapX', String(tap[0]));
      form.append('tapY', String(tap[1]));
    }
    form.append('sessionId', sessionId());
    const r = await request<CatImageAnalysis>(base(), '/api/app/photo/analyze', {
      method: 'POST',
      body: form,
      timeoutMs: 45000,
    });
    const analysis: ImageAnalysis = {
      id: r.id,
      summary: r.summary,
      findings: r.findings ?? [],
      limitations: r.limitations,
      recommendedAction: r.recommendedAction,
      confidence: r.confidence,
      createdAt: r.createdAt,
      annotatedImageUrl: r.screen?.annotatedUrl ?? null,
      manualCloseupUrl: r.screen?.manualCloseups?.[0]?.url ?? r.imageUrl ?? null,
      manual: r.manual ?? null,
      citations: r.citations,
    };
    return analysis;
  },
};

const CATEGORIES: LearningCategory[] = ['safety', 'machinery', 'maintenance', 'emergency'];

async function withProgress(videos: CatTrainingVideo[]): Promise<TrainingVideo[]> {
  const progress = await videoProgress.all();
  return videos.map((v) => {
    const p = progress[v.id];
    return {
      ...v,
      progressSeconds: p?.seconds ?? 0,
      completed: p?.completed ?? false,
      lastWatchedAt: p?.lastWatchedAt,
    };
  });
}

const listVideos = async () =>
  withProgress(await request<CatTrainingVideo[]>(base(), '/api/app/videos', { timeoutMs: 10000 }));

export const catVideoService: VideoService = {
  async getVideo(videoId) {
    const [v] = await withProgress([
      await request<CatTrainingVideo>(base(), `/api/app/videos/${encodeURIComponent(videoId)}`, { timeoutMs: 10000 }),
    ]);
    return v;
  },

  async getVideos(videoIds) {
    const all = await listVideos();
    return all.filter((v) => videoIds.includes(v.id));
  },

  async getLibrary() {
    const all = await listVideos();
    const byCategory = Object.fromEntries(
      CATEGORIES.map((c) => [c, all.filter((v) => v.category === c)]),
    ) as Record<LearningCategory, TrainingVideo[]>;
    const library: LearningLibrary = {
      recommended: all.filter((v) => v.required && !v.completed),
      recentlyWatched: all
        .filter((v) => v.lastWatchedAt && !v.completed)
        .sort((a, b) => (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '')),
      byCategory,
    };
    return library;
  },

  async saveProgress(videoId, positionSeconds, durationSeconds) {
    await videoProgress.save(videoId, positionSeconds, durationSeconds);
  },
};
