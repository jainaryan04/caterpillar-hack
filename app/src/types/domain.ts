/** Core field-operations domain objects shared by every screen. */

export interface Operator {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  site: string;
  crew: string;
  supervisorName: string;
  assignedMachineId: string;
}

export interface Shift {
  id: string;
  name: string;
  /** Local wall-clock time, HH:mm */
  start: string;
  end: string;
  site: string;
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

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

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
}

export interface LearningLibrary {
  recommended: TrainingVideo[];
  recentlyWatched: TrainingVideo[];
  byCategory: Record<LearningCategory, TrainingVideo[]>;
}
