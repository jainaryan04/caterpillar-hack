# Cat Fleet Operations Center — Product Design Specification

**Status:** Draft v1 for design review
**Platform:** Desktop web (Next.js 15, App Router). Tablet and phone support is secondary; see §6.
**Stack:** TypeScript · TailwindCSS · shadcn/ui · Google Maps · Socket.IO · Recharts · FullCalendar · react-pdf · existing AI endpoint

---

## 0. Design principles

These principles decide ties. When two options both seem fine, pick the one that fits these better.

1. **Exceptions first.** Operations staff watch for what has gone wrong. Every screen puts SOS, failures, delays and threshold breaches above normal data. When things are normal, the screen stays calm.
2. **Status is never shown by color alone.** Every status has an icon, a text label and a color. People read these screens in bright sun, on old monitors and with color-vision deficiencies.
3. **Yellow means "act here", not "warning".** CAT Yellow `#FFCD11` and Warning Amber `#F59E0B` look alike on dark backgrounds. So yellow is only for brand accents, primary actions, the active navigation item and hero KPI values. It is **never** used for status. (§9.4 explains this.)
4. **Live data shows how old it is.** Every live value either updates or visibly goes stale. The UI never shows an old number as if it were current.
5. **One click from overview to detail.** Every count, marker, chart point and row links to the records behind it.
6. **Dense, not cramped.** Use tabular numbers, tight vertical rhythm and no decoration. Leave space between groups, not inside them.
7. **No new vocabulary.** Use the words sites already use: *machine* (not asset), *operator*, *task*, *shift*, *site*, *zone*.

---

## 1. Information architecture

### 1.1 Core entities and how they relate

```
Site ──< Zone (work area | restricted | muster point)
 │
 ├──< Machine ──── current Operator (0..1)
 │       │  └──── current Task (0..1)
 │       └──< Telemetry sample (location, velocity, engine temp, runtime, fuel)
 │
 ├──< Operator ──── Shift (current)
 │       └──< Task (assigned)
 │
 ├──< Task ── type, complexity, duration, status, machine, operator, schedule
 │
 └──< Event
        ├── SOS / assistance request   (from operator)
        ├── Machine failure            (from telemetry / fault code)
        └── Safety incident            (logged by a person)

Manual (PDF) ──< Chat session ──< Message ──< Source citation (page, excerpt)
```

The **Event** is the shared object for Safety & SOS, notifications, map SOS markers and the Dashboard SOS KPI. Every event has a severity, a status (`open → acknowledged → responding → resolved`), an owner and a timeline.

### 1.2 Roles and what each needs

| Module | Operations Manager | Site Supervisor | Equipment Operator | Safety Officer |
|---|---|---|---|---|
| Dashboard | Full, all sites | Full, own site | Personal view (my tasks, my machine) | Safety-weighted variant |
| Task Scheduling | View + edit all | **Primary tool**: create, assign, reschedule | View own tasks, mark complete | View only |
| Operators | Full | Full, own crew | Own profile only | View fatigue + shift |
| Machines | Full | Full | Assigned machine only | View + failure history |
| Live Map | Full | Full | Own position + zones | **Primary tool** |
| AI Manual Assistant | Yes | Yes | **Primary tool** | Yes |
| Safety & SOS | View + escalate | Acknowledge + respond | Raise SOS, see own requests | **Primary tool**: triage, log incidents |
| Analytics | **Primary tool** | Own site | Hidden | Safety analytics |

Sidebar items the current role cannot use are **hidden**, not disabled. Actions a role cannot take inside a visible page are disabled with a tooltip explaining why ("Only supervisors can reassign tasks").

Operators in the field are expected to use the separate Expo app. This spec covers their web view only as a light, read-mostly experience.

### 1.3 Global objects every page can reach

- **Site switcher**: which site's data is shown. Managers can choose "All sites".
- **Global search (⌘K)**: find machines, operators, tasks and manuals by ID or name.
- **Notification center**: all events, filterable.
- **Live connection status**: Socket.IO health.
- **Active SOS banner**: always visible while any SOS is unacknowledged.

---

## 2. Sidebar structure

Width 240px expanded, 64px collapsed (icons only, with tooltips). The collapsed state is remembered per user in local storage. Collapsed is the default below 1440px wide.

```
┌──────────────────────────┐
│ ▣ CAT  Fleet Ops         │  ← wordmark; yellow square mark only
│ [Site: Pit 3 North   ▾]  │  ← site switcher
├──────────────────────────┤
│ OPERATIONS               │  ← group label, 11px, uppercase, muted
│ ▸ Dashboard              │
│ ▸ Live Map               │
│ ▸ Safety & SOS      (2)  │  ← red count badge = open SOS
├──────────────────────────┤
│ PLANNING                 │
│ ▸ Task Scheduling   (5)  │  ← amber count = delayed tasks
├──────────────────────────┤
│ FLEET                    │
│ ▸ Machines               │
│ ▸ Operators              │
├──────────────────────────┤
│ INSIGHTS                 │
│ ▸ Analytics              │
│ ▸ Manual Assistant       │
├──────────────────────────┤
│ (spacer)                 │
│ ● Live · 42ms            │  ← connection status
│ ⚙ Settings               │
│ [AJ] Aryan J · Supervisor│  ← user menu: role, profile, sign out
│ «  Collapse              │
└──────────────────────────┘
```

**Order:** Items follow how urgent they usually are. Live Map comes straight after Dashboard because it is the second most-used screen in a control room. Safety comes next because it is the most time-critical.

**Active item:** 3px yellow bar on the left edge, white label on `surface-raised`. The rest of the row is not yellow, so the sidebar never reads as a yellow block.

**Badges:** Only two items get count badges: Safety (red, open SOS) and Scheduling (amber, delayed tasks). More badges would stop people noticing them.

---

## 3. Page hierarchy

```
Fleet Ops
├── Dashboard
├── Live Map
│   └── (entity drawer: machine | operator | zone | SOS)
├── Safety & SOS
│   ├── Active board (default)
│   ├── Incident log
│   └── Event detail
├── Task Scheduling
│   ├── Calendar (Day | Week | Month | Machine timeline)
│   ├── Task list (table alternative)
│   └── Task detail / edit (side sheet)
├── Machines
│   ├── Fleet table / grid
│   └── Machine detail
│       ├── Overview (live telemetry)
│       ├── Tasks
│       ├── Faults & maintenance
│       └── Manuals (links to Assistant with this model's manual preloaded)
├── Operators
│   ├── Roster table
│   └── Operator detail
│       ├── Overview (shift, fatigue)
│       ├── Tasks
│       └── Certifications
├── Analytics
│   ├── Productivity
│   ├── Utilization
│   ├── Completion
│   └── Durations
├── Manual Assistant
│   ├── Manual library
│   └── Manual session (PDF + chat)
├── Notifications (full page)
└── Settings (profile, units, thresholds, notification preferences)
```

Detail pages are real routes, so they can be deep-linked and shared in handovers. Quick-look **side sheets** open on top of lists for fast checks without losing your place.

---

## 4. Route structure (Next.js App Router)

```
app/
├── (auth)/
│   └── login/                         /login
├── (ops)/                             ← shared AppShell layout
│   ├── dashboard/                     /dashboard
│   ├── map/                           /map?layers=machines,sos&focus=MCH-042
│   ├── safety/                        /safety
│   │   ├── incidents/                 /safety/incidents
│   │   └── [eventId]/                 /safety/EVT-1182
│   ├── schedule/                      /schedule?view=week&date=2026-09-23
│   │   └── list/                      /schedule/list
│   ├── machines/                      /machines?status=fault
│   │   └── [machineId]/               /machines/MCH-042
│   │       ├── tasks/
│   │       ├── faults/
│   │       └── manuals/
│   ├── operators/                     /operators
│   │   └── [operatorId]/              /operators/OP-017
│   │       ├── tasks/
│   │       └── certifications/
│   ├── analytics/                     /analytics → redirects to /analytics/productivity
│   │   ├── productivity/
│   │   ├── utilization/
│   │   ├── completion/
│   │   └── durations/
│   ├── assistant/                     /assistant  (manual library)
│   │   └── [manualId]/                /assistant/cat-336-om?page=112&session=abc
│   ├── notifications/                 /notifications
│   └── settings/                      /settings
└── page.tsx                           / → redirect to /dashboard
```

