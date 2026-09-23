"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A single URL query param as state — spec §4: selections and filters live in
 * the URL so screens can be deep-linked into handover notes.
 */
export function useQueryParam(name: string): [string | null, (value: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(name);

  const setValue = useCallback(
    (next: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (next === null || next === "") sp.delete(name);
      else sp.set(name, next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [name, params, pathname, router],
  );

  return [value, setValue];
}
