import type { Machine, MachineStatus, MachineType } from "@/lib/types";
import { pt } from "./site";
import { at } from "./time";

type Row = [
  id: string,
  model: string,
  type: MachineType,
  status: MachineStatus,
  zoneId: string,
  operatorId: string | null,
  taskId: string | null,
  xy: [number, number],
  heading: number,
  velocityKph: number,
  engineTempC: number,
  runtimeTodayMin: number,
  engineHours: number,
  fuelPct: number,
  lastSeenMin: [number, number],
];

const rows: Row[] = [
  ["MCH-042", "Cat 336 Excavator", "excavator", "operating", "Z-B4", "OP-011", "TSK-2231", [250, 175], 40, 2.1, 104, 212, 8421, 58, [10, 14]],
  ["MCH-045", "Cat 390F Excavator", "excavator", "operating", "Z-B5", "OP-023", "TSK-2234", [560, 215], 210, 1.4, 88, 188, 12904, 64, [10, 14]],
  ["MCH-046", "Cat 349 Excavator", "excavator", "idle", "Z-B5", null, null, [655, 212], 90, 0, 71, 0, 6210, 81, [10, 13]],
  ["MCH-051", "Cat D8T Dozer", "dozer", "operating", "Z-WD", "OP-014", "TSK-2236", [180, 440], 120, 5.8, 92, 236, 15320, 47, [10, 14]],
  ["MCH-052", "Cat D10T2 Dozer", "dozer", "operating", "Z-WD", "OP-033", "TSK-2237", [270, 505], 300, 4.2, 90, 128, 9876, 52, [10, 14]],
  ["MCH-053", "Cat D6 Dozer", "dozer", "maintenance", "Z-WS", null, null, [795, 530], 0, 0, 24, 45, 4410, 90, [9, 30]],
  ["MCH-063", "Cat 793F Mining Truck", "haul-truck", "operating", "Z-HR2", "OP-017", "TSK-2232", [520, 312], 95, 38, 91, 238, 21045, 61, [10, 14]],
  ["MCH-064", "Cat 793F Mining Truck", "haul-truck", "operating", "Z-HR2", "OP-020", "TSK-2238", [640, 340], 275, 41, 89, 222, 19880, 39, [10, 14]],
  ["MCH-065", "Cat 793F Mining Truck", "haul-truck", "idle", "Z-CR", null, null, [830, 400], 180, 0, 65, 0, 18702, 72, [10, 12]],
  ["MCH-066", "Cat 785 Off-Highway Truck", "haul-truck", "operating", "Z-HR2", "OP-025", "TSK-2239", [440, 300], 100, 42, 87, 164, 16233, 55, [10, 14]],
  ["MCH-067", "Cat 777G Off-Highway Truck", "haul-truck", "fault", "Z-HR2", "OP-027", "TSK-2240", [700, 350], 95, 0, 109, 92, 11478, 44, [10, 13]],
  ["MCH-068", "Cat 777G Off-Highway Truck", "haul-truck", "idle", "Z-HR2", "OP-031", "TSK-2241", [600, 330], 280, 0, 62, 41, 10362, 68, [10, 14]],
  ["MCH-069", "Cat 777G Off-Highway Truck", "haul-truck", "offline", "Z-WS", null, null, [845, 585], 0, 0, 0, 0, 13510, 12, [6, 2]],
  ["MCH-071", "Cat 988K Wheel Loader", "wheel-loader", "operating", "Z-B4", "OP-022", "TSK-2242", [330, 210], 160, 6.5, 93, 224, 14567, 49, [10, 14]],
  ["MCH-072", "Cat 980 Wheel Loader", "wheel-loader", "operating", "Z-CR", "OP-038", "TSK-2243", [860, 330], 250, 7.1, 86, 196, 7719, 57, [10, 14]],
  ["MCH-073", "Cat 950 GC Wheel Loader", "wheel-loader", "idle", "Z-WS", null, null, [790, 585], 45, 0, 58, 12, 3308, 88, [10, 11]],
  ["MCH-081", "Cat 16M3 Motor Grader", "motor-grader", "operating", "Z-HR2", "OP-026", "TSK-2244", [480, 320], 85, 11.5, 84, 38, 6655, 76, [10, 14]],
  ["MCH-082", "Cat 140 Motor Grader", "motor-grader", "maintenance", "Z-WS", null, "TSK-2247", [870, 530], 0, 0, 22, 0, 9102, 95, [8, 50]],
  ["MCH-091", "Cat 745 Articulated Truck", "articulated-truck", "operating", "Z-WD", "OP-028", "TSK-2245", [300, 400], 20, 24, 85, 142, 5890, 63, [10, 14]],
  ["MCH-092", "Cat 740 GC Articulated Truck", "articulated-truck", "idle", "Z-B5", null, null, [510, 205], 315, 0, 69, 58, 4122, 70, [10, 12]],
  ["MCH-093", "Cat 745 Articulated Truck", "articulated-truck", "offline", "Z-WS", null, null, [885, 588], 0, 0, 0, 0, 7340, 5, [5, 40]],
];

export const machines: Machine[] = rows.map(
  ([id, model, type, status, zoneId, operatorId, taskId, [x, y], heading, velocityKph, engineTempC, runtimeTodayMin, engineHours, fuelPct, [h, m]]) => ({
    id,
    model,
    type,
    status,
    zoneId,
    operatorId,
    taskId,
    position: pt(x, y),
    heading,
    velocityKph,
    engineTempC,
    runtimeTodayMin,
    engineHours,
    fuelPct,
    lastSeen: at(0, h, m),
  }),
);

/** Engine temperature thresholds in °C — placeholder values, see spec §5.4. */
export const ENGINE_TEMP = { elevated: 95, critical: 105 };

/** Fleet size used as the denominator for "active machines". */
export const FLEET_SIZE = machines.length;
