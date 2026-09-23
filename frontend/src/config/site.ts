export const APP_NAME = "Cat Fleet Ops";

export const SITES = [
  { id: "pit-3-north", name: "Pit 3 North" },
  { id: "pit-1-south", name: "Pit 1 South" },
  { id: "ridgeline-crusher", name: "Ridgeline Crusher" },
] as const;

export const CURRENT_USER = {
  name: "Aryan Jain",
  initials: "AJ",
  role: "Site Supervisor",
} as const;

export const CURRENT_SHIFT = { name: "Day shift", window: "06:00–18:00" } as const;
