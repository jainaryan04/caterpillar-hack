import type { ShiftType } from "@/lib/catalog";

/** Shift start, in local hours. Both shifts are twelve hours long. */
export const SHIFT_START_H: Record<ShiftType, number> = { Day: 6, Night: 18 };
export const SHIFT_MIN = 12 * 60;

/** YYYY-MM-DD in local time. */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}

/** Wall-clock Date for minute `min` of a day's shift. */
export function shiftTime(date: string, shift: ShiftType, min: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, SHIFT_START_H[shift], Math.round(min));
}
