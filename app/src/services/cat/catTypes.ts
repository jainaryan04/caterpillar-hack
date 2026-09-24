/** Raw shapes from the Cat agent's phone API (cat_agent/cat/app_api.py, cat_agent/API.md). */
import type { AgentAction, AgentCitation, ImageFinding, ManualRef } from '@/types/agent';
import type { LearningCategory, MachineType, VideoChapter } from '@/types/domain';

export interface CatAgentResponse {
  id: string;
  createdAt: string;
  text: string;
  citations: AgentCitation[];
  actions: AgentAction[];
  kind?: 'manual' | 'screen';
  manual?: ManualRef | null;
  imageUrl?: string | null;
}

export interface CatScreen {
  annotatedUrl?: string | null;
  manualCloseups?: { callout: string; url: string }[];
}

export interface CatImageAnalysis {
  id: string;
  createdAt: string;
  summary: string;
  findings: ImageFinding[];
  limitations: string;
  recommendedAction: string;
  confidence: 'low' | 'medium' | 'high';
  citations?: AgentCitation[];
  manual?: ManualRef | null;
  imageUrl?: string | null;
  screen?: CatScreen | null;
}

export interface CatManualOpen {
  opened: boolean;
  message: string;
  page?: number;
  pageEnd?: number;
  topic?: string | null;
  url?: string;
  width?: number;
  height?: number;
}

export interface CatTrainingVideo {
  id: string;
  title: string;
  summary: string;
  category: LearningCategory;
  durationSeconds: number;
  videoUrl: string | null;
  chapters: VideoChapter[];
  required: boolean;
  machineType: MachineType;
  posterUrl?: string | null;
  subtitlesUrl?: string | null;
}

/** POST /api/app/voice (push-to-talk): the answer, plus what Cat heard and its spoken reply. */
export interface CatVoiceReply extends CatAgentResponse {
  /** What Cat heard, without "Hey Cat" ("" if nothing). */
  transcript: string;
  /** MP3 of the answer, streamed while it's synthesised. */
  audioUrl: string | null;
  /** "Open it": the manual pages to show. */
  pages: { url: string; page: number; pageEnd?: number; topic?: string | null; width: number; height: number } | null;
}
