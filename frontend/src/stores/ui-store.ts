import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SITES } from "@/config/site";

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandOpen: boolean;
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
      siteId: SITES[0].id,
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
