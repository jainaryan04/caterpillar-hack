import { useCallback, useState } from 'react';

// Kept for the session so leaving and re-opening a task keeps the ticks.
const store = new Map<string, Set<string>>();

export function useSafetyChecks(taskId: string) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(store.get(taskId)));
  const toggle = useCallback(
    (id: string) => {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        store.set(taskId, next);
        return next;
      });
    },
    [taskId],
  );
  return { checked, toggle };
}
