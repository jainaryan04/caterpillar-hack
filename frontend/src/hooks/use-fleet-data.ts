"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, health, mutations, queryKeys, type CreateTaskInput } from "@/lib/api/client";
import type { Machine, Operator, SafetyAlert, Task, Zone } from "@/lib/types";
import { useAlertStore } from "@/stores/alert-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useHydrated } from "./use-hydrated";

/**
 * Hide cached data until hydration finishes. The shell's queries can fill the
 * cache before a page segment hydrates; without this gate the page would
 * hydrate with data while its server HTML holds skeletons.
 */
function useGatedQuery<T>(query: UseQueryResult<T>): UseQueryResult<T> {
  const hydrated = useHydrated();
  return hydrated ? query : ({ ...query, data: undefined, isPending: true } as UseQueryResult<T>);
}

// Machines/alerts move on their own (the backend's GPS/safety simulator ticks
// every ~6s; a schedule publish can also change either at any moment), so
// these poll instead of relying on the global staleTime: Infinity default.
const LIVE_REFETCH_MS = 5000;

// retry: 0 is deliberate. Each attempt already has its own ~10s client-side
// timeout (lib/api/client.ts), on top of the backend's own ~30s DB-pool
// timeout when Postgres is unreachable -- react-query's default retry(3) with
// backoff would stack those into a multi-minute wait before the UI could ever
// show an error, which is exactly the "nothing shown" failure mode this is
// fixing. refetchInterval keeps trying every 5s regardless.
const LIVE_QUERY_OPTS = { refetchInterval: LIVE_REFETCH_MS, retry: 0 } as const;

export const useMachines = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.machines, queryFn: api.machines, ...LIVE_QUERY_OPTS }));
export const useOperators = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.operators, queryFn: api.operators, ...LIVE_QUERY_OPTS }));
export const useTasks = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.tasks, queryFn: api.tasks, ...LIVE_QUERY_OPTS }));
export const useZones = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.zones, queryFn: api.zones, retry: 1 }));

// Run analytics. The published run only changes when someone publishes a new
// plan, so these don't need the 5s live cadence -- but they must still refetch
// after a publish, which the mutations below invalidate explicitly.
const RUN_QUERY_OPTS = { retry: 1 } as const;

export const useRunSummary = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.runSummary, queryFn: api.runSummary, ...RUN_QUERY_OPTS }));
export const useRunList = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.runList, queryFn: () => api.runList(), ...RUN_QUERY_OPTS }));
export const useRunUtilization = () =>
  useGatedQuery(
    useQuery({ queryKey: queryKeys.runUtilization, queryFn: api.runUtilization, ...RUN_QUERY_OPTS }),
  );
export const useRunWorkers = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.runWorkers, queryFn: api.runWorkers, ...RUN_QUERY_OPTS }));
export const useRunMachines = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.runMachines, queryFn: api.runMachines, ...RUN_QUERY_OPTS }));
export const useRunPortions = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.runPortions, queryFn: api.runPortions, ...RUN_QUERY_OPTS }));
export const useWorkerState = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.workerState, queryFn: api.workerState, ...RUN_QUERY_OPTS }));
export const useMachineState = () =>
  useGatedQuery(useQuery({ queryKey: queryKeys.machineState, queryFn: api.machineState, ...RUN_QUERY_OPTS }));

export const useApiHealth = () =>
  useQuery({ queryKey: queryKeys.health, queryFn: health, refetchInterval: LIVE_REFETCH_MS, retry: false });

/** Single source of truth for the "live / reconnecting / offline" chip shown
 * in the sidebar, top bar and map — all three otherwise defaulted to the
 * hardcoded "demo" state and never agreed with the real backend. */
export function useConnectionState(): "live" | "reconnecting" | "offline" {
  const { data, isError } = useApiHealth();
  if (isError) return "offline";
  if (data?.database === "connected") return "live";
  return "reconnecting";
}

/** Alerts with local UI state (the "responding"/"escalated" stages the
 * backend has no field for) layered on top of the real ack/resolve status. */
