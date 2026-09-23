"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Info, Siren, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-fleet-data";
import { useNotificationStore } from "@/stores/notification-store";
import type { AppNotification, NotificationTier } from "@/lib/types";
import { EmptyState } from "./empty-state";
import { RelativeTime } from "./relative-time";
import { SegmentedControl } from "./segmented-control";
import { TableSkeleton } from "./loading-skeleton";

const tierIcon: Record<NotificationTier, { icon: typeof Siren; className: string; label: string }> = {
  p1: { icon: Siren, className: "text-danger", label: "Critical" },
  p2: { icon: TriangleAlert, className: "text-warning", label: "Warning" },
  p3: { icon: Info, className: "text-info", label: "Info" },
};

function isToday(iso: string) {
  const d = new Date(iso);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

/** Notification center content — spec §16. Rendered inside the bell popover. */
export function NotificationPanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const { data, isPending } = useNotifications();
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const items = useMemo(() => (data ?? []).filter((n) => tab === "all" || !n.read), [data, tab]);
  const groups = useMemo(
    () => [
      { label: "Today", items: items.filter((n) => isToday(n.at)) },
      { label: "Earlier", items: items.filter((n) => !isToday(n.at)) },
    ],
    [items],
  );
  const unread = (data ?? []).filter((n) => !n.read);

  const open = (n: AppNotification) => {
    markRead(n.id);
    onNavigate?.();
    router.push(n.href);
  };

  return (
    <div className="flex max-h-[min(560px,80dvh)] flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="text-h3">Notifications</h2>
        <SegmentedControl
          ariaLabel="Filter notifications"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: `Unread${unread.length ? ` (${unread.length})` : ""}` },
          ]}
          className="h-8"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <TableSkeleton rows={4} columns={1} />
        ) : items.length === 0 ? (
          <EmptyState variant="clear" title="You're up to date" className="py-8" />
        ) : (
          groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.label}>
                <div className="eyebrow sticky top-0 bg-overlay px-3 pt-3 pb-1">{g.label}</div>
                <ul>
                  {g.items.map((n) => {
                    const t = tierIcon[n.tier];
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => open(n)}
                          className={cn(
                            "flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-raised",
                            n.tier === "p1" && !n.read && "border-l-2 border-danger",
                          )}
                        >
                          <t.icon className={cn("mt-0.5 size-4 shrink-0", t.className)} aria-label={t.label} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className={cn("truncate text-small", n.read ? "text-foreground-secondary" : "font-medium text-foreground")}>
                              {n.title}
                            </span>
                            <span className="truncate text-caption text-muted-foreground">{n.detail}</span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <RelativeTime iso={n.at} className="text-caption text-muted-foreground" />
                            {!n.read ? <span className="size-2 rounded-full bg-info" aria-label="Unread" /> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
        )}
      </div>

      <div className="flex items-center justify-between border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={unread.length === 0}
          onClick={() => markAllRead(unread.map((n) => n.id))}
        >
          <CheckCheck /> Mark all read
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onNavigate?.();
            router.push("/safety");
          }}
        >
          Open Safety & SOS
        </Button>
      </div>
    </div>
  );
}
