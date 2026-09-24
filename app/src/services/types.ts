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
  ImagePoint,
  ManualOpenResult,
  SosStatus,
  VoiceConnection,
  VoiceEvent,
} from '@/types/agent';
import type { LearningLibrary, MyTasks, Operator, Task, TaskStatus, TrainingVideo } from '@/types/domain';

export type Unsubscribe = () => void;

export interface OperatorService {
  /** Everyone who can sign in on this phone (the worker roster). */
  listOperators(): Promise<Operator[]>;
  getOperator(workerId: string): Promise<Operator>;
}

export interface TaskService {
  /** This worker's work in the live plan: starting today, else the next ones. */
  getMyTasks(workerId: string): Promise<MyTasks>;
  /** `taskId` is the Task.id returned by getMyTasks. */
  getTask(workerId: string, taskId: string): Promise<Task>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task>;
}

/** Thrown by TaskService when there is no published plan to read. */
export class NoPublishedPlanError extends Error {
  constructor() {
    super('No plan has been published yet.');
    this.name = 'NoPublishedPlanError';
  }
}

export interface VideoService {
  getVideo(videoId: string): Promise<TrainingVideo>;
  getVideos(videoIds: string[]): Promise<TrainingVideo[]>;
  getLibrary(): Promise<LearningLibrary>;
  saveProgress(videoId: string, positionSeconds: number, durationSeconds: number): Promise<void>;
}

export interface AgentService {
  /** Conversation so far for this operator/shift. */
  getHistory(): Promise<AgentMessage[]>;
  sendMessage(message: string, context?: AgentContext): Promise<AgentResponse>;
  /** The operator paused a training video: questions about "this" now mean that frame. */
  reportVideoPause(videoId: string, seconds: number): Promise<void>;
  /** The operator stopped looking at the paused frame / photo (video resumed, photo closed). */
  clearScreen(): Promise<void>;
  /** Manual page(s) behind the last answer, or a given page. */
  openManual(page?: number): Promise<ManualOpenResult>;
  /** SOS updates pushed by the backend (e.g. over the realtime channel). */
  onSosStatus(listener: (status: SosStatus | null) => void): Unsubscribe;
}

/**
 * Live voice session with the agent. The session listens continuously; the
 * wake phrase ("Hey Cat") is detected by the agent, which also speaks the
 * answers. The UI reacts to the events.
 */
export interface VoiceService {
  /** Said before every question, e.g. "Hey Cat". */
  readonly wakePhrase: string;
  /** True when the audio goes over a real connection (not the demo). */
  readonly live: boolean;
  getConnection(): VoiceConnection;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (event: VoiceEvent) => void): Unsubscribe;
  /**
   * Demo only: pretend the operator said the wake phrase and a question.
   * Real implementations leave this undefined.
   */
  simulateUtterance?: (context?: AgentContext) => void;
}

export interface MediaService {
  analyzeMachineryPhoto(input: {
    imageUri: string;
    question?: string;
    context?: AgentContext;
    /** Where the operator circled or tapped on the photo. */
    circle?: ImagePoint[];
    tap?: ImagePoint;
  }): Promise<ImageAnalysis>;
}

/** `degraded`: the task server is up but cannot reach its database. */
export type ConnectionState = 'online' | 'degraded' | 'offline';

export interface ConnectionService {
  getState(): ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): Unsubscribe;
}
