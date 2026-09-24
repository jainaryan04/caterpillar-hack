"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_GROUPS, SETTINGS_ITEM, type NavBadge, type NavItem } from "@/config/nav";
import { useAlerts, useConnectionState, useTasks } from "@/hooks/use-fleet-data";
import { useUiStore } from "@/stores/ui-store";
import { CatMark } from "./cat-mark";
import { ConnectionStatus } from "./connection-status";
import { SiteSwitcher } from "./site-switcher";

/** Only two items carry counts — spec §2: more badges would stop people noticing them. */
function useNavBadges(): Record<NavBadge, number> {
  const { data: alerts } = useAlerts();
  const { data: tasks } = useTasks();
  return {
    sos: alerts?.filter((a) => a.category === "emergency" && a.status === "open").length ?? 0,
    delayed: tasks?.filter((t) => t.status === "delayed").length ?? 0,
  };
}

function NavLink({
  item,
  active,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  const badgeTone = item.badge === "sos" ? "bg-danger text-white" : "bg-warning/15 text-warning";

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-body text-foreground-secondary transition-colors hover:bg-raised hover:text-foreground",
        active && "bg-raised font-medium text-foreground",
        active && "before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r-sm before:bg-brand",
        collapsed && "justify-center px-0",
      )}
    >
      <item.icon className="size-5 shrink-0" aria-hidden />
      {!collapsed ? <span className="flex-1 truncate">{item.title}</span> : null}
      {count ? (
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-caption font-semibold tabular-nums",
            badgeTone,
            collapsed && "absolute -top-0.5 right-0.5 h-4 min-w-4 text-[10px]",
          )}
          aria-label={`${count} ${item.badge === "sos" ? "open SOS" : "delayed tasks"}`}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

/** Sidebar body — shared by the desktop rail and the mobile drawer. */
export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const badges = useNavBadges();
  const connectionState = useConnectionState();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 shrink-0 items-center border-b px-3", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" onClick={onNavigate} aria-label="Go to dashboard">
          <CatMark collapsed={collapsed} />
        </Link>
      </div>

      <div className={cn("px-3 pt-3", collapsed && "px-3.5")}>
        <SiteSwitcher collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-auto mb-1 h-px w-6 bg-border" aria-hidden />
            ) : (
              <div className="eyebrow px-2.5 pb-1">{group.label}</div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                collapsed={collapsed}
                count={item.badge ? badges[item.badge] : undefined}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t px-3 py-3">
        <ConnectionStatus
          state={connectionState}
          collapsed={collapsed}
          className={cn("h-8 px-2.5", collapsed && "justify-center px-0")}
        />
        <NavLink
          item={SETTINGS_ITEM}
          active={isActive(SETTINGS_ITEM.href)}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

/** Desktop sidebar: 240px expanded, 64px collapsed — spec §2. */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "relative hidden shrink-0 border-r bg-panel transition-[width] duration-200 lg:block",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <SidebarContent collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        className="absolute top-[4.25rem] -right-3 z-10 flex size-6 items-center justify-center rounded-full border bg-panel text-muted-foreground hover:border-border-strong hover:text-foreground"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
      </button>
    </aside>
  );
}
