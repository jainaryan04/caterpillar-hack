import type { TaskType } from "@/lib/types";

/** The Mining site's four real task types, plus the two the model supports
 * but this roster's Mining tasks never use (dozing, grading — see
 * lib/status.ts BACKEND_TASK_TYPE) and the two housekeeping types with no
 * backend equivalent (inspection, maintenance — filters/pickers only). */
export const TASK_TYPES: TaskType[] = [
  "excavation",
  "hauling",
  "loading",
  "drilling",
  "grading",
  "dozing",
  "inspection",
  "maintenance",
];
