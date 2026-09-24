"use client";

import { Check, ChevronsUpDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSite, useSites } from "@/hooks/use-fleet-data";
import { useUiStore } from "@/stores/ui-store";

/**
 * Sites are the roster's industries (api.sites) — switching re-scopes every
 * task, machine, operator and alert read. The list is live: an industry with
 * no tasks on the roster doesn't appear.
 */
export function SiteSwitcher({ collapsed }: { collapsed?: boolean }) {
  const site = useSite();
  const setSiteId = useUiStore((s) => s.setSiteId);
  const { data: sites } = useSites();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-inset px-2.5 text-small hover:border-border-strong",
          collapsed && "justify-center px-0",
        )}
        aria-label={`Site: ${site}`}
      >
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        {!collapsed ? (
          <>
            <span className="flex-1 truncate text-left">{site}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-60">
        <DropdownMenuLabel className="eyebrow">Site · industry</DropdownMenuLabel>
        {sites?.length ? (
          sites.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => setSiteId(s.id)}>
              <Check className={cn("size-4", s.id === site ? "opacity-100" : "opacity-0")} />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="font-mono text-caption text-muted-foreground tabular-nums">{s.tasks} tasks</span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>Roster unavailable</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
