"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Search } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_NAV_ITEMS } from "@/config/nav";
import { useMachines, useOperators, useTasks } from "@/hooks/use-fleet-data";
import { useUiStore } from "@/stores/ui-store";
import { MachineIcon } from "@/components/shared/machine-icon";

/** Trigger styled as a search field — opens the ⌘K palette. */
export function CommandSearchTrigger() {
  const setOpen = useUiStore((s) => s.setCommandOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 items-center gap-2 rounded-md border bg-inset px-2.5 text-small text-muted-foreground hover:border-border-strong md:w-72"
      aria-label="Search machines, operators, tasks"
    >
      <Search className="size-4 shrink-0" />
      <span className="hidden flex-1 truncate text-left whitespace-nowrap md:inline">Search machines, operators, tasks…</span>
      <kbd className="hidden rounded-sm border bg-panel px-1.5 font-mono text-[10px] md:inline">⌘K</kbd>
    </button>
  );
}

/** Global search — spec §1.3. Navigates to list pages with the entity drawer open. */
export function CommandSearch() {
  const router = useRouter();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const { data: machines } = useMachines();
  const { data: operators } = useOperators();
  const { data: tasks } = useTasks();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Find machines, operators, tasks and pages"
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput placeholder="Search by ID or name…" />
        <CommandList className="max-h-[60dvh]">
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Pages">
            {ALL_NAV_ITEMS.map((item) => (
              <CommandItem key={item.href} value={`page ${item.title}`} onSelect={() => go(item.href)}>
                <item.icon /> {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Machines">
            {machines?.map((m) => (
              <CommandItem key={m.id} value={`${m.id} ${m.model}`} onSelect={() => go(`/machines?machine=${m.id}`)}>
                <MachineIcon type={m.type} />
                <span className="font-mono">{m.id}</span>
                <span className="text-muted-foreground">{m.model}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Operators">
            {operators?.map((o) => (
              <CommandItem key={o.id} value={`${o.id} ${o.name}`} onSelect={() => go(`/operators?operator=${o.id}`)}>
                <span className="flex size-4 items-center justify-center text-[9px] font-semibold">{o.initials}</span>
                {o.name}
                <CommandShortcut className="font-mono">{o.id}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Tasks">
            {tasks?.map((t) => (
              <CommandItem key={t.id} value={`${t.id} ${t.title}`} onSelect={() => go(`/tasks?task=${t.id}`)}>
                <CalendarClock />
                <span className="font-mono">{t.id}</span>
                <span className="truncate text-muted-foreground">{t.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
