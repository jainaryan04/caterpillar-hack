"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useUiStore } from "@/stores/ui-store";
import { SidebarContent } from "./sidebar";

/** Below lg the sidebar becomes a drawer — spec §6. */
export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-72 gap-0 bg-panel p-0 sm:max-w-72" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Main navigation</SheetDescription>
        <SidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
