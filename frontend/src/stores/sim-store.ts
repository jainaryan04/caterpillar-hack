import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DraftTask } from "@/lib/api/client";
import type { ShiftType } from "@/lib/catalog";

/** One scheduled task and who it was assigned to. Minutes count from the
 * start of that day's shift. */
export interface SimTask {
  id: string;
  task: DraftTask;
  worker_id: string;
  worker_skill: number;
  worker_fatigue: number;
  machine_id: string;
  machine_type: string;
  predicted_min: number;
  start_min: number;
  end_min: number;
}

export interface SimDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  shift: ShiftType;
  tasks: SimTask[];
}

interface SimState {
  activeDate: string | null;
  days: Record<string, SimDay>;
  open: (date: string) => void;
  setShift: (date: string, shift: ShiftType) => void;
  add: (date: string, task: SimTask) => void;
  remove: (date: string, id: string) => void;
  clear: () => void;
}

export const blank = (date: string): SimDay => ({ date, shift: "Day", tasks: [] });

/** Edit one day, creating it if it doesn't exist yet. */
function patch(s: SimState, date: string, f: (d: SimDay) => Partial<SimDay>) {
  const d = s.days[date] ?? blank(date);
  return { days: { ...s.days, [date]: { ...d, ...f(d) } } };
}

/**
 * Scheduled days. Lives only in this browser — nothing here is sent to the
 * database, so "Clear all" really does clear everything.
 */
export const useSimStore = create<SimState>()(
  persist(
    (set) => ({
      activeDate: null,
      days: {},
      open: (date) => set({ activeDate: date }),
      setShift: (date, shift) => set((s) => patch(s, date, () => ({ shift }))),
      add: (date, task) => set((s) => patch(s, date, (d) => ({ tasks: [...d.tasks, task] }))),
      remove: (date, id) => set((s) => patch(s, date, (d) => ({ tasks: d.tasks.filter((t) => t.id !== id) }))),
      clear: () => set({ days: {}, activeDate: null }),
    }),
    {
      name: "cat-fleet-sim",
      // v2: days replaced the single undated task list.
      version: 2,
      migrate: () => ({ activeDate: null, days: {} }) as unknown as SimState,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
