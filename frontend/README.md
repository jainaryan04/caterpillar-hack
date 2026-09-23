# Cat Fleet Ops

Fleet operations dashboard prototype: machines, operators, task scheduling, live map, safety & SOS, analytics and a manual assistant. The design spec is in [`docs/DESIGN_SPEC.md`](docs/DESIGN_SPEC.md).

This phase is the **UI foundation**: every screen is navigable and interactive against mock data. There are no API calls, sockets or AI integration yet.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (all routes prerender)
npm run lint
```

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · Zustand · TanStack Query · TanStack Table · Recharts · FullCalendar v6 · next-themes

## Routes

| Route | Screen |
|---|---|
| `/dashboard` | KPIs, needs-attention queue, fleet mini-map, utilization, machine status, activity |
| `/tasks` | FullCalendar (day/week/month) + list, unscheduled tray, create/edit dialog, task drawer (`?task=`) |
| `/operators` | Roster table, fatigue + shift progress, profile drawer (`?operator=`) |
| `/machines` | Table/grid, status summary, detail drawer with telemetry chart (`?machine=`) |
| `/map` | Schematic site map with machines, operators, zones, SOS; layers, list, selection drawer (`?focus=`) |
| `/assistant` | Split PDF viewer + chat, citations jump to pages (`?manual=`) |
| `/safety` | Active board, response pipeline, event detail + lifecycle actions, incident log (`?event=`) |
| `/analytics` | Productivity, utilization, completion, duration tabs |
| `/settings` | Profile, theme, units, notification prefs, thresholds |

Selections live in the URL, so any drawer can be deep-linked (e.g. `/machines?machine=MCH-042`).

## Structure

```
src/
├── app/
│   ├── globals.css            design tokens (CSS variables, dark + light), type scale, FullCalendar theme
│   ├── layout.tsx             fonts (IBM Plex Sans / Mono), providers
│   └── (ops)/                 AppShell layout + one folder per route, loading.tsx, error.tsx
├── components/
│   ├── ui/                    shadcn primitives (restyled via tokens only)
│   ├── shell/                 AppShell, Sidebar, TopBar, Breadcrumbs, SosBanner, CommandSearch (⌘K),
│   │                          NotificationBell, UserMenu, ThemeToggle, ConnectionStatus
│   ├── shared/                PageHeader, KpiCard, MetricCard, StatusBadge, DataTable, EmptyState,
│   │                          ErrorState, loading skeletons, NotificationPanel, RightDrawer, SearchBar,
│   │                          FilterSelect, SegmentedControl, SummaryStrip, FatigueIndicator, …
│   └── charts/                shared Recharts styling + tooltip/legend
├── features/<module>/         page views and module-specific components
├── hooks/                     React Query data hooks, URL-param state, clock
├── stores/                    Zustand: UI prefs (persisted), alert + notification UI state
├── config/                    navigation, site/user
└── lib/
    ├── api/client.ts          data-access seam: returns mock data now, swap bodies for fetch later
    ├── mock/                  machines, operators, tasks, alerts (+ site zones, analytics, manuals)
    ├── status.ts              status → label + tone + icon maps (status is never color alone)
    ├── format.ts              locale-independent formatters (hydration-safe)
    └── types.ts               domain model
```

## Backend integration notes

- **Data:** replace the function bodies in `src/lib/api/client.ts`. Components read through the hooks in `src/hooks/use-fleet-data.ts`, so they don't change.
- **Realtime:** add a `SocketProvider` next to `QueryClientProvider` in `src/components/providers.tsx`, and write socket events into the query cache. `ConnectionStatus` already supports `live | reconnecting | offline`; it shows `demo` for now.
- **Local UI state to replace with server state:** acknowledge/resolve (`stores/alert-store.ts`), notification read state (`stores/notification-store.ts`), and task create/reschedule/complete (held in `TasksView`).
- **Map:** `features/map/site-map.tsx` is a schematic SVG stand-in. It already uses lat/lng and the spec's marker language. Replace it with Google Maps and keep the same props.
- **PDF:** `features/assistant/pdf-viewer-placeholder.tsx` has the final toolbar, outline and citation-highlight behaviour. Swap the page body for react-pdf.
- **Calendar:** the per-machine resource timeline needs FullCalendar Premium (see spec §12).
