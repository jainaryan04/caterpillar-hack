"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import type { DateSelectArg, EventDropArg, EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { addMinutes } from "@/lib/format";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { Task } from "@/lib/types";
import { renderTaskEvent, type TaskEventProps } from "./task-event";

export type CalendarView = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "timeGridDay", label: "Day" },
  { value: "timeGridWeek", label: "Week" },
  { value: "dayGridMonth", label: "Month" },
];

interface TaskCalendarProps {
  tasks: Task[];
  lookup: EntityLookup;
  onSelectTask: (id: string) => void;
  onReschedule: (id: string, start: Date, durationMin: number, revert: () => void) => void;
  onCreateRange: (start: Date, durationMin: number) => void;
}

const HOUR_FORMAT = { hour: "2-digit", minute: "2-digit", hour12: false } as const;

/**
 * FullCalendar wrapper — spec §12. Day / Week / Month use the free plugins.
 * The per-machine resource timeline needs FullCalendar Premium (spec flag).
 */
export default function TaskCalendar({ tasks, lookup, onSelectTask, onReschedule, onCreateRange }: TaskCalendarProps) {
  const ref = useRef<FullCalendar>(null);
  const [view, setView] = useState<CalendarView>("timeGridDay");
  const [title, setTitle] = useState("");

  useEffect(() => {
    const api = ref.current?.getApi();
    if (api && api.view.type !== view) api.changeView(view);
  }, [view]);

  const events: EventInput[] = useMemo(
    () =>
      tasks
        .filter((t) => t.start)
        .map((t) => {
          const machine = lookup.machine(t.machineId);
          const props: TaskEventProps = {
            task: t,
            machineLabel: machine?.id,
            operatorName: lookup.operator(t.operatorId)?.name,
          };
          return {
            id: t.id,
            title: t.title,
            start: t.start!,
            end: addMinutes(t.start!, t.durationMin),
            classNames: [`task-status-${t.status}`],
            editable: t.status !== "completed" && t.status !== "cancelled",
            extendedProps: props,
          };
        }),
    [tasks, lookup],
  );

  const api = () => ref.current?.getApi();
  const minutesBetween = (a: Date, b: Date | null) => (b ? Math.round((b.getTime() - a.getTime()) / 60_000) : 60);

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => api()?.today()}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => api()?.prev()} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => api()?.next()} aria-label="Next">
            <ChevronRight />
          </Button>
        </div>
        <h2 className="text-h3 tabular-nums" aria-live="polite">
          {title}
        </h2>
        <SegmentedControl ariaLabel="Calendar view" value={view} onChange={setView} options={VIEWS} className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 p-2">
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={false}
          height="100%"
          firstDay={1}
          nowIndicator
          allDaySlot={false}
          scrollTime="05:30:00"
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          slotLabelFormat={HOUR_FORMAT}
          eventTimeFormat={HOUR_FORMAT}
          dayHeaderFormat={{ weekday: "short", day: "numeric" }}
          dayMaxEvents={3}
          slotEventOverlap={false}
          eventMaxStack={view === "timeGridWeek" ? 3 : 8}
          moreLinkClassNames="text-caption font-medium"
          editable
          selectable
          selectMirror
          snapDuration="00:15:00"
          events={events}
          eventContent={renderTaskEvent}
          eventClick={(info) => onSelectTask(info.event.id)}
          eventDrop={(info: EventDropArg) =>
            onReschedule(info.event.id, info.event.start!, minutesBetween(info.event.start!, info.event.end), info.revert)
          }
          eventResize={(info: EventResizeDoneArg) =>
            onReschedule(info.event.id, info.event.start!, minutesBetween(info.event.start!, info.event.end), info.revert)
          }
          select={(info: DateSelectArg) => {
            onCreateRange(info.start, info.allDay ? 120 : minutesBetween(info.start, info.end));
            api()?.unselect();
          }}
          datesSet={(arg) => setTitle(arg.view.title)}
        />
      </div>
    </div>
  );
}
