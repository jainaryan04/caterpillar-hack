import type { Task } from '@/types/domain';
import { formatTimeOfDay, nowIso } from '@/utils/format';
import type { TaskService } from '../types';
import { mockTasks } from './data/operations';
import { clone, MockNetworkError, simulateRequest } from './mockConfig';

// In-memory copy so status changes persist for the session.
const tasks: Task[] = clone(mockTasks);

export const mockTaskService: TaskService = {
  async getTodaysTasks() {
    await simulateRequest();
    return clone(tasks);
  },

  async getTask(taskId) {
    await simulateRequest();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new MockNetworkError(`Task ${taskId} not found`);
    return clone(task);
  },

  async updateTaskStatus(taskId, status) {
    await simulateRequest(300);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new MockNetworkError(`Task ${taskId} not found`);
    task.status = status;
    task.completedAt = status === 'completed' ? formatTimeOfDay(nowIso()) : undefined;
    return clone(task);
  },
};