export function useAlerts() {
  const query = useGatedQuery(useQuery({ queryKey: queryKeys.alerts, queryFn: api.alerts, ...LIVE_QUERY_OPTS }));
  const overrides = useAlertStore((s) => s.overrides);
  const data = useMemo(
    () =>
      query.data?.map((a) => {
        const o = overrides[a.id];
        // A real ack/resolve (status now acknowledged/resolved) always wins
        // over a stale local "responding"/"escalated" overlay.
        if (!o || a.status === "acknowledged" || a.status === "resolved") return a;
        return { ...a, status: o.status, timeline: [...a.timeline, ...o.timeline] };
      }),
    [query.data, overrides],
  );
  return { ...query, data };
}

export function useNotifications() {
  const query = useGatedQuery(
    useQuery({ queryKey: queryKeys.notifications, queryFn: api.notifications, ...LIVE_QUERY_OPTS }),
  );
  const readIds = useNotificationStore((s) => s.readIds);
  const data = useMemo(
    () => query.data?.map((n) => (readIds.includes(n.id) ? { ...n, read: true } : n)),
    [query.data, readIds],
  );
  return { ...query, data };
}

export interface EntityLookup {
  machine: (id: string | null | undefined) => Machine | undefined;
  operator: (id: string | null | undefined) => Operator | undefined;
  task: (id: string | null | undefined) => Task | undefined;
  zone: (id: string | null | undefined) => Zone | undefined;
  alert: (id: string | null | undefined) => SafetyAlert | undefined;
}

/** Id → entity lookups for cross-references (operator name on a machine row, etc.). */
export function useLookup(): EntityLookup {
  const { data: machines } = useMachines();
  const { data: operators } = useOperators();
  const { data: tasks } = useTasks();
  const { data: zones } = useZones();
  const { data: alerts } = useAlerts();

  return useMemo(() => {
    const index = <T extends { id: string }>(rows: T[] | undefined) =>
      new Map((rows ?? []).map((r) => [r.id, r]));
    const m = index(machines);
    const o = index(operators);
    const t = index(tasks);
    const z = index(zones);
    const a = index(alerts);
    return {
      machine: (id) => (id ? m.get(id) : undefined),
      operator: (id) => (id ? o.get(id) : undefined),
      task: (id) => (id ? t.get(id) : undefined),
      zone: (id) => (id ? z.get(id) : undefined),
      alert: (id) => (id ? a.get(id) : undefined),
    };
  }, [machines, operators, tasks, zones, alerts]);
}

// ----------------------------------------------------------------- mutations ---
// Every one of these ends by invalidating the queries it affects, rather than
// hand-rolling an optimistic cache update -- the next 5s poll (or this
// explicit refetch) always reflects what the database actually did, which
// matters most for createTask/replan since the solver's own numbers can
// differ from any guess the client could make.

/** Anything that changes the schedule changes the run behind every chart, so
 * the run analytics have to be invalidated alongside the entity lists. The
 * ["run"] prefix covers all of them in one call. */
function useScheduleInvalidator() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.tasks });
    qc.invalidateQueries({ queryKey: queryKeys.machines });
    qc.invalidateQueries({ queryKey: queryKeys.operators });
    qc.invalidateQueries({ queryKey: ["run"] });
  };
}

export function useCreateTask() {
  const invalidate = useScheduleInvalidator();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => mutations.createTask(input),
    onSuccess: invalidate,
  });
}

export function useReplan() {
  const invalidate = useScheduleInvalidator();
  return useMutation({ mutationFn: () => mutations.replan(), onSuccess: invalidate });
}

export function useCompleteTask() {
  const invalidate = useScheduleInvalidator();
  return useMutation({
    mutationFn: (taskId: string) => mutations.completeTask(taskId),
    onSuccess: invalidate,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => mutations.acknowledgeAlert(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alerts }),
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => mutations.resolveAlert(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alerts }),
  });
}
