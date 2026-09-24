import type { TaskComplexity, TaskType, MachineType } from "@/lib/types";
import { formatDayLabel } from "@/lib/format";
import { noise } from "./time";

export interface DailyPoint {
  date: string;
  tasksCompleted: number;
  prevTasksCompleted: number;
  tasksPerOperatorHour: number;
  productiveHours: number;
  utilization: number;
  prevUtilization: number;
  operatingH: number;
  idleH: number;
  faultH: number;
  maintenanceH: number;
  onTime: number;
  late: number;
  cancelled: number;
}

function daily(days: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const n = noise(i + 1);
    const weekend = d.getDay() === 0 ? 0.8 : 1;
    const tasksCompleted = Math.round((34 + n * 14 + (days - i) * 0.25) * weekend);
    const late = Math.round(2 + noise(i + 50) * 5);
    const cancelled = Math.round(noise(i + 90) * 2.4);
    const utilization = Math.round(66 + n * 16 + (days - i) * 0.12);
    const operatingH = Math.round(21 * 12 * (utilization / 100));
    const faultH = Math.round(4 + noise(i + 7) * 14);
    const maintenanceH = Math.round(8 + noise(i + 13) * 10);
    out.push({
      date: formatDayLabel(d),
      tasksCompleted,
      prevTasksCompleted: Math.round(tasksCompleted * (0.86 + noise(i + 200) * 0.1)),
      tasksPerOperatorHour: +(0.19 + n * 0.06).toFixed(2),
      productiveHours: operatingH,
      utilization,
      prevUtilization: Math.round(utilization * (0.9 + noise(i + 300) * 0.08)),
      operatingH,
      idleH: Math.max(0, 21 * 12 - operatingH - faultH - maintenanceH),
      faultH,
      maintenanceH,
      onTime: tasksCompleted - late,
      late,
      cancelled,
    });
  }
  return out;
}

export const dailySeries = daily(30);

/** Fleet utilization per hour for the current shift (dashboard). */
export const shiftUtilization = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
  "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
].map((hour, i) => ({
  hour,
  utilization: i < 5 ? Math.round(58 + i * 5 + noise(i + 400) * 6) : null,
  target: 75,
}));

/** 12-point sparklines for the dashboard KPI tiles. */
export const kpiSparklines = {
  activeMachines: [8, 10, 11, 12, 12, 11, 12, 13, 12, 11, 12, 11],
  activeOperators: [9, 12, 14, 15, 15, 15, 16, 16, 16, 15, 16, 16],
  tasksInProgress: [4, 7, 9, 10, 11, 10, 11, 12, 11, 10, 11, 11],
  delayedTasks: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3],
  sosAlerts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
  utilization: [52, 58, 63, 67, 70, 72, 71, 74, 76, 75, 77, 78],
};

export const tasksByType: { type: TaskType; completed: number }[] = [
  { type: "hauling", completed: 412 },
  { type: "loading", completed: 238 },
  { type: "excavation", completed: 187 },
  { type: "dozing", completed: 121 },
  { type: "grading", completed: 74 },
  { type: "inspection", completed: 66 },
  { type: "maintenance", completed: 41 },
];

export const utilizationByMachineType: { type: MachineType; utilization: number }[] = [
  { type: "haul-truck", utilization: 82 },
  { type: "wheel-loader", utilization: 79 },
  { type: "excavator", utilization: 76 },
  { type: "dozer", utilization: 71 },
  { type: "drill-rig", utilization: 64 },
  { type: "motor-grader", utilization: 52 },
];

export const operatorProductivity = [
  { operatorId: "OP-017", tasks: 58, hours: 196, onTimeRate: 94 },
  { operatorId: "OP-025", tasks: 55, hours: 188, onTimeRate: 96 },
  { operatorId: "OP-020", tasks: 51, hours: 180, onTimeRate: 92 },
  { operatorId: "OP-011", tasks: 44, hours: 202, onTimeRate: 89 },
  { operatorId: "OP-038", tasks: 42, hours: 176, onTimeRate: 95 },
  { operatorId: "OP-022", tasks: 40, hours: 214, onTimeRate: 83 },
  { operatorId: "OP-014", tasks: 37, hours: 221, onTimeRate: 78 },
  { operatorId: "OP-026", tasks: 35, hours: 170, onTimeRate: 91 },
];

/** Minutes, per task type — min / median / p90 actual vs planned. */
export const durationStats: {
  type: TaskType;
  min: number;
  median: number;
  p90: number;
  planned: number;
}[] = [
  { type: "excavation", min: 150, median: 262, p90: 355, planned: 240 },
  { type: "hauling", min: 180, median: 305, p90: 372, planned: 300 },
  { type: "loading", min: 200, median: 348, p90: 410, planned: 360 },
  { type: "dozing", min: 90, median: 214, p90: 298, planned: 180 },
  { type: "grading", min: 80, median: 158, p90: 205, planned: 150 },
  { type: "inspection", min: 25, median: 52, p90: 78, planned: 60 },
  { type: "maintenance", min: 60, median: 166, p90: 260, planned: 150 },
];

export const completionByComplexity: {
  complexity: TaskComplexity;
  onTime: number;
  late: number;
}[] = [
  { complexity: "low", onTime: 94, late: 6 },
  { complexity: "medium", onTime: 86, late: 14 },
  { complexity: "high", onTime: 71, late: 29 },
];