**URL state rules:** Filters, the selected calendar view and date, map layers and focus, the analytics date range and the open PDF page all live in the query string. The back button always works, and any screen can be pasted into a handover message. Side sheets use `?sheet=task:TSK-2231` so they can be linked too.

**Site scope** is stored in a cookie, not the path. That keeps URLs short, and "All sites" does not need a special route.

---

## 5. Page wireframes

Every page sits in the AppShell:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [SOS BANNER — only while an SOS is unacknowledged]                     │ 40px
├──────────┬─────────────────────────────────────────────────────────────┤
│          │ TopBar: Breadcrumb · Page title    ⌘K Search  🔔  ● Live  AJ│ 56px
│ Sidebar  ├─────────────────────────────────────────────────────────────┤
│ 240/64   │ PageHeader: title · subtitle/last-updated · [page actions]  │
│          ├─────────────────────────────────────────────────────────────┤
│          │ Content (12-col grid, 24px gutters, 24px page padding)      │
│          │                                                             │
└──────────┴─────────────────────────────────────────────────────────────┘
```

---

### 5.1 Dashboard

**Purpose:** Answer "Is my operation healthy right now, and what needs me?" within 5 seconds.

**Layout:**

```
┌────────────────────────────────────────────────────────────────────────┐
│ Operations Overview · Pit 3 North · Day shift 06:00–18:00  [Shift ▾]   │
├───────────┬───────────┬───────────┬───────────┬───────────┬────────────┤
│ ACTIVE    │ ACTIVE    │ TASKS IN  │ DELAYED   │ SOS       │ FLEET      │
│ MACHINES  │ OPERATORS │ PROGRESS  │ TASKS     │ ALERTS    │ UTILIZATION│
│ 38 / 45   │ 41 / 48   │ 27        │ ▲ 5       │ ● 2       │ 78%        │
│ ▁▂▃▅▆▇▇   │ ▁▂▄▅▆▆▇   │ ▃▄▅▅▄▅▆   │ amber     │ red, pulse│ ▅▆▆▇▇▆▇    │
├───────────┴───────────┴───────────┴──┬────────┴───────────┴────────────┤
│ ATTENTION QUEUE                     │ LIVE MAP (mini)                  │
│ ● SOS  OP-017 · Zone B · 2m  [Ack]  │  ┌────────────────────────────┐  │
│ ▲ MCH-042 engine 108°C · 4m  [View] │  │  markers, SOS pulses       │  │
│ ▲ TSK-2231 delayed 40m      [Resch.]│  └────────────────────────────┘  │
│ ◆ OP-022 fatigue 74        [View]   │                  [Open map →]    │
│ ...                     [View all →]│                                  │
├─────────────────────────────────────┼──────────────────────────────────┤
│ TASK PROGRESS — TODAY               │ FLEET STATUS                     │
│ Gantt-lite by machine, 06:00→18:00  │ Operating 31 · Idle 7 · Fault 2  │
│ now-line; delayed bars amber        │ · Maintenance 3 · Offline 2      │
│                                     │ stacked bar + per-type breakdown │
├─────────────────────────────────────┴──────────────────────────────────┤
│ UTILIZATION — LAST 12 HOURS (area chart, target line at 75%)           │
└────────────────────────────────────────────────────────────────────────┘
```

**Sections and components**

| Section | Components | Notes |
|---|---|---|
| Page header | `PageHeader`, `ShiftSelector`, `LastUpdated` | Shift selector: Current / Previous / custom |
| KPI row | 6 × `KpiTile` (§15) | 2-col span each on 12-col grid |
| Attention queue | `AttentionQueue` → `AttentionItem` | Sorted by severity, then age. Shows 6 items, then "View all" |
| Mini map | `FleetMap` (compact mode) | No controls except zoom; click → `/map` |
| Task progress | `ShiftTimeline` (custom SVG/Recharts) | One row per active machine; bars per task |
| Fleet status | `StatusDistributionBar`, `StatusLegend` | Segments are clickable filters |
| Utilization | `TrendChart` (Recharts `AreaChart`) | Target reference line |

**Interactions**
- Clicking a KPI tile opens a pre-filtered list. *Delayed tasks* opens `/schedule/list?status=delayed`. *SOS* opens `/safety`.
- The attention queue has **inline actions**: Acknowledge (SOS), Reschedule (task, opens the side sheet) and View (machine or operator side sheet). Items leave the queue with a 200ms collapse once resolved.
- Hovering over a map marker highlights the matching row in the attention queue, and the other way round.
- **Role variants.** *Safety Officer:* the KPI row swaps Tasks In Progress for Open Incidents, and the queue is filtered to safety events. *Operator:* "My shift" card, "My tasks today", "My machine" telemetry and a big **Request assistance** button.
- **Stretch goal, wall mode.** `/dashboard?wall=1` hides the chrome, scales type up 1.25× and refreshes forever. It's for control-room TVs.

---

### 5.2 Task Scheduling

**Purpose:** Plan, assign and adjust work across machines and operators, and see conflicts before they happen.

**Layout:**

```
┌────────────────────────────────────────────────────────────────────────┐
│ Task Scheduling   [‹ Today ›] Sep 23, 2026   [Day|Week|Month|Machines] │
│                                        [Filters ▾]  [List ⇄]  [+ Task] │
├──────────────┬─────────────────────────────────────────────────────────┤
│ UNSCHEDULED  │  CALENDAR (FullCalendar)                                │
│ (12)         │                                                         │
│ ┌──────────┐ │   06:00 ┃ ┌─Excavation──────┐                           │
│ │TSK-2240  │ │   07:00 ┃ │MCH-042 · OP-017 │ ┌─Haul───────┐            │
│ │Haul · M  │ │   08:00 ┃ └─────────────────┘ │MCH-051     │            │
│ │est 2h    │ │   ──now─╋─────────────────────┼────────────┼──── red line│
│ └──────────┘ │   10:00 ┃                     └────────────┘            │
│  drag onto   │                                                         │
│  calendar →  │                                                         │
├──────────────┤                                                         │
│ LEGEND       │                                                         │
│ status / type│                                                         │
└──────────────┴─────────────────────────────────────────────────────────┘
```

**Sections**
1. **Toolbar:** date navigation, view switcher (`SegmentedControl`), filters (type, complexity, status, operator, machine), a List/Calendar toggle and the primary **+ Task** button, which is yellow.
2. **Unscheduled tray** (left, 280px, collapsible): draggable task cards not yet on the calendar. FullCalendar `Draggable` external events.
3. **Calendar:** see §12.
4. **Task side sheet** (right, 480px): create, edit or view.

**Components:** `ScheduleToolbar`, `ViewSwitcher`, `TaskFilterPopover`, `UnscheduledTray`, `TaskCard`, `ScheduleCalendar` (FullCalendar wrapper), `TaskEvent` (custom event content), `TaskSheet`, `TaskForm`, `ConflictBanner`, `StatusBadge`, `ComplexityPips`.

**Task form fields** (in this order in `TaskForm`)

| Field | Control | Rules |
|---|---|---|
| Title | Text input | Required |
| Task type | Select with icon (Excavation, Hauling, Loading, Grading, Dozing, Inspection, Maintenance) | Required. Type narrows which machines can be picked |
| Complexity | 3-option segmented: Low / Medium / High, shown as 1–3 pips | High complexity limits operators to those certified for it |
| Machine | Combobox with status dot + model | Shows "Busy 08:00–10:00" inline if conflicting |
| Operator | Combobox with availability + fatigue | Warns if fatigue ≥ 70 or shift ends before task ends |
| Start / Duration | Date-time + duration stepper (15-min steps) | End time is calculated and shown, not typed |
| Status | Select: Scheduled, In progress, Paused, Delayed, Completed, Cancelled | Delayed is normally set by the system, but can be set manually |
| Site / Zone | Select | Warns if the zone is restricted during that window |
| Notes | Textarea | Optional |

**Interactions**
- **Create:** use **+ Task**, drag across empty calendar time (pre-fills start and duration), or drag from the tray.
- **Edit:** click an event to open the side sheet in view mode, then **Edit**.
- **Reschedule:** drag to move, drag an edge to resize. On drop, the system checks for conflicts. If there is one, the event snaps back and a `ConflictBanner` explains it ("MCH-042 is assigned to TSK-2201 until 10:30") with **Swap**, **Assign anyway** and **Cancel**. Without a conflict, a toast says "Rescheduled · Undo" (8s).
- **Mark complete:** a checkbox button on the event's hover card, a **Mark complete** button in the sheet, or a bulk action in list view. It asks for actual duration (pre-filled) so Analytics gets real data.
- **Keyboard:** `N` new task, `T` today, `D/W/M` views, `←/→` move through dates, `Esc` close the sheet.

---

### 5.3 Operators

**Purpose:** Know who is working, who is available, and who is at risk from fatigue, before assigning work.

**List layout:**

```
┌────────────────────────────────────────────────────────────────────────┐
│ Operators · 48      [Search]  [Shift ▾] [Availability ▾] [Fatigue ▾]    │
├────────────────┬────────────────┬────────────────┬─────────────────────┤
│ ON SHIFT  41   │ AVAILABLE  9   │ HIGH FATIGUE 3 │ OFF / LEAVE  7      │ ← summary strip; clicking filters
├────────────────┴────────────────┴────────────────┴─────────────────────┤
│ □ Operator         Shift          Hours   Fatigue     Tasks  Avail.  ⋯ │
│ □ [JM] J. Moreno   Day 06–18      7.5/12  ▮▮▮▯▯ 34     3     ● On task │
│      OP-017        ████████░░░░                              MCH-042   │
│ □ [RK] R. Kaur     Day 06–18     10.2/12  ▮▮▮▮▯ 74 ◆   2     ● Avail.  │
│ ...                                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

