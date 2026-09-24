import type { EventContentArg } from "@fullcalendar/core";
import { complexityLevel, taskTypeLabel } from "@/lib/status";
import type { Task, TaskType } from "@/lib/types";

export interface TaskEventProps {
  task: Task;
  machineLabel?: string;
  operatorName?: string;
}

/** Short mono type codes — type reads without color (spec §12). */
const TYPE_CODE: Record<TaskType, string> = {
  excavation: "EXC",
  hauling: "HAU",
  loading: "LOD",
  grading: "GRD",
  dozing: "DOZ",
  drilling: "DRL",
  inspection: "INS",
  maintenance: "MNT",
};

function el(tag: string, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function typeCode(type: TaskType) {
  const node = el("span", "shrink-0 rounded-[2px] bg-inset px-1 font-mono text-[10px] leading-4 text-foreground-secondary", TYPE_CODE[type]);
  node.title = taskTypeLabel[type];
  return node;
}

function pips(level: number) {
  const wrap = el("span", "ml-auto inline-flex shrink-0 items-center gap-0.5");
  wrap.setAttribute("aria-label", `Complexity ${level} of 3`);
  for (let i = 1; i <= 3; i++) {
    wrap.append(el("span", `size-1.5 rounded-full ${i <= level ? "bg-foreground-secondary" : "bg-raised"}`));
  }
  return wrap;
}

/**
 * Calendar event body — spec §12. Status is the left rail (CSS class on the
 * event); task type is a code chip, so the two never compete for color.
 * Content drops out as the event gets shorter.
 *
 * Built as DOM nodes rather than JSX: FullCalendar v6's React adapter calls
 * flushSync for JSX content, which React 19 warns about on every render.
 */
export function renderTaskEvent(arg: EventContentArg) {
  const { task, machineLabel, operatorName } = arg.event.extendedProps as TaskEventProps;
  const minutes = task.durationMin;
  const view = arg.view.type;

  if (view === "dayGridMonth") {
    const row = el("div", "flex min-w-0 items-center gap-1 px-1 text-caption");
    row.append(typeCode(task.type), el("span", "font-mono text-muted-foreground", arg.timeText), el("span", "task-event-title truncate", task.title));
    return { domNodes: [row] };
  }

  const root = el("div", "flex h-full min-w-0 flex-col gap-0.5 overflow-hidden px-1.5 py-1 text-caption leading-tight");
  const head = el("div", "flex min-w-0 items-center gap-1");
  head.append(typeCode(task.type));

  if (view === "timeGridWeek") {
    // Narrow columns: code + title, machine underneath when there's room.
    head.append(el("span", "task-event-title truncate font-medium", task.title));
    root.append(head);
    if (minutes >= 90 && machineLabel) root.append(el("span", "truncate font-mono text-muted-foreground", machineLabel));
    return { domNodes: [root] };
  }

  head.append(el("span", "font-mono font-medium whitespace-nowrap", task.id));
  if (minutes >= 60) head.append(pips(complexityLevel[task.complexity]));
  root.append(head);
  if (minutes >= 45) root.append(el("div", "task-event-title truncate font-medium", task.title));
  if (minutes >= 90) {
    const meta = [machineLabel, operatorName].filter(Boolean).join(" · ");
    if (meta) root.append(el("div", "truncate text-muted-foreground", meta));
  }
  return { domNodes: [root] };
}
