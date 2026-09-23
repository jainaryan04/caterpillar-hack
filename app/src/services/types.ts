/**
 * Backend integration boundary.
 *
 * Screens and components only ever talk to these interfaces (via the instances
 * exported from `services/index.ts`). Today they are backed by the mock
 * implementations in `services/mock/`. To connect the real backend, write
 * implementations of these interfaces (REST, Socket.IO, native speech SDK...)
 * and swap them in `services/index.ts`. No UI code should need to change.
 */
import type {
  AgentContext,
  AgentMessage,
  AgentResponse,
  ImageAnalysis,
  SosStatus,
} from '@/types/agent';
import type { LearningLibrary, Operator, Shift, Task, TaskStatus, TrainingVideo } from '@/types/domain';

export type Unsubscribe = () => void;

export interface OperatorService {
  getCurrentOperator(): Promise<Operator>;
  getCurrentShift(): Promise<Shift>;
}

export interface TaskService {
  getTodaysTasks(): Promise<Task[]>;
  getTask(taskId: string): Promise<Task>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task>;
}

export interface VideoService {
  getVideo(videoId: string): Promise<TrainingVideo>;
  getVideos(videoIds: string[]): Promise<TrainingVideo[]>;
  getLibrary(): Promise<LearningLibrary>;
  saveProgress(videoId: string, positionSeconds: number): Promise<void>;
}

export interface AgentService {
  /** Conversation so far for this operator/shift. */
  getHistory(): Promise<AgentMessage[]>;
  sendMessage(message: string, context?: AgentContext): Promise<AgentResponse>;
  /** SOS updates pushed by the backend (e.g. over the realtime channel). */
  onSosStatus(listener: (status: SosStatus | null) => void): Unsubscribe;
}

export interface VoiceListeningOptions {
  context?: AgentContext;
}

/**
 * Speech front-end. The real implementation owns the microphone, wake-word
 * engine and speech-to-text; the UI only reacts to these events.
 */
export interface VoiceService {
  startListening(options?: VoiceListeningOptions): void;
  /** Operator finished speaking: finalise the transcript. */
  stopListening(): void;
  /** Abort without producing a transcript. */
  cancel(): void;
  onWakeWordDetected(listener: () => void): Unsubscribe;
  /** Partial and final transcripts while listening. */
  onTranscript(listener: (text: string, isFinal: boolean) => void): Unsubscribe;
  /** Normalised input level 0..1, ~12 times per second while listening. */
  onAmplitude(listener: (level: number) => void): Unsubscribe;
  onError(listener: (message: string) => void): Unsubscribe;
  /**
   * Development only: pretend the wake word was heard. The real service
   * should leave this undefined; the UI hides the demo trigger when it is.
   */
  simulateWakeWord?: () => void;
}

export interface MediaService {
  analyzeMachineryPhoto(input: {
    imageUri: string;
    question?: string;
    context?: AgentContext;
  }): Promise<ImageAnalysis>;
}

export type ConnectionState = 'online' | 'reconnecting' | 'offline';

export interface ConnectionService {
  getState(): ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): Unsubscribe;
}
