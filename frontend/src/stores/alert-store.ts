import { create } from "zustand";
import type { AlertStatus, TimelineEntry } from "@/lib/types";
import { CURRENT_USER } from "@/config/site";

interface AlertOverride {
  status: AlertStatus;
  timeline: TimelineEntry[];
}

interface AlertState {
  overrides: Record<string, AlertOverride>;
  setStatus: (id: string, status: AlertStatus, action: string) => void;
}

/**
 * Local-only overlay for the two lifecycle stages the backend has no field
 * for at all ("responding", "escalated" -- machine_safety_events only has
 * OPEN/ACKNOWLEDGED/RESOLVED). Acknowledge and Resolve are real mutations
 * (see hooks/use-fleet-data.ts) and never go through this store.
 */
export const useAlertStore = create<AlertState>()((set) => ({
  overrides: {},
  setStatus: (id, status, action) =>
    set((s) => ({
      overrides: {
        ...s.overrides,
        [id]: {
          status,
          timeline: [
            ...(s.overrides[id]?.timeline ?? []),
            { at: new Date().toISOString(), actor: CURRENT_USER.name, action },
          ],
        },
      },
    })),
}));
