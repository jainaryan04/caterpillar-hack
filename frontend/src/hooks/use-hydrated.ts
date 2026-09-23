"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Lets client-only
 * data (query cache, clocks) render without hydration mismatches.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
