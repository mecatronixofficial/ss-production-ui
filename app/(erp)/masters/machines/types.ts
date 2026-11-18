import type { MACHINE_STATUSES } from "@/lib/types";
import { formatDate, gsmText } from "@/lib/utils";

export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export type Shift = "DAY" | "NIGHT";

export type KnitMachine = {
  id: string;
  code: string;
  name: string;
  type: string | null;
  /** Knitting charge per KG of fabric. */
  ratePerKg: number;
  manufacturer: string | null;
  status: MachineStatus;
  /** Last change to the machine (its status, usually). */
  updatedAt?: string;
};

export type KnitOperator = { id: string; code: string; name: string; department: string; mobile?: string | null; shift?: string | null };

export type KnitContext = {
  machines: KnitMachine[];
  operators: KnitOperator[];
  warehouses: Array<{ id: string; code: string; name: string }>;
  /** Machines with a run knitting now. */
  busyMachineIds: string[];
  /** A task knitted to within this of its yarn counts as fully knitted. */
  toleranceKg: number;
};

/** A task's work on one machine, as listed on the task. */
export type TaskRun = { id: string; runNo: string; status: "RUNNING" | "FINISHED"; outputKg: number | null; machine: { id: string; code: string; name?: string } };

/** An own-mill Production task still being knitted: its fabric so far, the yarn left, and the machines on it now. */
export type OpenTask = {
  id: string;
  flowNo: string;
  yarnItemCode: string | null;
  yarnCount: string;
  yarnLotNo: string | null;
  purchasedWeightKg: number;
  fabricType: string | null;
  fabricDiameter: string | null;
  fabricGsm: string | null;
  color: string | null;
  knittingGg: string | null;
  knittingLl: string | null;
  knittingPartyDetails: string | null;
  knittingDate: string | null;
  knittingRuns: TaskRun[];
  knittedKg: number;
  remainingKg: number;
  /** Yarn its machines used so far, from their day-end entries. */
  yarnUsedSoFarKg?: number;
  /** The yarn it can still use: its own, or what is left of the yarn it shares with the types started with it. */
  yarnAvailableKg?: number;
  yarnPool?: { totalKg: number; sharedWith: string[]; usedByOthersKg: number; othersOpen: number; leftForThisKg: number } | null;
  running: TaskRun[];
};

/** `/knitting/board`: everything the Machines floor shows, in one request. */
export type KnitBoard = KnitContext & {
  tasks: OpenTask[];
  /** Runs knitting now and runs stopped since `since`. */
  runs: KnitRun[];
  since: string;
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
  /** Share of the yarn, %. */
  sharePct: number;
};

/** What one machine knitted on one production day (Day 9 AM – 9 PM, then Night to 9 AM), recorded at day end. */
export type KnitDay = {
  id: string;
  /** YYYY-MM-DD, the production day's Day shift date. */
  date: string;
  outputKg: number;
  rollCount: number;
  /** The yarn the machine used that day (null: taken as the fabric's weight). */
  yarnUsedKg?: number | null;
  warehouse: { id: string; code: string; name: string };
  notes: string | null;
};

/**
 * A task's work on one machine, from start until the machine stops or the work moves to another machine. Its code
 * is also the grey fabric's item code in stock.
 */
export type KnitRun = {
  id: string;
  runNo: string;
  status: "RUNNING" | "FINISHED";
  fabricType: string | null;
  startedAt: string;
  startShift: Shift;
  finishedAt: string | null;
  finishShift: Shift | null;
  /** Why it stopped when the work went on elsewhere, e.g. "Moved to KN-03 · breakdown". */
  endReason: string | null;
  operator: { id: string; code: string; name: string } | null;
  machine: { id: string; code: string; name: string; type: string | null };
  /** Where its latest fabric went. */
  warehouse: { id: string; code: string; name: string } | null;
  productionFlow: {
    id: string;
    flowNo: string;
    purchasedWeightKg: number;
    yarnCount: string;
    color: string | null;
    fabricDiameter: string | null;
    fabricGsm: string | null;
    knittingGg: string | null;
    knittingLl: string | null;
    knittingFinishedAt: string | null;
    /** Fabric knitted on the whole task, every machine. */
    knittedKg: number;
    knittingRuns: TaskRun[];
  } | null;
  /** The task's yarn used so far (as much as the fabric weighs). */
  yarnKg: number;
  yarnCost: number;
  ratePerKg: number;
  outputKg: number | null;
  knittingCharge: number | null;
  /** Yarn cost + knitting charge. */
  totalCost: number;
  costPerKg: number | null;
  /** Shifts from start to finish, both counted. */
  shifts: number | null;
  rollCount: number | null;
  notes: string | null;
  yarns: RunYarn[];
  /** Newest first. */
  days: KnitDay[];
  avgPerDayKg: number | null;
};

/** A run's own page. Codes go in the query (a task's run is e.g. 01SS26-KT01-R2). */
export const runHref = (code: string) => `/masters/machines/run?code=${encodeURIComponent(code)}`;

