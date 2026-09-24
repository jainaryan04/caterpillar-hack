/**
 * Types for the Cat agent integration boundary.
 *
 * The agent backend, speech pipeline and action execution live elsewhere.
 * These types describe what the mobile UI sends and what it knows how to render.
 */

/** What the operator is looking at when they ask something. */
export interface AgentContext {
  taskId?: string;
  videoId?: string;
  /** Playback position in seconds when the question was asked. */
  timestamp?: number;
  videoTitle?: string;
  chapterTitle?: string;
  taskTitle?: string;
  /** Local URI of a machinery photo attached to the question. */
  imageUri?: string;
}

export type AgentInputMode = 'text' | 'voice' | 'image';

export type AgentAction =
  | { type: 'ANSWER' }
  | { type: 'EXPLAIN_VIDEO'; videoId: string; timestamp: number }
  | { type: 'GET_CURRENT_TASK' }
  | { type: 'OPEN_TASK'; taskId: string }
  | { type: 'OPEN_VIDEO'; videoId: string; timestamp?: number }
  | { type: 'OPEN_LEARNING'; category?: string }
  | { type: 'PAUSE_VIDEO' }
  | { type: 'RESUME_VIDEO' }
  | { type: 'TRIGGER_SOS' }
  | { type: 'CONTACT_SUPERVISOR' }
  | { type: 'OPEN_CAMERA' }
  | { type: 'OPEN_MANUAL'; page?: number };

export type AgentActionType = AgentAction['type'];

export interface AgentCitation {
  /** e.g. "Cat 320D Operation & Maintenance Manual" */
  source: string;
  /** e.g. "p. 84" or "Chapter 4 · 11:30" */
  locator: string;
}

/** The manual section an answer came from. */
export interface ManualRef {
  page: number;
  pageEnd?: number;
  topic?: string | null;
}

export interface AgentResponse {
  id: string;
  text: string;
  /** Short safety callout rendered separately from the answer body. */
  caution?: string;
  citations: AgentCitation[];
  actions: AgentAction[];
  createdAt: string;
  /** The manual's picture for this answer, if any. */
  imageUrl?: string | null;
  manual?: ManualRef | null;
}

/** A rendered manual page ("Open the manual for this"). */
export interface ManualPage {
  url: string;
  width: number;
  height: number;
  page: number;
  pageEnd?: number;
  topic?: string | null;
  message: string;
}

/** Result of "open the manual": the page, or the server's reason it couldn't. */
export type ManualOpenResult = { opened: true; page: ManualPage } | { opened: false; message: string };

export type AgentMessageRole = 'operator' | 'agent';

export type AgentMessageStatus = 'sent' | 'failed';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  text: string;
  createdAt: string;
  mode: AgentInputMode;
  status: AgentMessageStatus;
  context?: AgentContext;
  caution?: string;
  citations?: AgentCitation[];
  actions?: AgentAction[];
  imageUrl?: string | null;
  manual?: ManualRef | null;
}

/**
 * Visual states of the voice overlay.
 * listening: the operator is talking (after "Hey Cat") · thinking: Cat is
 * working · responding: Cat is speaking · done: the answer has been spoken.
 */
export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'responding' | 'done' | 'error';

/** Live voice connection to the agent. `unavailable`: this build can't do live voice (e.g. Expo Go). */
export type VoiceConnection = 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'error';

/** What the live voice session reports, in the order it happens. */
export type VoiceEvent =
  | { type: 'connection'; state: VoiceConnection; detail?: string }
  | { type: 'user-speaking'; speaking: boolean }
  | { type: 'user-transcript'; text: string; final: boolean }
  | { type: 'bot-speaking'; speaking: boolean }
  /** One sentence of what Cat is saying. */
  | { type: 'bot-text'; text: string }
  | { type: 'manual-image'; url: string; page?: number; caption?: string }
  | { type: 'manual-pages'; url: string; page: number; pageEnd?: number; topic?: string | null; width: number; height: number }
  /** 0..1 input (operator mic) or output (Cat's voice) level. */
  | { type: 'level'; source: 'local' | 'remote'; level: number };

/**
 * SOS state as reported by the backend. The Supervisor dashboard owns alert
 * management; the operator app only reflects what it's told.
 */
export interface SosStatus {
  incidentId: string;
  state: 'sent' | 'acknowledged';
  sentAt: string;
  supervisorName: string;
  /** e.g. "En route · ETA 4 min" once acknowledged */
  note?: string;
}

export type ImageFindingSeverity = 'info' | 'caution' | 'critical';

export interface ImageFinding {
  label: string;
  severity: ImageFindingSeverity;
}

export interface ImageAnalysis {
  id: string;
  summary: string;
  findings: ImageFinding[];
  /** Always present: what the model cannot confirm from a photo. */
  limitations: string;
  recommendedAction: string;
  confidence: 'low' | 'medium' | 'high';
  createdAt: string;
  /** The operator's photo with their circle and the agent's reading drawn on it. */
  annotatedImageUrl?: string | null;
  /** The same control cut out of the manual's drawing, for comparison. */
  manualCloseupUrl?: string | null;
  manual?: ManualRef | null;
  citations?: AgentCitation[];
}

/** Points 0..1 across and down the displayed photo. */
export type ImagePoint = [number, number];
