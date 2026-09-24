"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnectionState } from "@/hooks/use-fleet-data";
import { useUiStore } from "@/stores/ui-store";
import { Breadcrumbs } from "./breadcrumbs";
import { CommandSearchTrigger } from "./command-search";
import { ConnectionStatus } from "./connection-status";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function TopBar() {
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const connectionState = useConnectionState();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-panel px-4">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 lg:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <CommandSearchTrigger />
        <ConnectionStatus state={connectionState} className="hidden px-2 xl:flex" />
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
