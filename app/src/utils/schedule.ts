import type { MyTasks, Shift, Task } from '@/types/domain';

const UPCOMING_LIMIT = 5;

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today", "Tomorrow" or "Thu 25 Sep" */
export function dayLabel(date: Date, now = new Date()): string {
  if (sameLocalDay(date, now)) return 'Today';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameLocalDay(date, tomorrow)) return 'Tomorrow';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Home's task list: everything that starts today plus anything already in
 * progress. If nothing starts today (the plan is for another day), fall back to
 * the next few open assignments so the operator always sees what's coming.
 */
export function selectMyTasks(all: Task[], now = new Date()): MyTasks {
  const sorted = [...all].sort((a, b) => (a.scheduledStartAt ?? '').localeCompare(b.scheduledStartAt ?? ''));
  const today = sorted.filter(
    (t) => t.status === 'in_progress' || (t.scheduledStartAt && sameLocalDay(new Date(t.scheduledStartAt), now)),
  );
  if (today.length) return { tasks: today, scope: 'today' };
  const open = sorted.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const upcoming = open.filter((t) => !t.scheduledStartAt || new Date(t.scheduledStartAt) >= now);
  return { tasks: (upcoming.length ? upcoming : open).slice(0, UPCOMING_LIMIT), scope: 'upcoming' };
}

/** A shift view derived from the listed work: first start to last finish. */
export function deriveShift(tasks: Task[], now = new Date()): Shift | undefined {
  const timed = tasks.filter((t) => t.scheduledStartAt && t.scheduledEndAt);
  if (!timed.length) return undefined;
  const starts = timed.map((t) => new Date(t.scheduledStartAt as string).getTime());
  const ends = timed.map((t) => new Date(t.scheduledEndAt as string).getTime());
  const first = new Date(Math.min(...starts));
  const last = new Date(Math.max(...ends));
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const shiftType = timed.find((t) => t.shiftType)?.shiftType;
  return {
    name: shiftType ? `${shiftType} shift` : 'Scheduled work',
    start: hhmm(first),
    end: sameLocalDay(first, last) ? hhmm(last) : `${hhmm(last)} (${dayLabel(last, now)})`,
    dayLabel: dayLabel(first, now),
  };
}
