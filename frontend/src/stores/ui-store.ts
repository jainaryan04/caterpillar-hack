import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_INDUSTRY } from "@/lib/catalog";

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandOpen: boolean;
  /** Industry name. Persisted, so it may hold a stale value from an older
   * build — read it through useSite(), which validates it. */
  siteId: string;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setSiteId: (id: string) => void;
}

/**
 * Per-viewer UI preferences. Persisted with skipHydration; Providers calls
 * rehydrate() after mount so the server and first client render agree.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandOpen: false,
      siteId: DEFAULT_INDUSTRY,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setSiteId: (siteId) => set({ siteId }),
    }),
    {
      name: "cat-fleet-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, siteId: s.siteId }),
      skipHydration: true,
    },
  ),
);
