import type { MACHINE_STATUSES } from "@/lib/types";
import { formatDate, kg } from "@/lib/utils";

export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export type Shift = "DAY" | "NIGHT";

export type KnitMachine = {
  id: string;
  code: string;
  name: string;
  type: string | null;
  /** Yarn one load takes (240 KG unless set for the machine). */
  capacityKg: number;
  /** Knitting charge per KG of fabric. */
  ratePerKg: number;
  manufacturer: string | null;
  status: MachineStatus;
};

/** Yarn in stock that can be loaded, by item code, warehouse and lot, with its last purchase price. */
export type YarnStock = {
  category: string;
  itemCode: string;
  itemName: string;
  lotNo: string | null;
  warehouseId: string;
  unit: string;
  balanceKg: number;
  lastRate: number | null;
};

export type KnitContext = {
  machines: KnitMachine[];
  operators: Array<{ id: string; code: string; name: string; department: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  yarnStock: YarnStock[];
  fabricTypes: string[];
  /** Fabric normally comes off within this of the yarn loaded. */
  toleranceKg: number;
  defaultCapacityKg: number;
};

export type RunYarn = {
  id: string;
  itemCode: string;
  itemName: string;
  lotNo: string | null;
  warehouse: { code: string; name: string };
  kg: number;
  ratePerKg: number;
  cost: number;
  /** Share of the yarn loaded, %. */
  sharePct: number;
};

/** One load of yarn knitted on a machine; its code is also the grey fabric's item code in stock. */
export type KnitRun = {
  id: string;
  runNo: string;
  status: "RUNNING" | "FINISHED";
  fabricType: string | null;
  startedAt: string;
  startShift: Shift;
  finishedAt: string | null;
  finishShift: Shift | null;
  operator: { id: string; code: string; name: string } | null;
  machine: { id: string; code: string; name: string; type: string | null; capacityKg: number };
  warehouse: { id: string; code: string; name: string } | null;
  yarnKg: number;
  yarnCost: number;
  ratePerKg: number;
  outputKg: number | null;
  knittingCharge: number | null;
  changeKg: number | null;
  expectedMinKg: number;
  expectedMaxKg: number;
  /** Yarn cost + knitting charge. */
  totalCost: number;
  costPerKg: number | null;
  /** Shifts from start to finish, both counted. */
  shifts: number | null;
  rollCount: number | null;
  notes: string | null;
  yarns: RunYarn[];
};

/** A Production knitting task (batch) still to be put on machines, from `/production/fabric-flows`. */
export type ProductionTask = {
  id: string;
  flowNo: string;
  status: string;
  yarnItemCode: string | null;
  yarnCount: string;
  purchasedWeightKg: number;
  yarnRatePerKg: number;
  fabricType: string | null;
  fabricDiameter: string | null;
  fabricGsm: string | null;
  knittingGg: string | null;
  knittingLl: string | null;
  knittingMillDetails: string | null;
  knittingPartyDetails: string | null;
  knittingDate: string | null;
  knittingExpectedFinishDate: string | null;
  knittingDeliveryKg: number | null;
  knittingFinishedAt: string | null;
  knittingRuns: Array<{ id: string; status: "RUNNING" | "FINISHED"; yarnKg: number | string; outputKg: number | string | null; machine: { code: string; name: string } }>;
};
/** A task with the yarn not yet put on a machine. */
export type OpenTask = ProductionTask & { remainingKg: number };

/** Yarn of a task already loaded on machines. */
export const allocatedKg = (task: ProductionTask) => task.knittingRuns.reduce((sum, run) => sum + Number(run.yarnKg), 0);

/**
 * Tasks still to be knitted. A batch stays KNITTING after knitting finishes (its grey fabric waiting for or at
 * dyeing); those, like dyed fabric, are no longer machine work.
 */
export const openTasks = (tasks: ProductionTask[]): OpenTask[] =>
  tasks
    .filter((task) => task.status === "KNITTING" && task.knittingFinishedAt === null && allocatedKg(task) < task.purchasedWeightKg - EMPTY)
    .map((task) => ({ ...task, remainingKg: Math.max(0, task.purchasedWeightKg - allocatedKg(task)) }));

/** A run's own page. Codes go in the query (a task's run is e.g. SS-2026-004-R2). */
export const runHref = (code: string) => `/masters/machines/run?code=${encodeURIComponent(code)}`;

/** A machine's own page: its details, current run and every run it has knitted. */
export const machineHref = (id: string) => `/masters/machines/${id}`;

/** `YYYY-MM` of today in local time (an ISO string would give the UTC month just after midnight on the 1st). */
export const localMonth = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

/** Decimal places typed into a number field. */
export const decimals = (value: string) => (value.split(".")[1] ?? "").length;

export const SHIFT_LABEL: Record<Shift, string> = { DAY: "Day", NIGHT: "Night" };
export const SHIFT_HOURS: Record<Shift, string> = { DAY: "9 AM – 9 PM", NIGHT: "9 PM – 9 AM" };
export const MAX_YARNS = 3;
export const EMPTY = 0.0005;

const inputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The shift running now and the date it belongs to (after midnight, the night shift still belongs to the day before). */
export function currentShift(now = new Date()): { date: string; shift: Shift } {
  const hour = now.getHours();
  if (hour >= 9 && hour < 21) return { date: inputDate(now), shift: "DAY" };
  if (hour >= 21) return { date: inputDate(now), shift: "NIGHT" };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return { date: inputDate(yesterday), shift: "NIGHT" };
}

/** "29 Sept 2026 · Day" */
export const shiftText = (date: string | null, shift: Shift | null) => (date ? `${formatDate(date)}${shift ? ` · ${SHIFT_LABEL[shift]}` : ""}` : "—");

/** Shifts in order; the day's Day shift comes before its Night shift. */
export const shiftIndex = (date: string, shift: Shift) => Math.floor(Date.parse(date.slice(0, 10)) / 86_400_000) * 2 + (shift === "NIGHT" ? 1 : 0);

/** How the fabric weight compares with the yarn loaded: within the normal range, or outside it (allowed, pointed out). */
export function outputCheck(yarnKg: number, outputKg: number, toleranceKg: number) {
  if (!(yarnKg > 0) || !(outputKg > 0)) return { diff: 0, outside: false, message: null as string | null };
  const diff = outputKg - yarnKg;
  const outside = Math.abs(diff) > toleranceKg + EMPTY;
  const range = `${kg(Math.max(0, yarnKg - toleranceKg))} – ${kg(yarnKg + toleranceKg)}`;
  return {
    diff,
    outside,
    message: outside ? `${kg(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the yarn loaded; normally ${range}. Check the weight.` : `Within the normal ${range}`,
  };
}

export const stockKey = (row: Pick<YarnStock, "itemCode" | "warehouseId" | "lotNo">) => [row.itemCode, row.warehouseId, row.lotNo ?? ""].join("|");
