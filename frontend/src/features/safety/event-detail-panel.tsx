"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleCheck, MapPin, Siren, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatTime } from "@/lib/format";
import { alertCategoryLabel, alertStatusMeta, severityMeta } from "@/lib/status";
import { useAcknowledgeAlert, useResolveAlert, type EntityLookup } from "@/hooks/use-fleet-data";
import type { AlertStatus, SafetyAlert } from "@/lib/types";
import { useAlertStore } from "@/stores/alert-store";

type NoteAction = { status: Extract<AlertStatus, "resolved" | "escalated">; title: string; cta: string };

const RESOLVE: NoteAction = { status: "resolved", title: "Resolve event", cta: "Resolve" };
// "Escalated" has no backend field (machine_safety_events has OPEN/ACKNOWLEDGED/
// RESOLVED only) -- kept as a local-only annotation on top of the real status.
const ESCALATE: NoteAction = { status: "escalated", title: "Escalate to Operations Manager", cta: "Escalate" };

/** Selected event: summary, timeline, responder, lifecycle actions — spec §5.7. */
export function EventDetailPanel({ alert: a, lookup, onClose }: { alert?: SafetyAlert; lookup: EntityLookup; onClose: () => void }) {
  const setStatus = useAlertStore((s) => s.setStatus);
  const acknowledgeAlert = useAcknowledgeAlert();
  const resolveAlert = useResolveAlert();
  const [noteAction, setNoteAction] = useState<NoteAction | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);

  if (!a) {
    return (
      <aside className="rounded-lg border bg-panel">
        <EmptyState title="Select an event" description="Choose an event from the queue to see its timeline and respond." />
      </aside>
    );
  }

  const sev = severityMeta[a.severity];
  const operator = lookup.operator(a.operatorId);
  const zone = lookup.zone(a.zoneId);

  const acknowledge = () =>
    acknowledgeAlert.mutate(
      { id: a.id },
      {
        onSuccess: () => toast.success(`${a.id}: acknowledged`),
        onError: () => toast.error(`Couldn't acknowledge ${a.id}`),
      },
    );

  const markResponding = () => {
    setStatus(a.id, "responding", "Responder dispatched");
    toast.success(`${a.id}: responding`);
  };

  const submitNote = () => {
    if (!note.trim()) {
      setNoteError(true);
      return;
    }
    if (noteAction!.status === "resolved") {
      resolveAlert.mutate(
        { id: a.id, note: note.trim() },
        {
          onSuccess: () => toast.success(`${a.id}: resolved`),
          onError: () => toast.error(`Couldn't resolve ${a.id}`),
        },
      );
    } else {
      setStatus(a.id, "escalated", `Escalated — ${note.trim()}`);
      toast.success(`${a.id}: escalated`);
    }
    setNoteAction(null);
    setNote("");
    setNoteError(false);
  };

  return (
    <aside className="flex flex-col rounded-lg border bg-panel" aria-label={`Event ${a.id}`}>
      <div className={cn("flex items-start justify-between gap-2 border-b p-4", a.category === "emergency" && a.status === "open" && "border-t-4 border-t-danger")}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-center gap-2 text-caption text-muted-foreground">
            <StatusBadge meta={sev} size="sm" variant="plain" />
            <span>{alertCategoryLabel[a.category]}</span>
            <span className="font-mono">{a.id}</span>
          </span>
          <h2 className="text-h2">{a.title}</h2>
          <StatusBadge meta={alertStatusMeta[a.status]} size="sm" />
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close event" className="lg:hidden">
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-small text-foreground-secondary">{a.description}</p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
          {operator ? (
            <>
              <dt className="text-muted-foreground">Person</dt>
              <dd>
                <Link href={`/operators?operator=${operator.id}`} className="hover:underline">
                  {operator.id}
                </Link>
              </dd>
            </>
          ) : null}
          {a.machineId ? (
            <>
              <dt className="text-muted-foreground">Machine</dt>
              <dd>
                <Link href={`/machines?machine=${a.machineId}`} className="inline-flex items-center gap-1 font-mono hover:underline">
                  <Truck className="size-3.5" /> {a.machineId}
                </Link>
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Location</dt>
          <dd>{zone?.name}</dd>
          <dt className="text-muted-foreground">Raised</dt>
          <dd className="tabular-nums">
            {formatTime(a.raisedAt)} · <RelativeTime iso={a.raisedAt} />
          </dd>
          <dt className="text-muted-foreground">Assigned</dt>
          <dd>{a.assignee ?? <span className="text-warning">Unassigned</span>}</dd>
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Timeline</h3>
          <ol className="relative flex flex-col gap-3 border-l pl-4">
            {a.timeline.map((t, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[21px] size-2 rounded-full border-2 border-panel bg-foreground-secondary" aria-hidden />
                <p className="text-small">{t.action}</p>
                <p className="text-caption text-muted-foreground">
                  <span className="font-mono tabular-nums">{formatTime(t.at)}</span> · {t.actor}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {a.status !== "resolved" ? (
        <div className="flex flex-wrap gap-2 border-t p-4">
          {a.status === "open" ? (
            <Button
              variant={a.category === "emergency" ? "critical" : "default"}
              size="lg"
              className="flex-1"
              disabled={acknowledgeAlert.isPending}
              onClick={acknowledge}
            >
              <Siren /> Acknowledge
            </Button>
          ) : null}
          {a.status === "acknowledged" ? (
            <Button className="flex-1" onClick={markResponding}>
              <ArrowUpRight /> Mark responding
            </Button>
          ) : null}
          {a.position ? (
            <Button asChild variant="secondary">
              <Link href={`/map?focus=${a.id}`}>
                <MapPin /> Map
              </Link>
            </Button>
          ) : null}
          {a.status !== "escalated" ? (
            <Button variant="ghost" onClick={() => setNoteAction(ESCALATE)}>
              Escalate
            </Button>
          ) : null}
          {a.status !== "open" ? (
            <Button variant="secondary" onClick={() => setNoteAction(RESOLVE)}>
              <CircleCheck /> Resolve
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={Boolean(noteAction)} onOpenChange={(o) => !o && setNoteAction(null)}>
        <DialogContent className="bg-panel sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{noteAction?.title}</DialogTitle>
            <DialogDescription>
              {a.id} · {a.title}. A note is required for the safety record.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-note">{noteAction?.status === "resolved" ? "Resolution note" : "Reason"}</Label>
            <Textarea
              id="event-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(false);
              }}
              rows={4}
              aria-invalid={noteError}
              autoFocus
            />
            {noteError ? <p className="text-caption text-danger">Enter a note before continuing.</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteAction(null)}>
              Cancel
            </Button>
            <Button onClick={submitNote} disabled={resolveAlert.isPending}>
              {noteAction?.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
