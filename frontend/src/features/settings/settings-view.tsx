"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Lock, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SectionCard } from "@/components/shared/section-card";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useSite } from "@/hooks/use-fleet-data";
import { ENGINE_TEMP } from "@/lib/thresholds";
import { FATIGUE } from "@/lib/thresholds";

const TIERS = [
  { key: "p1", label: "Critical", hint: "SOS, critical failures, zone breach by a person" },
  { key: "p2", label: "Warning", hint: "Delays, elevated temperature, high fatigue" },
  { key: "p3", label: "Info", hint: "Task completed, assigned to you, handover notes" },
] as const;
const CHANNELS = ["In-app", "Sound", "Email"] as const;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-body font-medium">{label}</p>
        {hint ? <p className="text-small text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Settings — spec §5.9. Theme applies live; other preferences are UI-only until the profile API exists. */
export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [clock, setClock] = useState<"24" | "12">("24");
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    "p1-In-app": true,
    "p1-Sound": true,
    "p1-Email": true,
    "p2-In-app": true,
    "p2-Sound": false,
    "p2-Email": false,
    "p3-In-app": true,
    "p3-Sound": false,
    "p3-Email": false,
  });
  const site = useSite();

  return (
    <PageContainer className="flex max-w-5xl flex-col gap-4">
      <PageHeader
        title="Settings"
        className="pb-1"
        description="Profile, display and notification preferences"
        actions={<Button onClick={() => toast.success("Preferences saved")}>Save changes</Button>}
      />

      <SectionCard title="Console">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signed-in">Signed in as</Label>
            <Input id="signed-in" value="No sign-in configured" readOnly disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site">Current site</Label>
            <Input id="site" value={site} readOnly disabled />
          </div>
        </div>
        <p className="mt-3 text-caption text-muted-foreground">
          There is no auth backend, so there is no profile to edit. Switch sites from the sidebar.
        </p>
      </SectionCard>

      <SectionCard title="Display" bodyClassName="divide-y">
        <Row label="Theme" hint="Dark is recommended for control rooms.">
          <SegmentedControl
            ariaLabel="Theme"
            value={(theme as "dark" | "light" | "system") ?? "dark"}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Dark", icon: Moon },
              { value: "light", label: "Light", icon: Sun },
              { value: "system", label: "System", icon: Monitor },
            ]}
          />
        </Row>
        <Row label="Units">
          <SegmentedControl
            ariaLabel="Units"
            value={units}
            onChange={setUnits}
            options={[
              { value: "metric", label: "Metric (km/h, °C)" },
              { value: "imperial", label: "Imperial (mph, °F)" },
            ]}
          />
        </Row>
        <Row label="Time format">
          <SegmentedControl
            ariaLabel="Time format"
            value={clock}
            onChange={setClock}
            options={[
              { value: "24", label: "24-hour" },
              { value: "12", label: "12-hour" },
            ]}
          />
        </Row>
      </SectionCard>

      <SectionCard title="Notifications" subtitle="Critical alerts always show in-app and can't be turned off" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b">
                <th className="eyebrow px-4 py-2 text-left">Tier</th>
                {CHANNELS.map((c) => (
                  <th key={c} className="eyebrow w-24 px-4 py-2 text-center">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {TIERS.map((t) => (
                <tr key={t.key}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{t.label}</p>
                    <p className="text-caption text-muted-foreground">{t.hint}</p>
                  </td>
                  {CHANNELS.map((c) => {
                    const k = `${t.key}-${c}`;
                    const locked = t.key === "p1" && c === "In-app";
                    return (
                      <td key={c} className="px-4 py-3 text-center">
                        <Switch
                          checked={prefs[k]}
                          disabled={locked}
                          onCheckedChange={(v) => setPrefs((p) => ({ ...p, [k]: v }))}
                          aria-label={`${t.label} via ${c}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Alert thresholds"
        subtitle="Applied to every machine and operator on every site"
        action={
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Lock className="size-3.5" /> Read-only
          </span>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <tbody className="divide-y">
              {[
                ["Engine temperature — elevated", `${ENGINE_TEMP.elevated} °C`],
                ["Engine temperature — critical", `${ENGINE_TEMP.critical} °C`],
                ["Operator fatigue — high", `${FATIGUE.high} / 100`],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="px-4 py-2 font-medium">{label}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2.5 text-caption text-muted-foreground">
          The backend has no per-model threshold table; these are the single set the UI applies.
        </p>
      </SectionCard>
    </PageContainer>
  );
}
