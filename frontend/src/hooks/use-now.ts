"use client";

import { useEffect, useState } from "react";

/**
 * Current time that ticks on an interval. Returns null during SSR and the
 * first client render so relative times never cause hydration mismatches.
 */
export function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
