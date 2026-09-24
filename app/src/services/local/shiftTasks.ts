import type { Task } from '@/types/domain';
import type { TaskService } from '../types';

/**
 * The operator's tasks as this phone last saw them, status changes included.
 * Sent with each question so Cat can answer "what should I do next?"
 * (the Cat agent has no access to the plan itself).
 */
export interface ShiftTask {
  id: string;
  title: string;
  machine: string;
  location: string;
  status: Task['status'];
  priority: Task['priority'];
  /** HH:mm */
  scheduledStart: string;
  /** The first safety checks, so Cat can say what to do before starting. */
  safety: string[];
}

let tasks: Task[] = [];

export function shiftTasks(): ShiftTask[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    machine: t.machine,
    location: t.location,
    status: t.status,
    priority: t.priority,
    scheduledStart: t.scheduledStart,
    safety: t.safetyChecklist.slice(0, 2).map((c) => c.detail ?? c.label),
  }));
}

function remember(task: Task) {
  tasks = tasks.map((t) => (t.id === task.id ? task : t));
}

/** `service`, keeping what it returns for shiftTasks(). */
export function trackShiftTasks(service: TaskService): TaskService {
  return {
    async getMyTasks(workerId) {
      const mine = await service.getMyTasks(workerId);
      tasks = mine.tasks;
      return mine;
    },
    async getTask(workerId, taskId) {
      const task = await service.getTask(workerId, taskId);
      remember(task);
      return task;
    },
    async updateTaskStatus(taskId, status) {
      const task = await service.updateTaskStatus(taskId, status);
      remember(task);
      return task;
    },
  };
}
