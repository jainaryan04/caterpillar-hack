/**
 * Data access seam. Every screen reads through these functions via React
 * Query hooks (src/hooks/use-fleet-data.ts). They resolve mock data today;
 * the backend phase swaps each body for a real fetch without touching the UI.
 */
import { alerts, notifications } from "@/lib/mock/alerts";
import { machines } from "@/lib/mock/machines";
import { manuals } from "@/lib/mock/manuals";
import { operators } from "@/lib/mock/operators";
import { zones } from "@/lib/mock/site";
import { tasks } from "@/lib/mock/tasks";

const resolve = <T>(data: T): Promise<T> => Promise.resolve(structuredClone(data));

export const api = {
  machines: () => resolve(machines),
  operators: () => resolve(operators),
  tasks: () => resolve(tasks),
  alerts: () => resolve(alerts),
  notifications: () => resolve(notifications),
  zones: () => resolve(zones),
  manuals: () => resolve(manuals),
};

export const queryKeys = {
  machines: ["machines"] as const,
  operators: ["operators"] as const,
  tasks: ["tasks"] as const,
  alerts: ["alerts"] as const,
  notifications: ["notifications"] as const,
  zones: ["zones"] as const,
  manuals: ["manuals"] as const,
};
