import {
  CalendarClock,
  ChartColumn,
  HardHat,
  LayoutDashboard,
  Map,
  Settings,
  ShieldAlert,
  Truck,
  type LucideIcon,
} from "lucide-react";

export type NavBadge = "sos" | "delayed";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: NavBadge;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Sidebar order follows urgency of use — spec §2. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Live Map", href: "/map", icon: Map },
      { title: "Safety & SOS", href: "/safety", icon: ShieldAlert, badge: "sos" },
    ],
  },
  {
    label: "Planning",
    items: [{ title: "Tasks", href: "/tasks", icon: CalendarClock, badge: "delayed" }],
  },
  {
    label: "Fleet",
    items: [
      { title: "Machines", href: "/machines", icon: Truck },
      { title: "Operators", href: "/operators", icon: HardHat },
    ],
  },
  {
    label: "Insights",
    items: [{ title: "Analytics", href: "/analytics", icon: ChartColumn }],
  },
];

export const SETTINGS_ITEM: NavItem = { title: "Settings", href: "/settings", icon: Settings };

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
