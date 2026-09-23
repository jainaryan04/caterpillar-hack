"use client";

import { Check, ChevronsUpDown, MapPin } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SITES } from "@/config/site";
import { useUiStore } from "@/stores/ui-store";

export function SiteSwitcher({ collapsed }: { collapsed?: boolean }) {
  const siteId = useUiStore((s) => s.siteId);
  const setSiteId = useUiStore((s) => s.setSiteId);
  const site = SITES.find((s) => s.id === siteId) ?? SITES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-inset px-2.5 text-small hover:border-border-strong",
          collapsed && "justify-center px-0",
        )}
        aria-label={`Site: ${site.name}`}
      >
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        {!collapsed ? (
          <>
            <span className="flex-1 truncate text-left">{site.name}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-56">
        <DropdownMenuLabel className="eyebrow">Site</DropdownMenuLabel>
        {SITES.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => {
              setSiteId(s.id);
              if (s.id !== SITES[0].id) toast.info(`${s.name} selected`, { description: "Demo data is only available for Pit 3 North." });
            }}
          >
            <Check className={cn("size-4", s.id === site.id ? "opacity-100" : "opacity-0")} />
            {s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