/** A machine's own page: its details, current run and every run it has knitted. */
export const machineHref = (id: string) => `/masters/machines/${id}`;

/** `YYYY-MM` of today in local time (an ISO string would give the UTC month just after midnight on the 1st). */
export const localMonth = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

/** Decimal places typed into a number field. */
export const decimals = (value: string) => (value.split(".")[1] ?? "").length;

export const SHIFT_LABEL: Record<Shift, string> = { DAY: "Day", NIGHT: "Night" };
export const SHIFT_HOURS: Record<Shift, string> = { DAY: "9 AM – 9 PM", NIGHT: "9 PM – 9 AM" };
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

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return inputDate(d);
}

/** The production day that ended last (yesterday's Day + Night shifts, once today's Day shift has begun). */
export const lastProductionDay = (now = new Date()) => addDays(currentShift(now).date, -1);

/** "29 Sept 2026 · Day" */
export const shiftText = (date: string | null, shift: Shift | null) => (date ? `${formatDate(date)}${shift ? ` · ${SHIFT_LABEL[shift]}` : ""}` : "—");

/** Shifts in order; the day's Day shift comes before its Night shift. */
export const shiftIndex = (date: string, shift: Shift) => Math.floor(Date.parse(date.slice(0, 10)) / 86_400_000) * 2 + (shift === "NIGHT" ? 1 : 0);

/** A run finished in one go before day entries: its weight came off at the finish, so it takes no days. */
export const finishedInOneGo = (run: KnitRun) => run.status === "FINISHED" && run.days.length === 0;

/** Whether a run was on its machine during a production day (started by then, not stopped before it) and takes day entries. */
export const runOnDay = (run: KnitRun, date: string) =>
  !finishedInOneGo(run) && run.startedAt.slice(0, 10) <= date && (!run.finishedAt || run.finishedAt.slice(0, 10) >= date);

/** Production days a run has been on its machine, counting today's. */
export function daysOnMachine(run: KnitRun, today = currentShift().date) {
  const end = run.finishedAt?.slice(0, 10) ?? today;
  return Math.max(1, Math.round((Date.parse(end) - Date.parse(run.startedAt.slice(0, 10))) / 86_400_000) + 1);
}

/** The day's entry of a run, if recorded. */
export const dayOf = (run: KnitRun, date: string) => run.days.find((day) => day.date === date);

/** KG and rolls of every machine on one production day. */
export function dayTotals(runs: KnitRun[], date: string) {
  const rows = runs.flatMap((run) => run.days.filter((day) => day.date === date));
  return { machines: rows.length, kg: rows.reduce((sum, day) => sum + day.outputKg, 0), rolls: rows.reduce((sum, day) => sum + day.rollCount, 0) };
}

/** Fabric knitted in a month: day entries of that month, plus runs from before day entries by the month they finished. */
export const monthKg = (runs: KnitRun[], month: string) =>
  runs.reduce(
    (sum, r) =>
      sum +
      (r.days.length
        ? r.days.filter((d) => d.date.slice(0, 7) === month).reduce((s, d) => s + d.outputKg, 0)
        : r.status === "FINISHED" && r.finishedAt?.slice(0, 7) === month
          ? (r.outputKg ?? 0)
          : 0),
    0,
  );

/** The warehouse grey fabric normally goes into. */
export const greyStore = (warehouses: KnitContext["warehouses"]) => warehouses.find((w) => /GREY|FABRIC/i.test(`${w.code} ${w.name}`)) ?? warehouses[0];

/** When a shift begins, in local time: Day at 9 AM, Night at 9 PM of its date. */
export const shiftStart = (date: string, shift: Shift) => new Date(`${date.slice(0, 10)}T${shift === "DAY" ? "09" : "21"}:00:00`);

/** How long, roughly: "3d 4h", "5h 20m", "12m". */
export function elapsedText(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** Where a machine stands on the floor. A machine marked for repair or service counts as that even if a run is still on it. */
export type FloorState = "running" | "stopped" | "repair" | "maintenance";
export const FLOOR_LABEL: Record<FloorState, string> = { running: "Running", stopped: "Stopped", repair: "Repair", maintenance: "Maintenance" };
export const floorState = (machine: KnitMachine, run: KnitRun | undefined): FloorState =>
  machine.status === "BREAKDOWN" ? "repair" : machine.status === "MAINTENANCE" ? "maintenance" : run ? "running" : "stopped";

/** The fabric to knit, in one line: type · dia · GSM · GG · LL · colour. */
export const fabricSpec = (f: { fabricType?: string | null; fabricDiameter?: string | null; fabricGsm?: string | null; knittingGg?: string | null; knittingLl?: string | null; color?: string | null }) =>
  [f.fabricType, f.fabricDiameter && `${f.fabricDiameter} dia`, gsmText(f.fabricGsm), f.knittingGg && `${f.knittingGg} GG`, f.knittingLl && `LL ${f.knittingLl}`, f.color].filter(Boolean).join(" · ");
