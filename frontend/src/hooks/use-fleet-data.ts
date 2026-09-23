"use client";

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api/client";
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

export const useMachines = () => useGatedQuery(useQuery({ queryKey: queryKeys.machines, queryFn: api.machines }));
export const useOperators = () => useGatedQuery(useQuery({ queryKey: queryKeys.operators, queryFn: api.operators }));
export const useTasks = () => useGatedQuery(useQuery({ queryKey: queryKeys.tasks, queryFn: api.tasks }));
export const useZones = () => useGatedQuery(useQuery({ queryKey: queryKeys.zones, queryFn: api.zones }));
export const useManuals = () => useGatedQuery(useQuery({ queryKey: queryKeys.manuals, queryFn: api.manuals }));

/** Alerts with local UI state (acknowledge/resolve clicks) applied on top. */
export function useAlerts() {
  const query = useGatedQuery(useQuery({ queryKey: queryKeys.alerts, queryFn: api.alerts }));
  const overrides = useAlertStore((s) => s.overrides);
  const data = useMemo(
    () =>
      query.data?.map((a) => {
        const o = overrides[a.id];
        return o ? { ...a, status: o.status, timeline: [...a.timeline, ...o.timeline] } : a;
      }),
    [query.data, overrides],
  );
  return { ...query, data };
}

export function useNotifications() {
  const query = useGatedQuery(useQuery({ queryKey: queryKeys.notifications, queryFn: api.notifications }));
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
