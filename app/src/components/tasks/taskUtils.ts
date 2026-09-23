import type { Task, TaskStatus } from '@/types/domain';

/** The task the operator should work on now: in progress first, else the next pending one. */
export function currentTask(tasks: Task[]): Task | undefined {
  return tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending');
}

/** Status for display, promoting the current pending task to "Up next". */
export function displayStatus(task: Task, current: Task | undefined): TaskStatus | 'next' {
  if (task.status === 'pending' && current?.id === task.id) return 'next';
  return task.status;
}
