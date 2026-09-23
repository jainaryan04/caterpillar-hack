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
 * Local-only alert state so the prototype's Acknowledge / Resolve buttons
 * respond. Replaced by server state + Socket.IO events in the backend phase.
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
