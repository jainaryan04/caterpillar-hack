/** Core field-operations domain objects shared by every screen. */

export type WorkerStatus = 'AVAILABLE' | 'RESERVED' | 'IN_USE' | 'OFF_DUTY';

/** A worker from the Fleet API roster. The backend has no names, so `name` is the worker id. */
export interface Operator {
  id: string;
  name: string;
  skills: string[];
  /** 1..10 */
  skillLevel: number;
  /** 0..100 */
  fatigue: number;
  status: WorkerStatus;
  /** Portions assigned to this worker in the published plan, when known. */
  plannedAssignments?: number;
}

/** Derived from the operator's scheduled work; the backend has no shift object. */
export interface Shift {
  name: string;
  /** Local wall-clock time, HH:mm */
  start: string;
  end: string;
  /** e.g. "Today" or "Thu 25 Sep" */
  dayLabel: string;
}

export type MachineType =
  | 'excavator'
  | 'pump'
  | 'conveyor'
  | 'crusher'
  | 'haul_truck'
  | 'site';

export interface Machine {
  id: string;
  name: string;
  model: string;
  type: MachineType;
  location: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export type TaskPriority = 'normal' | 'high';

export interface SafetyCheckItem {
  id: string;
  label: string;
  /** Short reason shown under the label, e.g. which PPE standard applies. */
  detail?: string;
}

export interface TaskStep {
  id: string;
  instruction: string;
  /** Optional caution callout attached to this step. */
  caution?: string;
}

export interface Task {
  id: string;
  title: string;
  machineId: string;
  machine: string;
  location: string;
  estimatedMinutes: number;
  status: TaskStatus;
  priority: TaskPriority;
  /** Planned start, HH:mm */
  scheduledStart: string;
  /** Actual completion time, HH:mm */
  completedAt?: string;
  blockedReason?: string;
  description: string;
  safetyChecklist: SafetyCheckItem[];
  steps: TaskStep[];
  tutorialVideoId?: string;
  relatedVideoIds: string[];

  // Scheduling details from the Fleet API (absent in older mock data).
  /** Roster task id, e.g. "T004". `id` is the assignment (portion) id. */
  taskCode?: string;
  industry?: string;
  stage?: number;
  /** ISO timestamps of the planned slot */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  weather?: string;
  shiftType?: string;
  workQuantity?: number;
  workUnit?: string;
  /** Share of the task's work in this portion (portions of a split task sum to > 100). */
  workSharePct?: number;
  /** The task is split across several machines/crews. */
  parallel?: boolean;
}

/** What Home shows: today's work, or the next assignments if nothing starts today. */
export interface MyTasks {
  tasks: Task[];
  scope: 'today' | 'upcoming';
}

export type LearningCategory = 'safety' | 'machinery' | 'maintenance' | 'emergency';

export interface VideoChapter {
  title: string;
  /** Seconds from start */
  startsAt: number;
}

export interface TrainingVideo {
  id: string;
  title: string;
  summary: string;
  category: LearningCategory;
  durationSeconds: number;
  /** Null until the media backend provides a playable stream. */
  videoUrl: string | null;
  chapters: VideoChapter[];
  /** Seconds watched by this operator. */
  progressSeconds: number;
  completed: boolean;
  /** Site-mandated training. */
  required: boolean;
  /** Machine type drawn on the placeholder thumbnail. */
  machineType: MachineType;
  lastWatchedAt?: string;
  posterUrl?: string | null;
  subtitlesUrl?: string | null;
}

export interface LearningLibrary {
  recommended: TrainingVideo[];
  recentlyWatched: TrainingVideo[];
  byCategory: Record<LearningCategory, TrainingVideo[]>;
}
