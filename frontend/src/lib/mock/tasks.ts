import type { Task, TaskComplexity, TaskStatus, TaskType } from "@/lib/types";
import { at } from "./time";

type Row = [
  id: string,
  title: string,
  type: TaskType,
  complexity: TaskComplexity,
  operatorId: string | null,
  machineId: string | null,
  start: [day: number, h: number, m: number] | null,
  durationMin: number,
  status: TaskStatus,
  zoneId: string,
  notes?: string,
];

const rows: Row[] = [
  // Earlier this week
  ["TSK-2220", "Bench 4 face excavation", "excavation", "high", "OP-011", "MCH-042", [-1, 6, 30], 480, "completed", "Z-B4"],
  ["TSK-2221", "Ore haul — crusher cycle A", "hauling", "low", "OP-017", "MCH-063", [-1, 7, 0], 420, "completed", "Z-HR2"],
  ["TSK-2222", "Grade Haul Road 2", "grading", "medium", "OP-026", "MCH-081", [-2, 8, 0], 240, "completed", "Z-HR2"],

  // Today
  ["TSK-2231", "Bench 4 face excavation", "excavation", "high", "OP-011", "MCH-042", [0, 6, 30], 240, "in-progress", "Z-B4", "Loading into 793F fleet. Watch high-wall exclusion to the north."],
  ["TSK-2232", "Ore haul — crusher cycle A", "hauling", "low", "OP-017", "MCH-063", [0, 6, 15], 360, "in-progress", "Z-HR2"],
  ["TSK-2234", "Bench 5 bulk dig", "excavation", "medium", "OP-023", "MCH-045", [0, 7, 0], 300, "in-progress", "Z-B5"],
  ["TSK-2236", "Waste dump push-out", "dozing", "medium", "OP-014", "MCH-051", [0, 6, 0], 240, "delayed", "Z-WD", "Running 40 min over — wet material at dump crest."],
  ["TSK-2237", "Dump ramp rebuild", "dozing", "high", "OP-033", "MCH-052", [0, 8, 0], 180, "in-progress", "Z-WD"],
  ["TSK-2238", "Waste haul — North dump", "hauling", "low", "OP-020", "MCH-064", [0, 6, 30], 330, "in-progress", "Z-HR2"],
  ["TSK-2239", "Ore haul — crusher cycle B", "hauling", "low", "OP-025", "MCH-066", [0, 7, 30], 300, "in-progress", "Z-HR2"],
  ["TSK-2240", "Ore haul — crusher cycle C", "hauling", "low", "OP-027", "MCH-067", [0, 8, 0], 240, "delayed", "Z-HR2", "Machine fault: hydraulic pressure loss."],
  ["TSK-2241", "Overburden haul", "hauling", "low", "OP-031", "MCH-068", [0, 9, 0], 180, "delayed", "Z-HR2", "Stopped — flat tire, awaiting field service."],
  ["TSK-2242", "Load trucks at Bench 4", "loading", "medium", "OP-022", "MCH-071", [0, 6, 30], 360, "in-progress", "Z-B4"],
  ["TSK-2243", "Crusher feed loading", "loading", "medium", "OP-038", "MCH-072", [0, 7, 0], 420, "in-progress", "Z-CR"],
  ["TSK-2244", "Grade Haul Road 2", "grading", "medium", "OP-026", "MCH-081", [0, 9, 30], 150, "in-progress", "Z-HR2"],
  ["TSK-2245", "Topsoil stockpile relocation", "hauling", "low", "OP-028", "MCH-091", [0, 10, 0], 180, "scheduled", "Z-WD"],
  ["TSK-2246", "Pre-shift inspection — D6", "inspection", "low", "OP-030", "MCH-053", [0, 6, 0], 45, "completed", "Z-WS"],
  ["TSK-2247", "250-hour service — 140 grader", "maintenance", "medium", null, "MCH-082", [0, 11, 0], 180, "scheduled", "Z-WS"],
  ["TSK-2248", "Blast prep clearance — B7", "inspection", "high", "OP-029", null, [0, 11, 30], 60, "scheduled", "Z-BLAST"],
  ["TSK-2249", "Afternoon ore haul — cycle A", "hauling", "low", "OP-034", "MCH-065", [0, 13, 30], 240, "scheduled", "Z-HR2"],
  ["TSK-2250", "Crusher pad load-out", "loading", "medium", "OP-032", "MCH-073", [0, 14, 0], 180, "scheduled", "Z-CR"],
  ["TSK-2251", "Crusher pad clean-up", "dozing", "low", null, "MCH-053", [0, 15, 0], 90, "cancelled", "Z-CR"],
  ["TSK-2252", "Night ore haul", "hauling", "low", "OP-035", "MCH-066", [0, 18, 30], 360, "scheduled", "Z-HR2"],
  ["TSK-2253", "Night bench dig — Bench 5", "excavation", "medium", "OP-036", "MCH-046", [0, 19, 0], 300, "scheduled", "Z-B5"],

  // Rest of the week
  ["TSK-2260", "Bench 6 pioneering cut", "excavation", "high", "OP-023", "MCH-045", [1, 7, 0], 480, "scheduled", "Z-B5"],
  ["TSK-2261", "Haul Road 3 grading", "grading", "medium", "OP-026", "MCH-081", [1, 8, 0], 240, "scheduled", "Z-HR2"],
  ["TSK-2262", "Dozer undercarriage inspection", "inspection", "low", "OP-033", "MCH-052", [2, 6, 30], 60, "scheduled", "Z-WS"],
  ["TSK-2263", "Loader bucket teeth change", "maintenance", "medium", null, "MCH-071", [2, 13, 0], 120, "scheduled", "Z-WS"],
  ["TSK-2264", "Waste dump shaping", "dozing", "medium", "OP-014", "MCH-051", [3, 7, 0], 360, "scheduled", "Z-WD"],
  ["TSK-2265", "Crusher feed loading", "loading", "medium", "OP-038", "MCH-072", [3, 6, 30], 420, "scheduled", "Z-CR"],
  ["TSK-2266", "Weekly safety walk", "inspection", "low", "OP-029", null, [4, 9, 0], 90, "scheduled", "Z-B4"],

  // Unscheduled
  ["TSK-2270", "Drainage ditch clean-out", "excavation", "low", null, null, null, 120, "scheduled", "Z-HR2"],
  ["TSK-2271", "Berm repair — Haul Road 2", "dozing", "medium", null, null, null, 90, "scheduled", "Z-HR2"],
  ["TSK-2272", "Light plant relocation", "maintenance", "low", null, null, null, 60, "scheduled", "Z-B5"],
  ["TSK-2273", "Stockpile survey support", "inspection", "low", null, null, null, 45, "scheduled", "Z-CR"],
];

export const tasks: Task[] = rows.map(
  ([id, title, type, complexity, operatorId, machineId, start, durationMin, status, zoneId, notes]) => ({
    id,
    title,
    type,
    complexity,
    operatorId,
    machineId,
    start: start ? at(...start) : null,
    durationMin,
    status,
    zoneId,
    notes,
  }),
);

export const TASK_TYPES: TaskType[] = [
  "excavation",
  "hauling",
  "loading",
  "grading",
  "dozing",
  "inspection",
  "maintenance",
];
