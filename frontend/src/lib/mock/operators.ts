import type { Availability, MachineType, Operator, Shift } from "@/lib/types";
import { pt } from "./site";

const DAY: Shift = { name: "Day", start: "06:00", end: "18:00" };
const NIGHT: Shift = { name: "Night", start: "18:00", end: "06:00" };

type Row = [
  id: string,
  name: string,
  certifications: MachineType[],
  shift: Shift | null,
  hoursWorked: number,
  hoursThisWeek: number,
  fatigue: number,
  availability: Availability,
  machineId: string | null,
  xy: [number, number] | null,
];

const rows: Row[] = [
  ["OP-011", "Jordan Moreno", ["excavator", "wheel-loader"], DAY, 4.2, 38.5, 34, "on-task", "MCH-042", [250, 175]],
  ["OP-014", "Ravneet Kaur", ["dozer", "motor-grader"], DAY, 10.2, 58, 74, "on-task", "MCH-051", [180, 440]],
  ["OP-017", "Marcus Bell", ["haul-truck", "articulated-truck"], DAY, 4.1, 44, 58, "on-task", "MCH-063", [520, 312]],
  ["OP-020", "Aisha Okafor", ["haul-truck"], DAY, 3.8, 26, 22, "on-task", "MCH-064", [640, 340]],
  ["OP-022", "Liam O'Connell", ["wheel-loader", "excavator"], DAY, 9.6, 55.5, 71, "on-task", "MCH-071", [330, 210]],
  ["OP-023", "Sofia Lindqvist", ["excavator"], DAY, 3.2, 36, 41, "on-task", "MCH-045", [560, 215]],
  ["OP-025", "Kenji Watanabe", ["haul-truck"], DAY, 2.8, 30, 30, "on-task", "MCH-066", [440, 300]],
  ["OP-026", "Daniela Cruz", ["motor-grader", "dozer"], DAY, 4.5, 41, 45, "on-task", "MCH-081", [480, 320]],
  ["OP-027", "Ethan Brooks", ["haul-truck"], DAY, 4.3, 39, 39, "on-task", "MCH-067", [700, 350]],
  ["OP-028", "Nia Thompson", ["articulated-truck", "haul-truck"], DAY, 2.4, 22, 28, "on-task", "MCH-091", [300, 400]],
  ["OP-029", "Tomás Herrera", ["excavator"], DAY, 4.0, 46, 52, "on-task", null, [205, 150]],
  ["OP-030", "Grace Mwangi", ["dozer", "wheel-loader"], DAY, 1.5, 12, 12, "available", null, [832, 530]],
  ["OP-031", "Arjun Mehta", ["haul-truck"], DAY, 4.1, 40, 39, "on-task", "MCH-068", [600, 330]],
  ["OP-032", "Chloe Dubois", ["wheel-loader"], DAY, 4.4, 42, 47, "on-break", null, [735, 545]],
  ["OP-033", "Samuel Adeyemi", ["dozer"], DAY, 8.9, 52, 66, "on-task", "MCH-052", [270, 505]],
  ["OP-034", "Hannah Fischer", ["haul-truck", "articulated-truck"], DAY, 1.2, 18, 18, "available", null, [735, 440]],
  ["OP-035", "Diego Álvarez", ["haul-truck"], NIGHT, 0, 36, 8, "off-shift", null, null],
  ["OP-036", "Mei Chen", ["excavator", "motor-grader"], NIGHT, 0, 34, 5, "off-shift", null, null],
  ["OP-037", "Oluwaseun Bello", ["dozer"], null, 0, 0, 0, "leave", null, null],
  ["OP-038", "Isabella Rossi", ["wheel-loader"], DAY, 3.9, 33, 36, "on-task", "MCH-072", [860, 330]],
];

export const operators: Operator[] = rows.map(
  ([id, name, certifications, shift, hoursWorked, hoursThisWeek, fatigue, availability, machineId, xy]) => ({
    id,
    name,
    initials: name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    role: "Equipment Operator",
    certifications,
    shift,
    hoursWorked,
    plannedHours: shift ? 12 : 0,
    hoursThisWeek,
    fatigue,
    availability,
    machineId,
    position: xy ? pt(xy[0], xy[1]) : null,
    phone: `+1 775 555 0${id.slice(-3)}`,
  }),
);

/** Fatigue bands — spec §5.3.1 */
export const FATIGUE = { elevated: 40, high: 70 };
