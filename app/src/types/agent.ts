/**
 * Types for the Jarvis agent integration boundary.
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
  | { type: 'OPEN_CAMERA' };

export type AgentActionType = AgentAction['type'];

export interface AgentCitation {
  /** e.g. "Cat 320D Operation & Maintenance Manual" */
  source: string;
  /** e.g. "p. 84" or "Chapter 4 · 11:30" */
  locator: string;
}

export interface AgentResponse {
  id: string;
  text: string;
  /** Short safety callout rendered separately from the answer body. */
  caution?: string;
  citations: AgentCitation[];
  actions: AgentAction[];
  createdAt: string;
}

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
}

/** The four visual states of the Jarvis voice overlay. */
export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'responding' | 'error';

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
}
