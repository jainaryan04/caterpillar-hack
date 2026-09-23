"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { severityMeta } from "@/lib/status";
import type { Severity, Zone } from "@/lib/types";

const KINDS = ["Near miss", "Injury", "Property damage", "Environmental", "Restricted zone breach"] as const;

/** Log a safety incident — spec §5.7. Not persisted until the safety API exists. */
export function IncidentFormDialog({ open, onOpenChange, zones }: { open: boolean; onOpenChange: (o: boolean) => void; zones: Zone[] }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("Near miss");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (!title.trim()) {
      setError(true);
      return;
    }
    toast.success("Incident logged", { description: `${kind} · ${title.trim()}` });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-h2">Log incident</DialogTitle>
          <DialogDescription>Record a near miss, injury, damage or environmental event for the safety log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="incident-title">Summary</Label>
            <Input
              id="incident-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(false);
              }}
              aria-invalid={error}
              placeholder="e.g. LV failed to yield at junction"
              autoFocus
            />
            {error ? <p className="text-caption text-danger">Enter a summary.</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as (typeof KINDS)[number])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(severityMeta) as Severity[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {severityMeta[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Location</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="incident-desc">What happened</Label>
            <Textarea id="incident-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Log incident</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