**Sections:** summary strip, filter bar, `DataTable` (§11), optional grid view of `OperatorCard`s (toggle).

**Columns:** Operator (avatar, name, ID), Current shift (name + window + progress bar showing how far through it they are), Hours worked (today / planned, with a 7-day total in the tooltip), Fatigue score (§5.3.1), Assigned tasks (count; hover lists them), Availability (`StatusBadge`: On task · Available · On break · Off shift · Leave), Current machine.

**5.3.1 Fatigue score display.** A 0–100 score with three bands: 0–39 Normal (green), 40–69 Elevated (amber), 70–100 High (red with a ◆ icon). It is shown as a 5-segment bar plus the number, not as a gauge. Gauges waste space in tables and are harder to compare down a column. The tooltip explains what drives the score: "Hours this shift: 10.2 · Consecutive shifts: 5 · Night shifts this week: 2".

**Detail page `/operators/[id]`:** a header card (photo or initials, name, ID, role, certifications as chips, current status), then tabs.
- *Overview:* shift timeline (today's tasks on a horizontal bar), 14-day fatigue trend chart, hours this week against the legal or site limit, current machine card.
- *Tasks:* table of past and upcoming tasks.
- *Certifications:* machine types they may operate, with expiry dates. Anything expiring within 30 days is amber.

**Interactions:** row click opens the quick-look side sheet, and **Open full profile** goes to the detail page. There is an **Assign task** action (opens `TaskSheet` with this operator pre-filled). Bulk action: *Message selected* (stretch goal).

---

### 5.4 Machines

**Purpose:** See the live condition of every machine and find the ones that need attention.

**List layout:** summary strip (Operating · Idle · Fault · Maintenance · Offline), filter bar (type, status, site), and a **Table ⇄ Grid** toggle. Table is the default for managers. Grid suits supervisors scanning a smaller fleet.

**Table columns:** Machine (type silhouette icon, ID, model, e.g. "MCH-042 · Cat 336 Excavator"), Status, Runtime (engine hours today / lifetime), Velocity (km/h, live), Engine temp (°C, live, color by threshold), Current operator, Current task, Last seen.

**Grid card (`MachineCard`):**

```
┌────────────────────────────────────┐
│ [excavator icon] MCH-042    ● Oper.│
│ Cat 336 Excavator                  │
├────────────────────────────────────┤
│ VELOCITY   ENGINE TEMP   RUNTIME   │
│ 6.2 km/h   ▲ 104 °C      5h 12m    │
│            amber                   │
├────────────────────────────────────┤
│ [JM] J. Moreno · TSK-2231 Excav.   │
│ Updated 3s ago                     │
└────────────────────────────────────┘
```

**Detail page `/machines/[id]`**

```
┌───────────────────────────────────────────────────────────────────────┐
│ ← Machines   MCH-042 · Cat 336 Excavator   ● Operating   [⋯ Actions]  │
├──────────────────────────┬────────────────────────────────────────────┤
│ LIVE TELEMETRY           │ LOCATION (mini map, centered on machine)   │
│ ┌──────┐┌──────┐┌──────┐ │                                            │
│ │VELOC.││ENG.  ││RUNTIM│ │                                            │
│ │6.2   ││104°C ││5h12m │ │                                            │
│ └──────┘└──────┘└──────┘ │                                            │
│ Engine temp — last 2h    │                                            │
│ line chart, threshold    │                                            │
│ bands at 95 / 105        │                                            │
├──────────────────────────┴────────────────────────────────────────────┤
│ Tabs: Overview | Tasks | Faults & Maintenance | Manuals               │
│ Current operator card · Current task card · Recent events list        │
└───────────────────────────────────────────────────────────────────────┘
```

**Thresholds** can be set per machine model in Settings. Defaults (placeholder values; they must be checked against the equipment specs): engine temp normal < 95°C, elevated 95–105°C, critical > 105°C. When a value crosses a threshold, it changes color **and** gets an icon (▲ elevated, ◆ critical). A critical value also creates an Event (§16).

**Interactions:** row click opens the side sheet, and a double-click or **Open** goes to detail. **Locate on map** goes to `/map?focus=MCH-042`. **Open manual** goes to `/assistant/[manual for this model]`. Actions menu: Mark for maintenance, Report fault, Reassign operator.

---

### 5.5 Live Map

**Purpose:** Spatial awareness: where everything is, what is near danger, and where help is needed.

**Layout (full-bleed; the page padding is removed):**

```
┌────────────────────────────────────────────────────────────────────────┐
│┌───────────────┐                                     ┌───────────────┐ │
││ ENTITY LIST   │                                     │ LAYERS        │ │
││ [Search]      │                                     │ ☑ Machines 45 │ │
││ Tabs: Machines│          GOOGLE MAP                 │ ☑ Operators 48│ │
││ Operators|SOS │          (dark styled)              │ ☑ Work sites  │ │
││ ● MCH-042     │                                     │ ☑ Restricted  │ │
││ ● MCH-051     │     ◉ SOS pulse                     │ ☑ SOS      2  │ │
││ ...           │                                     │ ☐ Trails 15m  │ │
│└───────────────┘                                     └───────────────┘ │
│                                                   ┌──────────────────┐ │
│  [+][−] [⌖ Fit all] [🛰 Satellite]                 │ ENTITY DRAWER    │ │
│                                                   │ (on selection)   │ │
│  Legend ▾   ● Live · updated 1s ago               └──────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

See §13 for the map design itself.

**Components:** `FleetMap`, `MachineMarker`, `OperatorMarker`, `SosMarker`, `ZonePolygon`, `MarkerClusterer`, `LayerPanel`, `EntityListPanel`, `EntityDrawer` (machine, operator, zone and SOS variants), `MapLegend`, `MapToolbar`.

**Interactions**
- Clicking a marker selects it: the map pans to it, the drawer opens, and the entity is highlighted in the list. Clicking a list item does the same the other way.
- **Follow mode:** in the machine drawer, **Follow** keeps the map centered on the machine as it moves.
- **SOS drawer:** Acknowledge, Assign responder (lists the nearest available people by distance), Call, Open event.
- **Zone breach:** when a machine or operator enters a restricted zone, the zone flashes its border twice, a warning event is created, and the entity gets a red outline until it leaves.
- The entity panels collapse to icons for a clear view. `F` toggles the map to full screen.

---

### 5.6 AI Manual Assistant

**Purpose:** Get trustworthy answers from official equipment manuals, and always be able to check the source page.

**Library `/assistant`:** a grid of manual cards (cover thumbnail, model, document type such as Operation & Maintenance or Parts or Safety, page count, last opened), filters by machine type, and search. A **Continue** strip shows recent sessions at the top.

**Session `/assistant/[manualId]`:** see §14 for the full design.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← Manuals  Cat 336 Operation & Maintenance Manual    [Switch manual ▾] │
├────────────────────────────────────┬───────────────────────────────────┤
│ PDF VIEWER (react-pdf)       55%   │ CHAT                        45%   │
│ [≡ Outline] [‹ 112/486 ›] [− 100% +]│ ┌───────────────────────────────┐│
│ ┌────────────────────────────────┐ │ │ You: What's the hydraulic oil ││
│ │                                │ │ │ change interval?              ││
│ │  page render                   │ │ ├───────────────────────────────┤│
│ │  ▇▇▇ highlighted passage ▇▇▇   │ │ │ AI: Every 3000 service hours  ││
│ │                                │ │ │ [1] … or 6 months [2].        ││
│ │                                │ │ │ ┌ Sources ─────────────────┐  ││
│ └────────────────────────────────┘ │ │ │[1] p.112 Maint. Interval…│  ││
│ thumbnails strip (toggle)          │ │ │[2] p.114 Hydraulic Sys…  │  ││
│                                    │ │ └──────────────────────────┘  ││
│                                    │ └───────────────────────────────┘│
│                                    │ Suggested: [Daily checks] [Torque]│
│                                    │ [Ask about this manual…     ] [➤] │
└────────────────────────────────────┴───────────────────────────────────┘
```

**Components:** `ManualLibrary`, `ManualCard`, `ManualSession`, `ResizableSplit` (shadcn Resizable), `PdfViewer`, `PdfToolbar`, `PdfOutline`, `PdfThumbnails`, `ChatPanel`, `ChatMessage`, `CitationChip`, `SourceList`, `SuggestedPrompts`, `ChatComposer`.

**Interactions:** ask a question, get a streamed answer with inline citation chips `[1]`, and click a chip to jump to that page and highlight the passage. Hovering a chip shows a preview (page number, section title, excerpt). The divider can be dragged (35–65% range). Selecting text in the PDF shows an **Ask about selection** popover that puts the quote into the composer.

---

### 5.7 Safety & SOS

**Purpose:** Respond to emergencies quickly and keep a complete safety record.

**Active board `/safety` (default):**

```
┌────────────────────────────────────────────────────────────────────────┐
│ Safety & SOS    [Active | Incident log]           [+ Log incident]     │
├──────────────────┬──────────────────┬──────────────────┬───────────────┤
│ ● ACTIVE         │ ASSISTANCE       │ MACHINE FAILURES │ INCIDENTS     │
│ EMERGENCIES  2   │ REQUESTS  3      │ 1                │ (24h)  4      │
├──────────────────┴──────────────────┴──────────────────┴───────────────┤
│ OPEN EVENTS (sorted by severity, then age)       │ SELECTED EVENT      │
│ ┌──────────────────────────────────────────────┐ │ ┌─────────────────┐ │
│ │▌● SOS · Man down         OP-017 · Zone B     │ │ │ mini map        │ │
│ │▌  02:14 elapsed · UNACKNOWLEDGED  [Ack][Map] │ │ ├─────────────────┤ │
│ ├──────────────────────────────────────────────┤ │ │ Timeline        │ │
│ │▌▲ Assistance · Flat tire  OP-031 · Haul Rd 2 │ │ │ 09:41 raised    │ │
│ │▌  ACK by R.Kaur · RESPONDING    [View]       │ │ │ 09:42 ack'd ... │ │
│ ├──────────────────────────────────────────────┤ │ ├─────────────────┤ │
│ │▌◆ Failure · Hydraulic loss  MCH-051          │ │ │ Responders      │ │
│ └──────────────────────────────────────────────┘ │ │ Actions / notes │ │
│                                                  │ └─────────────────┘ │
└──────────────────────────────────────────────────┴─────────────────────┘
```

**Event categories:** Active emergency (SOS, man down, fire, collision), Worker assistance request (non-emergency help), Machine failure event (from telemetry fault codes), Safety incident (logged: near miss, injury, property damage, environmental).

**Severity:** Critical (red, ●, pulses while unacknowledged), High (red, ◆, no pulse), Medium (amber, ▲), Low (blue, ℹ).

**Event lifecycle:** `Open → Acknowledged → Responding → Resolved`, plus `Escalated` (goes to the manager). Each status change adds a timeline entry with who and when. **Resolve** requires a resolution note.

**Components:** `EventSummaryStrip`, `EventQueue`, `EventRow` (colored left rail), `EventDetailPanel`, `EventTimeline`, `ResponderPicker`, `IncidentForm` (sheet), `IncidentLogTable`.

**Interactions:** Acknowledge is a single click, with no confirmation, because speed matters. Resolve and Escalate open a small dialog for the note. *Incident log* is a `DataTable` with a date range, type and severity filters, and CSV export. New critical events jump to the top of the queue with a 1-second highlight; the list never reorders while the user is hovering over it.

---

### 5.8 Analytics

**Purpose:** Understand trends and make planning decisions: which fleet is underused, which tasks overrun, and how productivity is moving.

**Layout:** tabbed sub-routes (Productivity · Utilization · Completion · Durations) sharing one filter bar: date range (preset chips for Today, 7d, 30d, Quarter, plus custom), site, machine type, and a "compare to previous period" toggle.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Analytics  [Productivity|Utilization|Completion|Durations]             │
│ [Last 30 days ▾] [Site ▾] [Machine type ▾] [☐ Compare]  [Export ▾]     │
├───────────┬───────────┬───────────┬────────────────────────────────────┤
│ HEADLINE  │ HEADLINE  │ HEADLINE  │ HEADLINE     ← 4 KPI tiles w/ delta │
├───────────┴───────────┴───────────┴────────────────────────────────────┤
│ PRIMARY CHART (8 col)                        │ BREAKDOWN (4 col)       │
│                                              │ ranked bar list         │
├──────────────────────────────────────────────┴─────────────────────────┤
│ DETAIL TABLE (sortable, exportable)                                    │
└────────────────────────────────────────────────────────────────────────┘
```

| Tab | Headline KPIs | Primary chart | Breakdown | Table |
|---|---|---|---|---|
| Productivity | Tasks completed, Volume moved (if known), Tasks per operator-hour, Productive hours | Line: tasks completed per day (with compare line dashed) | By task type | Per operator |
| Utilization | Fleet utilization %, Idle hours, Fault downtime, Available hours | Stacked area: Operating / Idle / Fault / Maintenance hours per day | By machine type; lowest 10 machines | Per machine |
| Completion | Completion rate, On-time rate, Delayed count, Cancelled count | Stacked bar: On-time / Late / Cancelled per day | By complexity | Delayed tasks with reasons |
| Durations | Median duration, P90 duration, Planned-vs-actual variance, Overruns | Box-plot-style range bars per task type (Recharts composed: min–P90 bar + median tick) | By complexity | Per task |

**Metric definitions** (shown in an ⓘ tooltip on every KPI so numbers are not misread):
- *Fleet utilization* = engine-on productive hours ÷ scheduled available hours.
- *On-time rate* = tasks finished at or before planned end ÷ tasks completed.
- *Variance* = (actual − planned) ÷ planned.

**Interactions:** hovering a chart shows a synced crosshair across all charts on the tab. Clicking a bar or point filters the detail table to that slice (a dismissible chip shows the active slice). Export offers CSV for tables and PNG for charts.

---

### 5.9 Notifications (full page) and Settings

- **Notifications:** a filterable list of every notification (§16), grouped by day, with bulk mark-read and a filter by category and severity.
- **Settings:** Profile, Units (metric or imperial, 24h or 12h), Thresholds per machine model (managers only), Notification preferences (per category: in-app, sound, email), Display density (comfortable or compact).

---

## 6. Responsiveness strategy

**Priority: desktop.** The target is a control-room or office workstation at **1440–1920px**. Responsive work is best-effort, and the tiers below say what "best-effort" means so nothing breaks badly.

| Tier | Width | Treatment |
|---|---|---|
| **Wall** | ≥ 1920 | Content max width 1760px. Dashboard gets an extra column (the attention queue widens). |
| **Desktop (primary)** | 1280–1919 | Full design as specified. |
| **Small laptop** | 1024–1279 | Sidebar collapsed to 64px by default. The Dashboard KPI row goes to 3 × 2. The map entity list becomes an overlay. Assistant split defaults to 50/50. |
| **Tablet** | 768–1023 | Sidebar becomes a drawer (hamburger). Side sheets go full width. Calendar defaults to Day view. Tables hide low-priority columns (see §11). |
| **Phone** | < 768 | Read-mostly. KPIs stack 2-up. Tables become card lists. The Assistant uses tabs for PDF and Chat instead of a split. Calendar is a list view (FullCalendar `listDay`). The SOS banner and Acknowledge action stay full size. |

Rules that hold at every size:
- **SOS acknowledgement always works at every width**, with a touch target of at least 44px.
- Drag-and-drop scheduling is desktop-only. On touch devices, rescheduling goes through the task sheet's date and time fields.
- Build it with Tailwind's standard breakpoints (`lg` = 1024, `xl` = 1280, `2xl` = 1536). Don't write custom media queries.

---

## 7. Design system

### 7.1 Foundations

| Foundation | Decision | Why |
|---|---|---|
| Theme | **Dark only** for v1 | Control rooms run dark to reduce glare and eye strain on long shifts. A light theme doubles the QA work during a hackathon. Tokens are named semantically, so light mode can be added later. |
| Grid | 12 columns, 24px gutter, 24px page padding (16px below 1024) | |
| Spacing | 4px base: `1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48` | Dense data needs the 4px steps. Layout uses 8px multiples. |
| Radius | `sm 2px` (badges), `md 4px` (inputs, buttons), `lg 6px` (cards, sheets) | Tight radii feel engineered. Large radii feel consumer. |
| Elevation | **No shadows.** Depth comes from surface steps + 1px borders. Popovers and dialogs use one soft shadow only to separate from the map. | Shadows barely show on dark UIs and look like SaaS. |
| Borders | 1px `border-default` everywhere. `border-strong` on hover or focus. | |
| Icons | Lucide (the shadcn default), 16px in dense UI, 20px in nav, 1.5px stroke. **Custom machine silhouettes** (excavator, dozer, haul truck, wheel loader, motor grader, articulated truck) are needed, because Lucide has none. | |
| Motion | 150ms ease-out for UI. 200ms for sheets. **Pulse only for unacknowledged critical events.** Respect `prefers-reduced-motion`: pulses become a static ring. | Movement means urgency, so it must be rare. |
| Focus | 2px yellow focus ring with a 2px offset | The yellow ring is allowed because focus is an "act here" signal. |

### 7.2 shadcn/ui usage

Use shadcn components as the base layer, restyled only through tokens: Button, Input, Select, Combobox (Command + Popover), Dialog, Sheet, Tabs, Table, Badge, Tooltip, Popover, DropdownMenu, Toast (Sonner), Skeleton, Resizable, ScrollArea, Separator, Avatar, Calendar (date picker only), Checkbox, Switch, ToggleGroup (segmented controls).

**Button variants:**
- `primary`: yellow fill, black text. **At most one per view region.**
- `secondary`: `surface-raised` fill, white text, border.
- `ghost`: text only.
- `destructive`: red outline, becoming a red fill on confirm.
- `critical-action`: red fill, white text. Only for SOS Acknowledge and Respond.

**Sizes:** `sm 28px`, `md 36px` (default), `lg 44px` (SOS, touch).

---

## 8. Typography scale

**Typefaces**
- **UI: IBM Plex Sans.** Engineered, a little condensed, with good digits and an industrial heritage. It reads as "instrument" rather than "startup" (Inter's usual effect).
- **Data: IBM Plex Mono.** For IDs (`MCH-042`), telemetry readouts, coordinates and timestamps in logs.
- Both come from Google Fonts via `next/font`. **All numbers in tables and KPIs use `font-variant-numeric: tabular-nums`**, so columns line up and live values don't jitter as they change.

| Token | Size / Line height | Weight | Use |
|---|---|---|---|
| `display` | 40 / 44 | 600 | Wall-mode KPI values |
| `kpi` | 32 / 36 | 600 | KPI tile values |
| `h1` | 24 / 32 | 600 | Page titles |
| `h2` | 20 / 28 | 600 | Section titles, detail headers |
| `h3` | 16 / 24 | 600 | Card titles |
| `body` | 14 / 20 | 400 | Default text |
| `body-strong` | 14 / 20 | 500 | Table primary column, emphasis |
| `small` | 13 / 18 | 400 | Table cells (compact), secondary text |
| `caption` | 12 / 16 | 400 | Timestamps, helper text |
| `overline` | 11 / 16 | 600, uppercase, +0.06em tracking | KPI labels, sidebar group labels, table headers |
| `mono` | 13 / 18 | 500 | IDs, telemetry values |

Minimum body size is 13px. Nothing smaller than 11px, and 11px is only used for uppercase labels.

---

## 9. Color token system

### 9.1 Surfaces and text

| Token | Value | Use |
|---|---|---|
| `bg-canvas` | `#0B0B0B` | App background |
| `bg-panel` | `#161616` | Cards, sidebar, panels |
| `bg-raised` | `#1E1E1E` | Hover rows, active nav, inputs |
| `bg-overlay` | `#242424` | Popovers, dropdowns, sheets |
| `bg-inset` | `#101010` | Chart plot areas, code, PDF canvas surround |
| `border-default` | `#2A2A2A` | All 1px borders |
| `border-strong` | `#3A3A3A` | Hover/focus borders, dividers that need emphasis |
| `text-primary` | `#F5F5F5` | Main text (≈ 17:1 on panel) |
| `text-secondary` | `#A3A3A3` | Labels, secondary info (≈ 7.2:1) |
| `text-muted` | `#8A8A8A` | Timestamps, placeholders (≈ 5.2:1, still passes AA) |
| `text-disabled` | `#525252` | Disabled only; not required to meet contrast |
| `text-on-brand` | `#111111` | Text on yellow |

> Note: the gray people usually pick for muted text, `#737373`, measures about 3.8:1 on `#161616`, which **fails WCAG AA** for body text. Use `#8A8A8A` instead.

### 9.2 Brand

| Token | Value | Use: **only** these |
|---|---|---|
| `brand` | `#FFCD11` | Primary button fill, active nav rail, focus ring, KPI hero value (on at most one tile), selected calendar date, logo mark |
| `brand-hover` | `#FFD84D` | Primary button hover |
| `brand-pressed` | `#E6B800` | Primary button active |
| `brand-subtle` | `#FFCD11` at 10% | Selected table row background, active tab underline area |
| `cat-black` | `#111111` | Text on yellow, logo |

### 9.3 Status (semantic)

Each status has a solid (icons, text, chart series), a subtle background (badges, row tint, 12% alpha) and a border (40% alpha).

| Status | Solid | Subtle bg | Icon | Meaning in this product |
|---|---|---|---|---|
| `success` | `#22C55E` | `rgba(34,197,94,.12)` | ✓ circle-check | Operating, completed, available, normal |
| `warning` | `#F59E0B` | `rgba(245,158,11,.12)` | ▲ triangle-alert | Delayed, elevated temp, elevated fatigue, idle too long |
| `danger` | `#EF4444` | `rgba(239,68,68,.12)` | ◆ octagon-alert / ● for SOS | SOS, fault, critical threshold, restricted zone |
| `info` | `#3B82F6` | `rgba(59,130,246,.12)` | ℹ info | Scheduled, maintenance, informational |
| `neutral` | `#737373` | `rgba(115,115,115,.16)` | ○ circle | Offline, off shift, cancelled |

### 9.4 Yellow vs. amber

Placed next to each other on `#0B0B0B`, `#FFCD11` and `#F59E0B` are easy to tell apart. Scattered around a dense screen, they are not. Rules:
1. Warning **always** comes with the ▲ icon and a text label. Yellow never does.
2. Yellow is never used on a status badge, a chart series or a map marker.
3. Warning chart series use amber with a **dashed** stroke when shown next to a yellow brand element.
4. Treat any yellow that appears in a data area during review as a bug.

### 9.5 Chart palette

Categories (task types, machine types) use a **desaturated** sequence so they don't compete with status colors. Status-meaning charts (fleet status) use the status tokens directly.

`chart-1 #8AB4F8` (steel blue) · `chart-2 #A7C4A0` (sage) · `chart-3 #C9A9E0` (lilac) · `chart-4 #E0B48A` (sand) · `chart-5 #7FC8C8` (teal) · `chart-6 #B0B0B0` (gray)

Gridlines use `#222222`. Axis labels use `text-muted` at 12px. A target or reference line is dashed `text-secondary`. Brand yellow may be used for **one** highlight series (e.g. "this site" against the others) when that series is the point of the chart.

---

## 10. Card designs

All cards: `bg-panel`, 1px `border-default`, 6px radius, 16px padding (compact 12px). The header row is 32px: `h3` title, optional `caption` subtitle, and right-aligned ghost actions (⋯ menu, "View all →").

| Card | Anatomy | Specific rules |
|---|---|---|
| `KpiTile` | See §15 | |
| `SectionCard` | Header + body slot + optional footer link | The generic container for dashboard widgets |
| `MachineCard` | Icon + ID + model / status badge / 3 telemetry cells / operator + task footer / "updated Xs ago" | A 2px top border in the status color **only** for fault or critical. Otherwise no color rail |
| `OperatorCard` | Avatar + name + ID / availability badge / shift progress bar / fatigue bar / current machine | Fatigue ≥ 70 adds a red ◆ next to the name |
| `TaskCard` (tray, list) | Type icon + ID / title / complexity pips / machine + operator chips / duration | Draggable. Grab handle appears on hover |
| `EventCard` / `EventRow` | 4px left rail in severity color / icon + category / subject + location / elapsed timer / status / actions | The rail is the one exception to "no color rails"; severity must be visible at a glance |
| `ManualCard` | Cover thumb (3:4) / model / doc type / page count / last opened | |
| `TelemetryCell` | `overline` label / `mono` value + unit / threshold icon / optional sparkline | The value dims to `text-muted` with a ⏱ icon when stale |

**States:** hover moves the border to `border-strong` and gives clickable cards a cursor. Selected cards get a `brand-subtle` background and a 1px `brand` border. The card body is never yellow.

---

## 11. Table designs

Built on shadcn Table + TanStack Table (sorting, filtering, column visibility, row selection, virtualization for more than 200 rows).

**Anatomy**
- **Toolbar:** search (debounced 200ms), filter chips (each removable, plus "Clear all"), a column visibility menu, a density toggle and export. When rows are selected, the toolbar switches to the **bulk action bar** ("3 selected · Mark complete · Reassign · ✕").
- **Header:** 36px, `overline` style, `bg-panel`, sticky. The sorted column shows ↑/↓ and a white label; unsorted columns show a faint ↕ on hover.
- **Rows:** 44px comfortable or 36px compact (compact is the default on desktop), 1px `border-default` dividers, no zebra stripes (they clash with status tints).
- **Hover:** `bg-raised`. **Selected:** `brand-subtle` with a checkbox.
- **Row click** opens the side sheet. A trailing ⋯ menu holds row actions. There is no separate "View" button column.
- **Alignment:** text left, numbers right (tabular), status badges left, actions right.
- **First column** is sticky on horizontal scroll: avatar or icon, name in `body-strong`, ID in `mono caption` underneath.
- **Live cells** (velocity, temp) update in place. A changed value gets a 600ms `bg-raised` fade, so movement is noticeable without being distracting. This is turned off under reduced-motion.
- **Pagination:** 50 rows per page with a "1–50 of 312" count, or infinite scroll with virtualization for live fleet tables. Page state goes in the URL.

**Column priority for responsive hiding** (P1 always shown, P3 hidden first):
- *Machines:* P1 Machine, Status · P2 Engine temp, Operator · P3 Velocity, Runtime, Task, Last seen.
- *Operators:* P1 Operator, Availability · P2 Fatigue, Shift · P3 Hours, Tasks, Machine.

---

## 12. Calendar design (FullCalendar)

**Views**

| View | FullCalendar view | Use |
|---|---|---|
| Day | `timeGridDay` | Detailed shift planning. Slots 15 min, labels every hour |
| Week | `timeGridWeek` | Default for supervisors |
| Month | `dayGridMonth` | Long-range planning. Events show as compact bars, "+N more" popover |
| **Machines** (recommended extra) | `resourceTimelineDay` | Rows = machines, x = time. This is how dispatchers actually think, and it makes machine conflicts obvious |
| List (mobile) | `listDay` / `listWeek` | Small screens |

> **Licensing flag:** the `resourceTimeline` views belong to **FullCalendar Premium**, which needs a license. Non-commercial and open-source projects can use it free (there's a GPL option and a Creative Commons non-commercial key). Day, Week, Month and List are all free. If the license is a problem, the Machines view can be built as a custom SVG timeline (the Dashboard `ShiftTimeline` component already does this).

**Styling (overrides FullCalendar's CSS variables)**
- Grid background `bg-panel`, slot lines `#222`, hour lines `border-default`.
- **Shift bands:** day shift hours plain, night shift hours `bg-inset`. Planners can see shift boundaries without reading times.
- **Now indicator:** 2px `danger` line with a dot. (Red is the convention in scheduling tools, and it doesn't compete with yellow.)
- **Today column header:** yellow date number in a black-text pill. This is one of yellow's allowed uses: selected or current date.
- Weekend and non-working days use `bg-inset`.

**Event design (`TaskEvent`)**

```
┌▌───────────────────────────┐   ▌ = 3px left rail in STATUS color
│▌⛏ TSK-2231  ▮▮▯            │   type icon · ID · complexity pips
│▌Excavation — Bench 4       │   title
│▌MCH-042 · J. Moreno        │   machine · operator (hidden if < 45 min tall)
└▌───────────────────────────┘
```

- **Background:** `bg-raised`. Rail color by status: Scheduled `info`, In progress `success`, Delayed `warning`, Completed `neutral` (and the title gets a strikethrough), Cancelled `neutral` at 50% opacity.
- **Task type** is shown by its **icon**, not background color, so status color and type color never fight.
- **Content drops out as the event gets shorter:** full, then ID + title, then ID only.
- **Hover card** shows the full details plus **Mark complete**, **Edit** and **Open**.
- **Drag feedback:** a ghost at 60% opacity. Target slots that would conflict get a red striped fill *during* the drag, so conflicts show before the drop, not only after.

---

## 13. Map design (Google Maps)

**Base map:** a custom dark style made with Google Cloud-based map styling (a Map ID). Land `#141414`, roads `#262626`, labels `#6B6B6B`, water `#0E1A24`. Hide POIs, transit and business labels. **Satellite toggle** for sites where terrain matters (pits and benches matter more than roads). Use `AdvancedMarkerElement` so markers can be HTML/SVG rather than image icons.

**Layers**

| Layer | Visual | Details |
|---|---|---|
| **Work sites** | Polygon, 1px `text-secondary` stroke, 4% white fill, name label at centroid | Sits at the bottom |
| **Restricted zones** | Polygon, 2px `danger` stroke, **diagonal red hatch** at 15% | The hatch pattern means the zone still reads as restricted without color (color-blind safe). Blasting or time-limited zones show a countdown chip |
| **Machines** | 28px rounded-square marker: machine silhouette icon on `bg-overlay`, **2px status-colored ring**, and a small **heading chevron** outside the square pointing in the direction of travel | Label (ID) appears at zoom ≥ 16 or on hover. Stale (> 60s) machines: 50% opacity with a dashed ring |
| **Operators** | 16px circle with initials (at zoom ≥ 17) or a dot, availability-colored ring | Operators inside a machine are *not* drawn separately; the machine marker gets a small person badge instead |
| **SOS** | 36px red circle with a white ● icon, **2 expanding pulse rings** (1.5s loop) until acknowledged, then static with a red ring | Always drawn on top. Never clustered. Always visible, even if the SOS layer is off (the toggle is disabled with a tooltip) |
| **Trails** (optional) | Fading polyline, last 15 minutes, `text-muted` | Off by default |

**Clustering:** `@googlemaps/markerclusterer` for machines and operators below zoom 15. Clusters are neutral gray circles with a count. **If a cluster contains a fault or critical machine, it gets a red ring**, so a problem is never hidden inside a cluster.

**Realtime movement:** Socket.IO position updates move markers smoothly over the update interval (about 1s), not in jumps. Updates are batched to one render per animation frame.

**Drawer contents by entity**
- *Machine:* header (ID, model, status), 3 telemetry cells, operator, task, and buttons: Follow, Open details, Open manual.
- *Operator:* shift, fatigue, current task, and buttons: Call, Open profile.
- *Zone:* type, active window, rules, machines currently inside.
- *SOS:* who, what, elapsed timer, nearest responders by distance, and buttons: Acknowledge (red, large), Assign, Open event.

---

## 14. PDF assistant design

**Split:** `ResizableSplit`, PDF 55% and Chat 45% by default, 35–65% range, remembered per user. Below 1024px it becomes tabs (PDF | Chat) with a floating "Chat" button on the PDF.

**PDF viewer (react-pdf)**
- **Toolbar (sticky, 44px):** outline toggle, page field ("112 / 486", editable), prev and next, zoom (fit width / fit page / 50–200%), search within the PDF, download.
- **Rendering:** pages render one after another in a continuous scroll, on a `bg-inset` background with an 8px gap between pages. Only the visible page plus two either side are rendered (react-pdf is heavy with 400-page manuals). Pages further away show a skeleton with the page number.
- **Outline panel (left, 240px, toggle):** the PDF's table of contents. Clicking an entry jumps to it.
- **Citation highlight:** when a citation is opened, the viewer scrolls to the page, draws a `brand-subtle` fill with a 2px yellow left bar around the cited text (using react-pdf's text layer), and **flashes it once**. The highlight stays until the next citation is opened. If the exact text can't be matched, it falls back to highlighting the whole page border and shows a toast: "Showing page 112. The exact passage couldn't be matched."

**Chat panel**
- **Header:** manual name, a **New chat** button, and a session history dropdown.
- **Empty state:** "Ask anything about the **Cat 336 Operation & Maintenance Manual**" plus 4 suggested prompts built from the manual type (e.g. "Daily walk-around checklist", "Hydraulic oil change interval", "Warning light meanings", "Safe shutdown procedure").
- **Messages:** user messages are right-aligned on `bg-raised`. Assistant messages are left-aligned with no bubble, full width, so long procedures read like a document. Markdown is supported, including numbered steps, tables and **safety callouts**. Any answer text that matches a manual WARNING or CAUTION is shown in a red- or amber-bordered callout block.
- **Citations:** inline chips `[1]` in `mono`. Each assistant message ends with a **Sources** box listing `[n] p.112 · Section title · excerpt…`. Clicking a chip or source row jumps to that page. The active citation is shown as selected.
- **Streaming:** a caret at the end of the growing text. The Sources box appears once the stream finishes. A **Stop** button replaces Send while streaming.
- **Trust signals:** if the answer has no citations, the message shows "⚠ No source found in this manual. Verify before acting." (in amber), and it is never presented as authoritative. Every message has 👍/👎 and **Copy** actions.
- **Composer:** auto-growing textarea (1–6 lines). `Enter` sends, `Shift+Enter` adds a new line. There's a context chip if text was quoted from the PDF, and a model/manual scope line: "Searching: Cat 336 O&M".

---

## 15. Dashboard KPI design

**`KpiTile` anatomy**

```
┌─────────────────────────────┐
│ ACTIVE MACHINES          ⓘ │  overline label · definition tooltip
│                             │
│ 38 / 45                     │  kpi value (tabular) · denominator in text-secondary
│ ▲ 3 vs. yesterday  ▁▂▃▅▆▇▇  │  delta (caption) · 12h sparkline (40×16)
└─────────────────────────────┘
  height 112px · padding 16px · entire tile is a link
```

**Tile rules**

| KPI | Value format | Neutral state | Alert state |
|---|---|---|---|
| Active Machines | `38 / 45` | White value | Ratio < 70% → value turns amber with ▲ |
| Active Operators | `41 / 48` | White | Fewer operators than active machines → amber, "3 machines unstaffed" |
| Tasks In Progress | `27` | White | — |
| Delayed Tasks | `5` | **0 shows "0" with a ✓ in green** | > 0 → amber value + ▲, 2px amber top border |
| SOS Alerts | `2` | **0 shows "All clear" with a ✓ in green** | > 0 → red value, red top border, pulse dot while unacknowledged |
| Fleet Utilization | `78%` | **Hero tile: the value is in brand yellow** (the one allowed yellow KPI) | Below target → amber, with a "target 75%" marker on the sparkline |

- **Deltas** show the direction and whether it's good or bad. The color comes from whether the change is good, not whether it's up: fewer delayed tasks is a green ▼.
- **Live changes:** when a value changes, the number crossfades (150ms) and a small caption says "updated just now", fading to "Xs ago".
- **Loading:** a skeleton bar where the value goes. The label is still shown, so the layout doesn't jump.

---

## 16. Notification system design

**Severity tiers and channels**

| Tier | Examples | Channels | Persistence |
|---|---|---|---|
| **P1 Critical** | SOS, man down, machine critical failure, restricted-zone breach by a person | **Global SOS banner** + toast (does not auto-dismiss) + notification center + optional sound + sidebar badge + map pulse | Stays until acknowledged by someone. Every supervisor on the site sees it |
| **P2 Warning** | Task delayed, engine temp elevated, fatigue ≥ 70, zone breach by a machine, certification expiring | Toast (8s auto-dismiss, pauses on hover) + notification center | Unread until opened |
| **P3 Info** | Task completed, task assigned to you, shift handover note | Notification center only (bell badge) | Unread until opened |

**Global SOS banner:** 40px, full width above the top bar, solid `danger` background with white text: "● SOS · OP-017 J. Moreno · Zone B · 02:14 elapsed". It has **[Acknowledge]** (white button, red text) and **[View on map]**. If several are active, it shows "2 active emergencies" and cycles through them, with a **View all** link. After acknowledgement it turns into a 32px darker-red "responding" strip until resolved, and then disappears.

**Toasts (Sonner):** bottom-right, at most 3 visible with the rest stacked. Each has a severity icon, a title, one line of detail, one action (View / Reschedule / Acknowledge) and a close button. P1 toasts have a red left rail and no auto-dismiss.

**Notification center (bell popover, 400px):** tabs All · Unread · Mine. Items are grouped by *Today* and *Earlier*. Each item has a severity icon, text, relative time, an unread dot and a one-click action. The footer has **Mark all read** and **View all →** (to `/notifications`).

**Sound:** off by default, except P1 when the user is a Safety Officer or Supervisor, who can turn it off in Settings. Sound only plays when the tab is hidden **or** the P1 has been unacknowledged for more than 30s. The system Notification API is used for P1 events when the tab is in the background.

**Rate limiting:** duplicate P2 notifications for the same entity within 5 minutes are merged ("MCH-042 engine temp elevated ×3"). P1 is never merged or rate-limited.

---

## 17. Empty states

Structure: a monochrome line illustration or icon (48px, `text-muted`), an `h3` headline, one line of body text, and at most one action. The tone is plain and factual, with no jokes, because this is safety software.

| Where | Headline | Body | Action |
|---|---|---|---|
| Dashboard attention queue | **All clear** ✓ (green) | No open alerts, delays or threshold breaches. | — |
| Safety active board | **No active emergencies** ✓ | New SOS and assistance requests will appear here instantly. | Log incident |
| Schedule (no tasks in range) | No tasks scheduled for this week | Drag a task from the tray or create one. | + Task |
| Unscheduled tray | Everything's scheduled | — | — |
| Machines (filter excludes all) | No machines match these filters | — | Clear filters |
| Operators (new site) | No operators assigned to this site yet | Operators added in the admin console will appear here. | — |
| Map (no positions) | Waiting for location data | Machines will appear as soon as they report GPS. | — |
| Assistant library | No manuals uploaded | Manuals uploaded to the knowledge base appear here. | — |
| Assistant chat | (suggested-prompts state, §14) | | |
| Analytics (range has no data) | No completed tasks in this period | Try a longer date range. | Last 30 days |
| Notifications | You're up to date | — | — |

**"Empty because nothing is wrong" and "empty because of your filters" must look different.** The first uses a green ✓. The second uses a neutral icon and always offers **Clear filters**.

---

## 18. Loading states

| Situation | Treatment |
|---|---|
| First page load | Route-level `loading.tsx`: the shell renders straight away, and the content area shows **layout-matching skeletons** (KPI tiles, table rows, chart boxes). No full-page spinners. |
| Tables | 8 skeleton rows at real row height, with column widths matching real content |
| Charts | A plot-area skeleton with faint gridlines. Axis labels are shown if already known |
| Map | Dark placeholder in the map colors with a centered caption: "Loading map…". Markers fade in once positions arrive |
| KPI tiles | Label shown, with a skeleton for the value and sparkline |
| PDF | Page-shaped skeletons with page numbers. The toolbar can be used straight away |
| AI answer | A "Searching manual…" step with an animated dot, then "Writing answer…", then the streamed text. This helps waits of 5–15s feel shorter |
| Mutations (save task, ack SOS) | **Optimistic updates** with the button showing a spinner inside it. Roll back with an error toast if the request fails |
| Background refresh | Never re-skeleton data that's already shown. Only the "updated Xs ago" caption changes |

Skeletons use a `bg-raised` shimmer on `bg-panel`, 1.5s. The shimmer is static under reduced-motion.

---

## 19. Error states

| Situation | Treatment |
|---|---|
| **Realtime disconnected** (Socket.IO) | Top bar status goes from ● Live (green) to ● Reconnecting… (amber, spinner) to ● Offline (red). After 10s offline, a 32px amber strip appears under the top bar: "Live updates paused. Showing data from 09:41. Reconnecting…". **All live values dim to `text-muted` with ⏱** so nobody acts on stale data. When the connection returns, the strip flashes green "Reconnected" for 2s, and the page re-syncs with a full refetch. |
| Widget failure | Each dashboard card is its own error boundary. It shows ⚠ "Couldn't load fleet status" with a **Retry** button inside the card. The rest of the page keeps working. |
| Page failure | Route `error.tsx`: the shell stays, and the content area shows the error title, a short explanation, a **Retry** button, a **Go to Dashboard** button and an expandable technical detail (error ID for support). |
| Not found | `not-found.tsx`: "Machine MCH-999 doesn't exist or was removed", with a link back to the list. |
| Permission | "You don't have access to Analytics. Ask your operations manager." No stack trace. |
| Form validation | Inline under each field in `danger` `caption`, and the first invalid field gets focus. Server conflicts (e.g. double-booking) use the `ConflictBanner` at the top of the sheet. |
| Map API failure | The map area shows "Map unavailable" and **falls back to the entity list at full width**, with location columns (site, zone, coordinates), so spatial awareness is reduced but not lost. SOS events are still listed. |
| PDF failure | "This manual couldn't be loaded" with Retry and **Chat without viewer** (citations then show page numbers and excerpts only). |
| AI endpoint failure | An inline assistant message in amber: "The assistant is unavailable right now. Your question was saved." with **Retry**. The composer text is kept. A timeout after 30s shows the same message. |
| SOS acknowledge failure | **Never fail silently.** A red toast that doesn't dismiss itself, the button goes back to its original state, and the banner stays up: "Acknowledgement didn't go through. Try again or radio the control room." |

---

## 20. Recommended component hierarchy

```
app/
├── layout.tsx                          RootLayout: fonts, <html class="dark">
│   └── Providers
│       ├── QueryClientProvider         (TanStack Query: server state, cache, refetch)
│       ├── SocketProvider              (one Socket.IO connection; merges events into the query cache)
│       ├── SiteScopeProvider           (current site, role)
│       └── Toaster (Sonner)
│
└── (ops)/layout.tsx                    AppShell
    ├── SosBanner                       ← subscribes to open P1 events
    ├── Sidebar
    │   ├── Wordmark
    │   ├── SiteSwitcher
    │   ├── NavGroup × 4 → NavItem (+ CountBadge)
    │   ├── ConnectionStatus
    │   └── UserMenu
    ├── TopBar
    │   ├── Breadcrumbs
    │   ├── CommandSearch (⌘K)
    │   ├── NotificationBell → NotificationPopover → NotificationItem
    │   └── ConnectionStatus (compact)
    ├── StaleDataStrip
    └── <main> {page}
```

**Folder structure for components**

```
components/
├── ui/                    shadcn primitives, restyled through tokens only
├── shell/                 AppShell, Sidebar, TopBar, SosBanner, PageHeader, CommandSearch
├── data/                  shared building blocks used on several pages
│   ├── KpiTile, Sparkline, DeltaIndicator
│   ├── StatusBadge, SeverityIcon, ComplexityPips, FatigueBar, ShiftProgress
│   ├── TelemetryValue (handles units, thresholds, stale state)
│   ├── DataTable (+ Toolbar, FilterChips, BulkActionBar, ColumnToggle)
│   ├── EntityChip (machine/operator mini-chip with hover card)
│   ├── LastUpdated, RelativeTime
│   └── EmptyState, ErrorState, SectionCard, WidgetBoundary
├── charts/                TrendChart, StackedStatusChart, RangeBarChart, ChartTooltip, chart theme
└── map/                   FleetMap, markers, ZonePolygon, LayerPanel, EntityDrawer, MapLegend

features/
├── dashboard/             AttentionQueue, ShiftTimeline, FleetStatusCard, UtilizationCard
├── schedule/              ScheduleCalendar, TaskEvent, UnscheduledTray, TaskSheet, TaskForm, ConflictBanner
├── operators/             OperatorTable, OperatorCard, OperatorSheet, FatigueTrendChart
├── machines/              MachineTable, MachineCard, MachineSheet, TelemetryPanel
├── safety/                EventQueue, EventRow, EventDetailPanel, EventTimeline, ResponderPicker, IncidentForm
├── analytics/             AnalyticsFilterBar, per-tab chart compositions
└── assistant/             ManualLibrary, ManualSession, PdfViewer (+Toolbar, Outline, Thumbnails),
                           ChatPanel, ChatMessage, CitationChip, SourceList, ChatComposer
```

**Architecture notes that affect the UX**
- **One socket, shared by everything.** `SocketProvider` holds a single connection. Events like `machine:telemetry`, `operator:status`, `task:update` and `event:new` are written into the TanStack Query cache, so the table, map, KPI tile and side sheet for the same machine can never disagree.
- **Throttle rendering, not data.** High-frequency telemetry is buffered and applied at most every 500ms for tables and every animation frame for the map.
- **Client components only where needed.** The map, calendar, PDF viewer, charts and anything listening to the socket are client components (and load `next/dynamic` with `ssr: false` for the map, FullCalendar and react-pdf). Page frames, headers and initial data come from Server Components for a fast first paint.
- **`TelemetryValue` is the only place that formats live values.** It owns units, thresholds, icons and stale styling, so these rules can't drift apart between pages.

---

## Appendix A: Key user flows

**A1. SOS response (Supervisor). Target: acknowledged within 15s.**
1. An operator raises an SOS on the mobile app. The server sends `event:new` (P1).
2. On every supervisor screen: the red banner appears, a toast appears, the Safety badge goes to 1, the map marker pulses, and a sound plays if the tab is hidden.
3. The supervisor clicks **Acknowledge** on the banner (1 click, no confirmation). The banner turns into the "responding" strip.
4. **View on map** opens the SOS drawer and **Assign responder**, which lists the nearest people by distance.
5. On site, the responder resolves the event. The supervisor or safety officer adds a resolution note, the timeline is closed, and the event moves to the Incident log.

**A2. Reschedule a delayed task (Supervisor)**
1. The Dashboard *Delayed Tasks* tile shows 5 in amber. Click it to open the filtered schedule list.
2. Open TSK-2231 in the side sheet, see "Running 40m over. MCH-042 is next needed at 13:00."
3. Switch to the Machines timeline and drag the next task to a free machine. The conflict check passes, and a "Rescheduled · Undo" toast appears.

**A3. Fix a fault using the manual (Operator or Supervisor)**
1. MCH-042 shows ◆ 108°C. On the machine detail page, choose **Open manual**, which opens `/assistant/cat-336-om`.
2. Ask: "Engine coolant temperature warning, what should I check?" The answer is shown in steps with a CAUTION callout and citations [1] p.214 and [2] p.87.
3. Click [1]. The PDF jumps to p.214 with the passage highlighted.

---

## Appendix B: Open questions for review

1. **Fatigue score source:** is it calculated by the backend (and from what inputs), or estimated in the frontend from shift hours? The bands in §5.3.1 are placeholders.
2. **Telemetry thresholds:** the real engine temperature limits per Cat model need to come from the equipment specs.
3. **FullCalendar Premium:** accept the non-commercial license, or build the Machines timeline ourselves (§12)?
4. **Multi-site "All sites" view:** is it needed for the demo, or is one site enough?
5. **AI endpoint contract:** does it return citations as page number and exact text span? The highlight feature in §14 needs the text span. With only page numbers, it falls back to highlighting the whole page.
