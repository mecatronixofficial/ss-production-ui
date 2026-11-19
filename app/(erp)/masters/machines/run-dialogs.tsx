"use client";
import { entryDate } from "@/lib/entry-date";
import { EntryDateInput } from "@/components/ui/entry-date-input";

import { useMemo, useState } from "react";
import { ArrowRightLeft, CalendarCheck, Check, CheckCircle2, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { cn, errorMessage, formatDate, gsmText, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { Figure, KnitDialog } from "./knit-dialog";
import {
  currentShift,
  dayOf,
  decimals,
  EMPTY,
  greyStore,
  lastProductionDay,
  runOnDay,
  SHIFT_HOURS,
  SHIFT_LABEL,
  shiftIndex,
  shiftText,
  type KnitContext,
  type KnitMachine,
  type KnitRun,
  type OpenTask,
  type Shift,
} from "./types";

const num = (value: string) => Number(value || 0);
const isOpen = (machine: KnitMachine, busy: Set<string>) => !busy.has(machine.id) && (machine.status === "IDLE" || machine.status === "RUNNING");

function ShiftPicker({ value, onChange, label }: { value: Shift; onChange: (shift: Shift) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="knit-shift-picker">
      {(["DAY", "NIGHT"] as const).map((shift) => (
        <button key={shift} type="button" role="radio" aria-checked={value === shift} className={cn(value === shift && "is-active")} onClick={() => onChange(shift)}>
          <strong>{SHIFT_LABEL[shift]}</strong>
          <span>{SHIFT_HOURS[shift]}</span>
        </button>
      ))}
    </div>
  );
}

/** A knitting charge as typed: blank means 0, at most 2 decimals (the API's rule). */
const rateProblem = (value: string) =>
  value !== "" && !(Number(value) >= 0) ? "The knitting charge can't be below zero." : decimals(value) > 2 ? "Use up to 2 decimals for the knitting charge." : "";

/** A day's KG and rolls as typed; blank KG means the day isn't entered. */
function productionProblem(kgValue: string, rolls: string, label: string) {
  if (kgValue === "") return rolls !== "" ? `${label}: enter the KG with the rolls.` : "";
  if (!(num(kgValue) >= 0)) return `${label}: the KG can't be below zero.`;
  if (decimals(kgValue) > 3) return `${label}: use up to 3 decimals for the KG.`;
  if (rolls !== "" && !(Number.isInteger(num(rolls)) && num(rolls) >= 0)) return `${label}: rolls must be a whole number.`;
  return "";
}

/** How far a task has got: fabric knitted against the yarn given to it. */
export function TaskProgress({ knittedKg, yarnKg, compact = false }: { knittedKg: number; yarnKg: number; compact?: boolean }) {
  const pct = yarnKg > 0 ? Math.min(100, (knittedKg / yarnKg) * 100) : 0;
  return (
    <div className={cn("min-w-0", compact ? "w-40" : "")}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-700">{kg(knittedKg)} knitted</span>
        <span className="text-gray-500">{yarnKg > knittedKg ? `${kg(yarnKg - knittedKg)} left` : "all yarn knitted"}</span>
      </div>
      <div className="knit-loadbar mt-1.5"><span style={{ width: `${pct}%` }} /></div>
      {!compact && <p className="mt-1 text-[11px] text-gray-500">of {kg(yarnKg)} of yarn · {pct.toFixed(0)}%</p>}
    </div>
  );
}

/**
 * Putting a Production knitting task on one or more machines at once. Machines aren't loaded up to a capacity: each
 * one knits from the task's yarn, and what it knits is recorded at the end of every day. Production already
 * allocated the yarn, so nothing is taken from stock here.
 */
export function AssignMachinesDialog({
  context,
  busyMachines,
  tasks,
  taskId: initialTask,
  machineId: initialMachine,
  onClose,
  onAssigned,
  showPrices,
}: {
  context: KnitContext;
  /** Machines knitting a run now (they can't take another). */
  busyMachines: Set<string>;
  tasks: OpenTask[];
  taskId?: string;
  machineId?: string;
  onClose: () => void;
  onAssigned: (runs: KnitRun[]) => void;
  showPrices: boolean;
}) {
  const now = currentShift();
  const loadable = context.machines.filter((m) => isOpen(m, busyMachines));
  const [taskId, setTaskId] = useState(initialTask && tasks.some((t) => t.id === initialTask) ? initialTask : tasks.length === 1 ? tasks[0].id : "");
  const pickFor = (m: KnitMachine) => ({ operatorId: "", ratePerKg: m.ratePerKg ? String(m.ratePerKg) : "" });
  const [picks, setPicks] = useState<Record<string, { operatorId: string; ratePerKg: string }>>(() => {
    const first = loadable.find((m) => m.id === initialMachine);
    return first ? { [first.id]: pickFor(first) } : {};
  });
  const [f, setF] = useState(() => ({ startDate: entryDate(undefined, now.date), startShift: now.shift, notes: "" }));
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = tasks.find((t) => t.id === taskId);
  const chosen = loadable.filter((m) => picks[m.id]);
  const startsInFuture = shiftIndex(f.startDate, f.startShift) > shiftIndex(now.date, now.shift);

  const toggle = (m: KnitMachine) =>
    setPicks((current) => {
      const next = { ...current };
      if (next[m.id]) delete next[m.id];
      else next[m.id] = pickFor(m);
      return next;
    });
  const setPick = (id: string, changes: Partial<{ operatorId: string; ratePerKg: string }>) => setPicks((current) => ({ ...current, [id]: { ...current[id], ...changes } }));

  const assign = async () => {
    setError("");
    if (!task) return setError("Choose the knitting task.");
    if (!chosen.length) return setError("Choose at least one machine.");
    const badRate = chosen.map((m) => rateProblem(picks[m.id].ratePerKg)).find(Boolean);
    if (badRate) return setError(badRate);
    if (startsInFuture) return setError("The start shift is still to come; choose the shift the machines actually started.");
    setBusy(true);
    try {
      const runs = await api<KnitRun[]>(`/knitting/tasks/${task.id}/assign`, {
        method: "POST",
        body: JSON.stringify({
          startDate: f.startDate,
          startShift: f.startShift,
          notes: f.notes.trim() || undefined,
          machines: chosen.map((m) => ({
            machineId: m.id,
            operatorId: picks[m.id].operatorId || undefined,
            ratePerKg: showPrices ? Math.round(num(picks[m.id].ratePerKg) * 100) / 100 : undefined,
          })),
        }),
      });
      onAssigned(runs);
    } catch (e) {
      setError(errorMessage(e, "Could not start the machines"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={Layers}
      title={task ? `Put ${task.flowNo} on machines` : "Put a task on machines"}
      caption="Choose one or more free machines. No load limit: each machine knits from the task's yarn, and its KG and rolls are entered at the end of every day."
      wide
      busy={busy}
      onClose={onClose}
      onSubmit={() => void assign()}
      footer={
        <>
          <p className="mr-auto text-sm text-gray-600">{chosen.length ? <><strong>{chosen.length}</strong> machine{chosen.length === 1 ? "" : "s"} chosen</> : "No machine chosen"}</p>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy || !chosen.length || !task}>{busy ? "Starting…" : `Start knitting${chosen.length > 1 ? ` on ${chosen.length}` : ""}`}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      {tasks.length === 0 && <p className="knit-alert is-warn">No knitting tasks are open. Tasks are created on the Production page.</p>}

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Knitting task" className="md:col-span-3">
          <select className="erp-input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">{tasks.length ? "Select task" : "No task open"}</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.flowNo} · {t.fabricType ?? "Fabric"} · {kg(t.remainingKg)} left{t.running.length ? ` · on ${t.running.map((r) => r.machine.code).join(", ")}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date"><EntryDateInput max={now.date} value={f.startDate} onChange={(e) => set({ startDate: e.target.value || now.date })} /></Field>
        <div className="md:col-span-2">
          <span className="erp-label">Start shift</span>
          <ShiftPicker label="Start shift" value={f.startShift} onChange={(startShift) => set({ startShift })} />
        </div>
      </div>

      {task && (
        <section className="knit-panel">
          <p className="knit-panel__title">Task details</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Figure label="Yarn" value={task.yarnItemCode ?? task.yarnCount} note={`${kg(task.purchasedWeightKg)} for this task`} />
            <Figure label="Fabric" value={task.fabricType ?? "—"} note={[task.fabricDiameter, gsmText(task.fabricGsm), task.knittingGg, task.knittingLl].filter(Boolean).join(" · ") || "No extra specification"} />
          </div>
          <TaskProgress knittedKg={task.knittedKg} yarnKg={task.purchasedWeightKg} />
          {task.running.length > 0 && <p className="text-xs text-gray-600">Already knitting on {task.running.map((r) => r.machine.code).join(", ")}. The machines chosen here join them.</p>}
        </section>
      )}

      <section className="knit-panel">
        <p className="knit-panel__title">Machines <span>{loadable.length} free</span></p>
        {loadable.length === 0 ? (
          <p className="knit-alert is-warn">Every machine is knitting or out of service. Finish or move a run, or set a machine back to Idle.</p>
        ) : (
          <div className="knit-picks">
            {loadable.map((m) => {
              const pick = picks[m.id];
              return (
                <div key={m.id} className={cn("knit-pick", pick && "is-on")}>
                  <button type="button" role="checkbox" aria-checked={!!pick} className="knit-pick__toggle" onClick={() => toggle(m)}>
                    <span className="knit-pick__box">{pick && <Check size={13} strokeWidth={3} />}</span>
                    <span className="min-w-0 text-left">
                      <span className="block font-mono text-sm font-extrabold text-[#0f2a24]">{m.code}</span>
                      <span className="block truncate text-xs text-gray-500">{m.name}{m.type ? ` · ${m.type}` : ""}</span>
                    </span>
                  </button>
                  {pick && (
                    <div className="knit-pick__fields">
                      <select className="erp-input" aria-label={`Operator on ${m.code}`} value={pick.operatorId} onChange={(e) => setPick(m.id, { operatorId: e.target.value })}>
                        <option value="">Operator not recorded</option>
                        {context.operators.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.code}</option>)}
                      </select>
                      {showPrices && (
                        <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Knitting charge on ${m.code}, ₹ per KG`} placeholder="₹ / KG" value={pick.ratePerKg} onChange={(e) => setPick(m.id, { ratePerKg: e.target.value })} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Field label="Notes" hint="Optional"><Input value={f.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </KnitDialog>
  );
}

/** The day to enter by default: the last finished production day while any machine on it is still unrecorded, else today's. */
export function defaultEntryDay(runs: KnitRun[], now = new Date()) {
  const last = lastProductionDay(now);
  return runs.some((run) => runOnDay(run, last) && !dayOf(run, last)) ? last : currentShift(now).date;
}

type DayLine = { kg: string; rolls: string; yarn: string; notes: string };

/**
 * The day-end entry: for one production day (Day 9 AM – 9 PM and the Night after it), each machine's fabric KG and
 * rolls. Saving puts the fabric into the warehouse as grey fabric under each run's code. A day already entered
 * shows its figures and can be corrected here.
 */
export function DayEntryDialog({
  context,
  runs,
  runId,
  date: initialDate,
  minDate,
  onClose,
  onSaved,
}: {
  context: KnitContext;
  /** Every run; the ones on their machine that day are listed. */
  runs: KnitRun[];
  /** Only this run (from its own page or machine card). */
  runId?: string;
  date?: string;
  /** Earliest day the runs given cover. */
  minDate?: string;
  onClose: () => void;
  onSaved: (runs: KnitRun[], date: string) => void;
}) {
  const now = currentShift();
  const [date, setDate] = useState(() => initialDate ?? entryDate(undefined, defaultEntryDay(runId ? runs.filter((r) => r.id === runId) : runs.filter((r) => r.status === "RUNNING"))));
  const rows = useMemo(
    () => runs.filter((run) => (runId ? run.id === runId : runOnDay(run, date))).sort((a, b) => a.machine.code.localeCompare(b.machine.code)),
    [runs, runId, date],
  );
  const linesFor = (day: string): Record<string, DayLine> =>
    Object.fromEntries(
      runs.map((run) => {
        const saved = dayOf(run, day);
        return [
          run.id,
          saved
            ? { kg: String(saved.outputKg), rolls: String(saved.rollCount), yarn: saved.yarnUsedKg !== null && saved.yarnUsedKg !== undefined ? String(saved.yarnUsedKg) : "", notes: saved.notes ?? "" }
            : { kg: "", rolls: "", yarn: "", notes: "" },
        ];
      }),
    );
  const [lines, setLines] = useState<Record<string, DayLine>>(() => linesFor(date));
  const savedStore = rows.map((run) => dayOf(run, date)?.warehouse.id).find(Boolean);
  const [warehouseId, setWarehouseId] = useState(savedStore ?? greyStore(context.warehouses)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickDate = (value: string) => {
    const day = value || now.date;
    setDate(day);
    setLines(linesFor(day));
  };
  const setLine = (id: string, changes: Partial<DayLine>) => setLines((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  const entered = rows.filter((run) => lines[run.id]?.kg !== "");
  // Only new or corrected days are sent; a day saved as it is stays untouched in stock.
  const changed = entered.filter((run) => {
    const day = dayOf(run, date);
    const line = lines[run.id];
    const yarnBefore = day?.yarnUsedKg ?? null;
    const yarnNow = line.yarn.trim() === "" ? null : num(line.yarn);
    return (
      !day ||
      Math.abs(num(line.kg) - day.outputKg) > EMPTY ||
      num(line.rolls) !== day.rollCount ||
      (yarnBefore === null) !== (yarnNow === null) ||
      (yarnBefore !== null && yarnNow !== null && Math.abs(yarnBefore - yarnNow) > EMPTY) ||
      line.notes.trim() !== (day.notes ?? "") ||
      day.warehouse.id !== warehouseId
    );
  });
  const totalKg = entered.reduce((sum, run) => sum + num(lines[run.id].kg), 0);
  const totalRolls = entered.reduce((sum, run) => sum + num(lines[run.id].rolls), 0);
  // Yarn used: as entered, else as much as the fabric weighs.
  const totalYarn = entered.reduce((sum, run) => sum + (lines[run.id].yarn.trim() === "" ? num(lines[run.id].kg) : num(lines[run.id].yarn)), 0);
  const recorded = rows.filter((run) => dayOf(run, date)).length;

  const save = async () => {
    setError("");
    if (date > now.date) return setError("That production day is still to come.");
    if (!warehouseId) return setError("Choose the warehouse the fabric goes into.");
    const problem = rows.map((run) => productionProblem(lines[run.id]?.kg ?? "", lines[run.id]?.rolls ?? "", run.machine.code)).find(Boolean);
    if (problem) return setError(problem);
    if (!entered.length) return setError("Enter the KG for at least one machine.");
    if (!changed.length) return setError("Nothing changed for this day.");
    setBusy(true);
    try {
      const saved = await api<KnitRun[]>("/knitting/days", {
        method: "POST",
        body: JSON.stringify({
          date,
          warehouseId,
          entries: changed.map((run) => ({
            runId: run.id,
            outputKg: Math.round(num(lines[run.id].kg) * 1000) / 1000,
            rollCount: num(lines[run.id].rolls),
            yarnUsedKg: lines[run.id].yarn.trim() === "" ? undefined : Math.round(num(lines[run.id].yarn) * 1000) / 1000,
            notes: lines[run.id].notes.trim() || undefined,
          })),
        }),
      });
      onSaved(saved, date);
    } catch (e) {
      setError(errorMessage(e, "Could not save the day"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={CalendarCheck}
      tone="gold"
      title={`Day-end entry · ${formatDate(date)}`}
      caption="What each machine knitted this production day: Day shift 9 AM – 9 PM and the Night shift to 9 AM next morning. The fabric goes into stock as grey fabric under each run's code."
      wide
      busy={busy}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <p className="mr-auto text-sm">
            <strong>{kg(totalKg)}</strong> · {totalRolls} roll{totalRolls === 1 ? "" : "s"} · yarn {kg(totalYarn)} <span className="text-gray-500">from {entered.length} machine{entered.length === 1 ? "" : "s"}</span>
          </p>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy || !rows.length}>{busy ? "Saving…" : "Save day"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Production day" hint={date === lastProductionDay() ? "Yesterday's day + night" : date === now.date ? "Today's day + night" : undefined}>
          <span className="flex gap-1.5">
            <EntryDateInput min={minDate} max={now.date} value={date} onChange={(e) => pickDate(e.target.value)} />
            {!runId && date !== lastProductionDay() && <Button size="sm" variant="outline" className="h-auto shrink-0" onClick={() => pickDate(lastProductionDay())}>Yesterday</Button>}
          </span>
        </Field>
        <Field label="Into warehouse" className="md:col-span-2">
          <select className="erp-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Select warehouse</option>
            {context.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
      </div>

      {rows.length === 0 ? (
        <p className="knit-alert is-warn">No machine was knitting on {formatDate(date)}.</p>
      ) : (
        <>
          {recorded > 0 && <p className="knit-alert is-ok">{recorded} of {rows.length} machine{rows.length === 1 ? "" : "s"} already entered for this day; changing a figure replaces it.</p>}
          <div className="overflow-x-auto rounded-xl border">
            <table className="knit-table w-full min-w-[720px] text-sm">
              <thead><tr><th>Machine</th><th>Run · task</th><th className="w-32">Fabric KG</th><th className="w-20">Rolls</th><th className="w-32" title="The yarn the machine used today">Yarn used KG</th><th>Note</th></tr></thead>
              <tbody>
                {rows.map((run) => {
                  const line = lines[run.id] ?? { kg: "", rolls: "", yarn: "", notes: "" };
                  const saved = dayOf(run, date);
                  return (
                    <tr key={run.id}>
                      <td>
                        <span className="font-mono font-extrabold text-[#0f2a24]">{run.machine.code}</span>
                        {saved ? <span className="block text-[11px] font-semibold text-emerald-700">Entered</span> : <span className="block text-[11px] text-gray-400">Not entered</span>}
                      </td>
                      <td>
                        <span className="knit-code">{run.runNo}</span>
                        <span className="block text-xs text-gray-500">{run.fabricType ?? "Fabric"}{run.avgPerDayKg ? ` · about ${kg(run.avgPerDayKg)} a day` : ""}</span>
                      </td>
                      <td><WeightInput compact aria-label={`Fabric KG on ${run.machine.code}`} value={line.kg} onValueChange={(value) => setLine(run.id, { kg: value })} /></td>
                      <td><Input type="number" min="0" step="1" inputMode="numeric" aria-label={`Rolls on ${run.machine.code}`} value={line.rolls} onChange={(e) => setLine(run.id, { rolls: e.target.value })} /></td>
                      <td><WeightInput compact aria-label={`Yarn used on ${run.machine.code}`} placeholder={line.kg || "KG"} value={line.yarn} onValueChange={(value) => setLine(run.id, { yarn: value })} /></td>
                      <td><Input value={line.notes} maxLength={500} aria-label={`Note for ${run.machine.code}`} placeholder="Optional" onChange={(e) => setLine(run.id, { notes: e.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">Leave a machine blank to enter it later. Enter 0 KG for a day it stood still. Yarn used: leave blank to take it as the fabric&apos;s weight; the yarn not used stays at knitting and comes back to the warehouse when the task is complete.</p>
        </>
      )}
    </KnitDialog>
  );
}

/**
 * Stopping a machine: the finish day's production (unless already entered), then the run closes and the machine is
 * free. When it is the task's last machine, says whether the task's knitting is complete.
 */
export function FinishRunDialog({
  run,
  context,
  onClose,
  onFinished,
  showPrices,
}: {
  run: KnitRun;
  context: KnitContext;
  onClose: () => void;
  onFinished: (run: KnitRun) => void;
  showPrices: boolean;
}) {
  const now = currentShift();
  const finishEntryDate = entryDate(run.startedAt, now.date);
  const firstSaved = dayOf(run, finishEntryDate);
  const [f, setF] = useState({
    finishDate: finishEntryDate,
    finishShift: now.shift,
    outputKg: firstSaved ? String(firstSaved.outputKg) : "",
    rollCount: firstSaved ? String(firstSaved.rollCount) : "",
    warehouseId: firstSaved?.warehouse.id ?? run.warehouse?.id ?? greyStore(context.warehouses)?.id ?? "",
    ratePerKg: String(run.ratePerKg || ""),
    notes: "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const saved = dayOf(run, f.finishDate);
  const otherDays = run.days.filter((day) => day.date !== f.finishDate);
  const typed = f.outputKg === "" ? 0 : num(f.outputKg);
  const fabricKg = otherDays.reduce((sum, day) => sum + day.outputKg, 0) + typed;
  const rolls = otherDays.reduce((sum, day) => sum + day.rollCount, 0) + (f.outputKg === "" ? 0 : num(f.rollCount));
  const dayCount = otherDays.length + (f.outputKg === "" ? 0 : 1);
  const charge = fabricKg * num(f.ratePerKg);
  const later = otherDays.find((day) => day.date > f.finishDate);
  const beforeStart = !!f.finishDate && shiftIndex(f.finishDate, f.finishShift) < shiftIndex(run.startedAt, run.startShift);
  const inFuture = !!f.finishDate && shiftIndex(f.finishDate, f.finishShift) > shiftIndex(now.date, now.shift);

  const task = run.productionFlow;
  // The task's other machines, from the task itself (so this works from any page).
  const othersOnTask = task ? task.knittingRuns.filter((r) => r.id !== run.id && r.status === "RUNNING") : [];
  const taskKnitted = task ? task.knittedKg - (run.outputKg ?? 0) + fabricKg : 0;
  const lastOnTask = !!task && othersOnTask.length === 0;
  const nearlyAll = !!task && taskKnitted >= task.purchasedWeightKg - context.toleranceKg - EMPTY;
  const [completeTask, setCompleteTask] = useState<boolean | null>(null);
  const complete = completeTask ?? nearlyAll;
  const [yarnUsed, setYarnUsed] = useState("");
  const askYarn = !!task && lastOnTask && complete;

  const pickDate = (finishDate: string) => {
    const day = dayOf(run, finishDate);
    set({ finishDate, outputKg: day ? String(day.outputKg) : "", rollCount: day ? String(day.rollCount) : "", ...(day ? { warehouseId: day.warehouse.id } : {}) });
  };

  const finish = async () => {
    setError("");
    const problem = productionProblem(f.outputKg, f.rollCount, "Last day");
    if (problem) return setError(problem);
    if (dayCount === 0) return setError("Enter what the machine knitted on the last day; nothing is entered for this run yet.");
    if (f.outputKg !== "" && !f.warehouseId) return setError("Choose the warehouse the fabric goes into.");
    if (beforeStart) return setError(`${run.runNo} started on ${shiftText(run.startedAt, run.startShift)}; it can't stop before that.`);
    if (inFuture) return setError("The finish shift is still to come; choose the shift the machine stopped.");
    if (later) return setError(`${formatDate(later.date)} is already entered, after this finish date.`);
    const badRate = rateProblem(f.ratePerKg);
    if (badRate) return setError(badRate);
    if (askYarn && !(Number(yarnUsed) > 0)) return setError("Enter the yarn the task used: the rest goes back to the warehouse.");
    setBusy(true);
    try {
      const result = await api<KnitRun>(`/knitting/runs/${run.id}/finish`, {
        method: "POST",
        body: JSON.stringify({
          finishDate: f.finishDate,
          finishShift: f.finishShift,
          ...(f.outputKg !== "" ? { outputKg: Math.round(num(f.outputKg) * 1000) / 1000, rollCount: num(f.rollCount), warehouseId: f.warehouseId } : {}),
          ratePerKg: Math.round(num(f.ratePerKg) * 100) / 100,
          notes: f.notes.trim() || undefined,
          ...(lastOnTask ? { completeTask: complete } : {}),
          ...(askYarn ? { yarnUsedKg: Math.round(Number(yarnUsed) * 1000) / 1000 } : {}),
        }),
      });
      onFinished(result);
    } catch (e) {
      setError(errorMessage(e, "Could not finish the run"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={CheckCircle2}
      tone="blue"
      title={`Stop ${run.machine.code} · ${run.runNo}`}
      caption={`Knitting since ${shiftText(run.startedAt, run.startShift)}. Enter the last day if it isn't entered yet; the machine is then free for other work.`}
      wide
      busy={busy}
      onClose={onClose}
      onSubmit={() => void finish()}
      footer={
        <>
          <p className="mr-auto text-sm"><strong>{kg(fabricKg)}</strong> in {dayCount} day{dayCount === 1 ? "" : "s"}{showPrices ? <> · total <strong>{money(fabricKg * (run.yarns[0]?.ratePerKg ?? 0) + charge)}</strong></> : null}</p>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn is-blue" disabled={busy}>{busy ? "Saving…" : "Stop machine"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Finish date" error={beforeStart ? "Before the run started" : undefined}>
          <EntryDateInput min={run.startedAt.slice(0, 10)} max={now.date} value={f.finishDate} onChange={(e) => pickDate(e.target.value || now.date)} />
        </Field>
        <div className="md:col-span-2">
          <span className="erp-label">Finish shift</span>
          <ShiftPicker label="Finish shift" value={f.finishShift} onChange={(finishShift) => set({ finishShift })} />
        </div>
      </div>

      <section className="knit-panel">
        <p className="knit-panel__title">Production on {formatDate(f.finishDate)} <span>{saved ? "already entered; change it here if needed" : run.days.length ? "optional if nothing more came off" : "needed: nothing entered yet"}</span></p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Fabric KG" hint={run.avgPerDayKg ? `about ${kg(run.avgPerDayKg)} a day` : undefined}>
            <WeightInput value={f.outputKg} onValueChange={(outputKg) => set({ outputKg })} autoFocus={!saved} />
          </Field>
          <Field label="Rolls"><Input type="number" min="0" step="1" inputMode="numeric" value={f.rollCount} onChange={(e) => set({ rollCount: e.target.value })} /></Field>
          <Field label="Into warehouse">
            <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
              <option value="">Select warehouse</option>
              {context.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        {showPrices && (
          <Field label="Knitting charge" hint="₹ per KG of fabric" error={rateProblem(f.ratePerKg) || undefined}>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={f.ratePerKg} onChange={(e) => set({ ratePerKg: e.target.value })} />
          </Field>
        )}
        <Field label="Notes" hint="Optional" className={showPrices ? "md:col-span-2" : "md:col-span-3"}><Input value={f.notes} maxLength={1000} placeholder={run.notes ?? undefined} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>

      {task && (lastOnTask ? (
        <label className={cn("knit-check", complete && "is-on")}>
          <input type="checkbox" checked={complete} onChange={(e) => setCompleteTask(e.target.checked)} />
          <span>
            <strong>Knitting of {task.flowNo} is complete</strong>
            <span className="block text-xs text-gray-600">
              {kg(taskKnitted)} knitted of {kg(task.purchasedWeightKg)} of yarn{nearlyAll ? "." : `; ${kg(task.purchasedWeightKg - taskKnitted)} not knitted yet.`} {complete ? "Its grey fabric is then ready for dyeing." : "The task stays open to put on another machine."}
            </span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-gray-500">{task.flowNo} carries on on {othersOnTask.map((r) => r.machine.code).join(", ")}.</p>
      ))}
      {askYarn && task && <YarnUsedField givenKg={task.purchasedWeightKg} knittedKg={taskKnitted} value={yarnUsed} onChange={setYarnUsed} className="max-w-sm" strict={false} />}

      <div className="knit-figures">
        <Figure label="Days entered" value={dayCount} note={`since ${shiftText(run.startedAt, run.startShift)}`} />
        <Figure label="Fabric" value={kg(fabricKg)} note={dayCount ? `${kg(fabricKg / dayCount)} a day on average` : undefined} />
        <Figure label="Rolls" value={rolls} />
        {showPrices && <Figure label="Knitting charge" value={money(charge)} note={`${kg(fabricKg)} × ${money(num(f.ratePerKg))}`} />}
      </div>
    </KnitDialog>
  );
}

/**
 * Changing machine when one breaks down or needs repair: the run on it stops with what it knitted and the task
 * carries on on the new machine as its next run (a run with nothing knitted yet simply changes machine).
 */
export function MoveRunDialog({
  run,
  context,
  busyMachines,
  onClose,
  onMoved,
}: {
  run: KnitRun;
  context: KnitContext;
  busyMachines: Set<string>;
  onClose: () => void;
  onMoved: (run: KnitRun) => void;
}) {
  const now = currentShift();
  const targets = context.machines.filter((m) => m.id !== run.machine.id && isOpen(m, busyMachines));
  const today = dayOf(run, now.date);
  const [f, setF] = useState({
    machineId: targets[0]?.id ?? "",
    date: now.date,
    shift: now.shift,
    machineStatus: "BREAKDOWN" as "BREAKDOWN" | "MAINTENANCE" | "IDLE",
    outputKg: today ? String(today.outputKg) : "",
    rollCount: today ? String(today.rollCount) : "",
    warehouseId: today?.warehouse.id ?? run.warehouse?.id ?? greyStore(context.warehouses)?.id ?? "",
    operatorId: run.operator?.id ?? "",
    notes: "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = targets.find((m) => m.id === f.machineId);
  const beforeStart = shiftIndex(f.date, f.shift) < shiftIndex(run.startedAt, run.startShift);
  const inFuture = shiftIndex(f.date, f.shift) > shiftIndex(now.date, now.shift);
  const nothingYet = run.days.length === 0 && (f.outputKg === "" || num(f.outputKg) <= EMPTY);

  const pickDate = (date: string) => {
    const day = dayOf(run, date);
    set({ date, outputKg: day ? String(day.outputKg) : "", rollCount: day ? String(day.rollCount) : "" });
  };

  const move = async () => {
    setError("");
    if (!target) return setError("Choose the machine the work moves to.");
    const problem = productionProblem(f.outputKg, f.rollCount, run.machine.code);
    if (problem) return setError(problem);
    if (f.outputKg !== "" && !f.warehouseId) return setError("Choose the warehouse the fabric goes into.");
    if (beforeStart) return setError(`${run.runNo} started on ${shiftText(run.startedAt, run.startShift)}; it can't move before that.`);
    if (inFuture) return setError("That shift is still to come.");
    setBusy(true);
    try {
      const moved = await api<KnitRun>(`/knitting/runs/${run.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          machineId: target.id,
          date: f.date,
          shift: f.shift,
          machineStatus: f.machineStatus,
          ...(f.outputKg !== "" ? { outputKg: Math.round(num(f.outputKg) * 1000) / 1000, rollCount: num(f.rollCount), warehouseId: f.warehouseId } : {}),
          operatorId: f.operatorId || undefined,
          notes: f.notes.trim() || undefined,
        }),
      });
      onMoved(moved);
    } catch (e) {
      setError(errorMessage(e, "Could not change the machine"));
    } finally {
      setBusy(false);
    }
  };

  const statuses = [
    { value: "BREAKDOWN" as const, title: "Breakdown", text: "Needs repair" },
    { value: "MAINTENANCE" as const, title: "Maintenance", text: "Planned service" },
    { value: "IDLE" as const, title: "Idle", text: "Fine, just free it" },
  ];

  return (
    <KnitDialog
      icon={ArrowRightLeft}
      tone="gold"
      title={`Change machine · ${run.runNo}`}
      caption={`${run.machine.code} stops and ${run.productionFlow?.flowNo ?? "the task"} carries on on the machine chosen here.`}
      wide
      busy={busy}
      onClose={onClose}
      onSubmit={() => void move()}
      footer={
        <>
          <p className="mr-auto text-sm text-gray-600">{run.machine.code} → <strong>{target?.code ?? "—"}</strong></p>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy || !target}>{busy ? "Moving…" : "Change machine"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      {targets.length === 0 && <p className="knit-alert is-warn">No other machine is free. Stop a run or set a machine back to Idle first.</p>}

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Move to machine">
          <select className="erp-input" value={f.machineId} onChange={(e) => set({ machineId: e.target.value })}>
            {targets.length === 0 && <option value="">No machine free</option>}
            {targets.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </Field>
        <Field label="Date of the change"><EntryDateInput min={run.startedAt.slice(0, 10)} max={now.date} value={f.date} onChange={(e) => pickDate(e.target.value || now.date)} /></Field>
        <div>
          <span className="erp-label">From shift</span>
          <ShiftPicker label="Shift of the change" value={f.shift} onChange={(shift) => set({ shift })} />
        </div>
      </div>

      <div>
        <span className="erp-label">Set {run.machine.code} to</span>
        <div role="radiogroup" aria-label={`Set ${run.machine.code} to`} className="knit-shift-picker sm:grid-cols-3">
          {statuses.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={f.machineStatus === s.value} className={cn(f.machineStatus === s.value && "is-active")} onClick={() => set({ machineStatus: s.value })}>
              <strong>{s.title}</strong>
              <span>{s.text}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="knit-panel">
        <p className="knit-panel__title">{run.machine.code} on {formatDate(f.date)} before it stopped <span>{dayOf(run, f.date) ? "already entered" : "optional"}</span></p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Fabric KG"><WeightInput value={f.outputKg} onValueChange={(outputKg) => set({ outputKg })} /></Field>
          <Field label="Rolls"><Input type="number" min="0" step="1" inputMode="numeric" value={f.rollCount} onChange={(e) => set({ rollCount: e.target.value })} /></Field>
          <Field label="Into warehouse">
            <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
              <option value="">Select warehouse</option>
              {context.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-gray-500">
          {nothingYet
            ? `Nothing is entered for ${run.runNo} yet, so the same run simply moves to ${target?.code ?? "the new machine"}.`
            : `${run.runNo} stops with ${kg(run.days.filter((d) => d.date !== f.date).reduce((sum, d) => sum + d.outputKg, 0) + num(f.outputKg))} knitted; the task carries on as a new run on ${target?.code ?? "the new machine"}.`}
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={`Operator on ${target?.code ?? "the new machine"}`} hint="Optional">
          <select className="erp-input" value={f.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
            <option value="">Not recorded</option>
            {context.operators.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.code}</option>)}
          </select>
        </Field>
        <Field label="Reason" hint="Optional"><Input value={f.notes} maxLength={500} placeholder="e.g. needle bed broken" onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </KnitDialog>
  );
}

/**
 * The yarn a finished task used, out of what it was given; the rest goes back to the yarn's warehouse (200 given,
 * 50 used: 150 back), so the warehouse shows the balance again.
 */
export function YarnUsedField({
  givenKg,
  knittedKg,
  value,
  onChange,
  className,
  sharedWith,
  strict = true,
}: {
  givenKg: number;
  knittedKg: number;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Types sharing the yarn still knitting: the rest stays for them. */
  sharedWith?: string[];
  /** Whether more than `givenKg` is shown as an error here (the server checks a shared yarn either way). */
  strict?: boolean;
}) {
  const used = value === "" ? null : Number(value);
  const back = used === null ? null : Math.max(0, givenKg - used);
  const over = strict && used !== null && used > givenKg + EMPTY;
  return (
    <Field label="Yarn used (KG)" hint={`of ${kg(givenKg)} given`} error={over ? `Only ${kg(givenKg)} was given` : undefined} className={className}>
      <WeightInput value={value} onValueChange={onChange} placeholder={knittedKg > 0 ? `about ${Math.round(knittedKg)}` : "KG"} />
      <span className={cn("mt-1 block text-[11px] font-semibold", back && back > EMPTY ? "text-sky-700" : "text-gray-500")}>
        {sharedWith?.length
          ? `The rest stays for ${sharedWith.join(", ")}; what none uses goes back when the last finishes.`
          : back === null ? "The yarn not used goes back to its warehouse." : back > EMPTY ? `${kg(back)} goes back to the warehouse` : "All the yarn given was used"}
      </span>
    </Field>
  );
}

/** Completing a task whose machines have all stopped: the fabric knitted, and the yarn it used (the rest back to stock). */
export function CompleteTaskDialog({
  task,
  onClose,
  onCompleted,
}: {
  task: { id: string; flowNo: string; yarnItemCode: string | null; purchasedWeightKg: number; knittedKg: number; yarnUsedSoFarKg?: number; yarnAvailableKg?: number; yarnPool?: { sharedWith: string[]; othersOpen: number; totalKg: number } | null };
  onClose: () => void;
  onCompleted: (text: string) => void;
}) {
  // The yarn the machines' day-end entries say they used, to confirm or correct.
  const [yarnUsed, setYarnUsed] = useState(task.yarnUsedSoFarKg && task.yarnUsedSoFarKg > 0 ? String(task.yarnUsedSoFarKg) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fromStock = !!task.yarnItemCode;
  const pool = task.yarnPool ?? null;
  // Its own yarn, or what is left of the yarn it shares.
  const givenKg = task.yarnAvailableKg ?? task.purchasedWeightKg;
  const used = Number(yarnUsed);
  const back = pool && pool.othersOpen > 0 ? 0 : Math.max(0, givenKg - used);

  const complete = async () => {
    setError("");
    if (fromStock && !(used > 0)) return setError("Enter the yarn used: the rest goes back to the warehouse.");
    if (fromStock && used > givenKg + EMPTY) return setError(pool ? `Only ${kg(givenKg)} of the shared yarn is left for ${task.flowNo}.` : `Only ${kg(givenKg)} of yarn was given to ${task.flowNo}.`);
    setBusy(true);
    try {
      await api(`/knitting/tasks/${task.id}/complete`, { method: "POST", body: JSON.stringify({ complete: true, ...(fromStock ? { yarnUsedKg: Math.round(used * 1000) / 1000 } : {}) }) });
      onCompleted(`${task.flowNo}: knitting complete, ${kg(task.knittedKg)} of fabric${fromStock && back > EMPTY ? `; ${kg(back)} of ${task.yarnItemCode} back in the warehouse` : ""}.`);
    } catch (e) {
      setError(errorMessage(e, "Could not complete the task"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={CheckCircle2}
      tone="green"
      title={`Complete ${task.flowNo}`}
      caption="All its machines have stopped. Record the yarn used; the fabric is then ready for dyeing."
      busy={busy}
      onClose={onClose}
      onSubmit={() => void complete()}
      footer={
        <>
          <p className="mr-auto text-sm"><strong>{kg(task.knittedKg)}</strong> fabric{fromStock && used > 0 ? <> from <strong>{kg(used)}</strong> yarn</> : null}</p>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy}>{busy ? "Saving…" : "Complete knitting"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      <div className="knit-figures">
        <Figure label="Fabric made" value={kg(task.knittedKg)} note="from the machines' day entries" />
        <Figure label={pool ? "Shared yarn left" : "Yarn given"} value={kg(givenKg)} note={pool ? `of ${kg(pool.totalKg)} with ${pool.sharedWith.join(", ")}` : (task.yarnItemCode ?? undefined)} />
        {fromStock && (
          <Figure
            label="Back to warehouse"
            value={used > 0 ? kg(back) : "—"}
            note={pool && pool.othersOpen > 0 ? `the rest stays for ${pool.sharedWith.join(", ")}` : used > 0 ? `${kg(used)} used` : "enter the yarn used"}
          />
        )}
      </div>
      {fromStock ? (
        <YarnUsedField givenKg={givenKg} knittedKg={task.knittedKg} value={yarnUsed} onChange={setYarnUsed} sharedWith={pool && pool.othersOpen > 0 ? pool.sharedWith : undefined} />
      ) : (
        <p className="text-xs text-gray-500">This task&apos;s yarn was not taken from stock, so nothing goes back to a warehouse.</p>
      )}
    </KnitDialog>
  );
}
