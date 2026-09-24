import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DraftTask } from "@/lib/api/client";

/** One task in the sandbox, with the pairing it was given. Minutes count
 * from `startedAt` (when the first task was added). */
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

interface SimState {
  startedAt: string | null;
  tasks: SimTask[];
  add: (task: SimTask) => void;
  clear: () => void;
}

/**
 * The simulation sandbox. Lives only in this browser — nothing here is sent
 * to the database, so "Clear all" really does clear everything.
 */
export const useSimStore = create<SimState>()(
  persist(
    (set) => ({
      startedAt: null,
      tasks: [],
      add: (task) =>
        set((s) => ({ tasks: [...s.tasks, task], startedAt: s.startedAt ?? new Date().toISOString() })),
      clear: () => set({ tasks: [], startedAt: null }),
    }),
    { name: "cat-fleet-sim", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);
