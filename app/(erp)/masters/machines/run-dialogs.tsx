"use client";

import { useState } from "react";
import { CheckCircle2, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { cn, errorMessage, gsmText, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { Figure, KnitDialog } from "./knit-dialog";
import {
  currentShift,
  decimals,
  EMPTY,
  outputCheck,
  SHIFT_HOURS,
  SHIFT_LABEL,
  shiftIndex,
  shiftText,
  type KnitContext,
  type KnitRun,
  type OpenTask,
  type Shift,
} from "./types";

const num = (value: string) => Number(value || 0);

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

/** Weight going in against the machine's capacity. */
function LoadBar({ loaded, capacity }: { loaded: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, (loaded / capacity) * 100) : 0;
  const over = loaded > capacity + EMPTY;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-600">Loaded {kg(loaded)} of {kg(capacity)}</span>
        <span className={cn("font-bold", over ? "text-red-600" : "text-gray-500")}>{over ? `${kg(loaded - capacity)} over capacity` : `${kg(Math.max(0, capacity - loaded))} free`}</span>
      </div>
      <div className={cn("knit-loadbar mt-1.5", over && "is-over")}><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** A knitting charge as typed: blank means 0, at most 2 decimals (the API's rule). */
const rateProblem = (value: string) =>
  value !== "" && !(Number(value) >= 0) ? "The knitting charge can't be below zero." : decimals(value) > 2 ? "Use up to 2 decimals for the knitting charge." : "";

/**
 * Putting a Production knitting task on a machine. The yarn was already allocated to the task by Production, so it
 * isn't taken from stock again; one task can run over several machine rounds (…-R1, -R2) until all its yarn is loaded.
 * Opened from a task (task chosen) or from an idle machine (machine chosen); the other is picked here.
 */
export function StartRunDialog({
  context,
  busyMachines,
  tasks,
  taskId: initialTask,
  machineId: initialMachine,
  onClose,
  onStarted,
  showPrices,
}: {
  context: KnitContext;
  /** Machines knitting a run now (they can't take another). */
  busyMachines: Set<string>;
  tasks: OpenTask[];
  taskId?: string;
  machineId?: string;
  onClose: () => void;
  onStarted: (run: KnitRun) => void;
  showPrices: boolean;
}) {
  const now = currentShift();
  const loadable = context.machines.filter((m) => !busyMachines.has(m.id) && (m.status === "IDLE" || m.status === "RUNNING"));
  const [taskId, setTaskId] = useState(initialTask && tasks.some((t) => t.id === initialTask) ? initialTask : tasks.length === 1 ? tasks[0].id : "");
  const [machineId, setMachineId] = useState(initialMachine && loadable.some((m) => m.id === initialMachine) ? initialMachine : loadable[0]?.id ?? "");
  const task = tasks.find((t) => t.id === taskId);
  const machine = context.machines.find((m) => m.id === machineId);
  const capacity = machine?.capacityKg ?? context.defaultCapacityKg;
  const roundKg = (t: OpenTask | undefined, cap: number) => (t ? String(Math.round(Math.min(t.remainingKg, cap) * 1000) / 1000) : "");
  const [yarnKg, setYarnKg] = useState(roundKg(task, capacity));
  const [f, setF] = useState({ startDate: now.date, startShift: now.shift, operatorId: "", ratePerKg: machine?.ratePerKg ? String(machine.ratePerKg) : "", notes: "" });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const totalKg = num(yarnKg);
  const maxKg = task ? Math.min(task.remainingKg, capacity) : capacity;
  const yarnCost = task ? totalKg * task.yarnRatePerKg : 0;
  const rate = num(f.ratePerKg);
  const charge = totalKg * rate;
  const startsInFuture = shiftIndex(f.startDate, f.startShift) > shiftIndex(now.date, now.shift);

  const pickTask = (id: string) => {
    setTaskId(id);
    setYarnKg(roundKg(tasks.find((t) => t.id === id), capacity));
  };
  const pickMachine = (id: string) => {
    setMachineId(id);
    const picked = context.machines.find((m) => m.id === id);
    set({ ratePerKg: picked?.ratePerKg ? String(picked.ratePerKg) : "" });
    if (picked) setYarnKg(roundKg(task, picked.capacityKg));
  };

  const start = async () => {
    setError("");
    if (!task) return setError("Choose the knitting task to start.");
    if (!machine) return setError("Choose the machine to load.");
    if (!(totalKg > 0)) return setError("Enter the KG of yarn for this machine round.");
    if (decimals(yarnKg) > 3) return setError("Use up to 3 decimals for the KG.");
    if (totalKg > task.remainingKg + EMPTY) return setError(`Only ${kg(task.remainingKg)} is left on ${task.flowNo}.`);
    if (totalKg > capacity + EMPTY) return setError(`${machine.code} takes at most ${kg(capacity)} per load.`);
    const badRate = rateProblem(f.ratePerKg);
    if (badRate) return setError(badRate);
    if (startsInFuture) return setError("The start shift is still to come; choose the shift the machine actually started.");
    setBusy(true);
    try {
      const run = await api<KnitRun>("/knitting/runs", {
        method: "POST",
        body: JSON.stringify({
          machineId: machine.id,
          productionFlowId: task.id,
          productionYarnKg: Math.round(totalKg * 1000) / 1000,
          startDate: f.startDate,
          startShift: f.startShift,
          operatorId: f.operatorId || undefined,
          ratePerKg: Math.round(rate * 100) / 100,
          notes: f.notes.trim() || undefined,
        }),
      });
      onStarted(run);
    } catch (e) {
      setError(errorMessage(e, "Could not start the machine"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={Layers}
      title={task ? `Start ${task.flowNo}` : "Start a knitting task"}
      caption="Choose a free machine and operator. Production already allocated the yarn, so it isn't taken from stock again."
      wide
      busy={busy}
      onClose={onClose}
      onSubmit={() => void start()}
      footer={
        <>
          {showPrices && <p className="mr-auto text-sm">Estimated total <strong>{money(yarnCost + charge)}</strong></p>}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy || loadable.length === 0 || tasks.length === 0}>{busy ? "Starting…" : "Start knitting"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      {loadable.length === 0 && <p className="knit-alert is-warn">Every machine is knitting or out of service. Finish a run, or set a machine back to Idle.</p>}
      {tasks.length === 0 && <p className="knit-alert is-warn">No knitting tasks are waiting. Tasks are created on the Production page.</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Knitting task">
          <select className="erp-input" value={taskId} onChange={(e) => pickTask(e.target.value)}>
            <option value="">{tasks.length ? "Select task" : "No task waiting"}</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.flowNo} · {t.fabricType ?? "Fabric"} · {kg(t.remainingKg)} left
              </option>
            ))}
          </select>
        </Field>
        <Field label="Machine">
          <select className="erp-input" value={machineId} onChange={(e) => pickMachine(e.target.value)}>
            {loadable.length === 0 && <option value="">No machine free</option>}
            {loadable.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({kg(m.capacityKg)})</option>)}
          </select>
        </Field>
        <Field label="Start date"><Input type="date" max={now.date} value={f.startDate} onChange={(e) => set({ startDate: e.target.value || now.date })} /></Field>
        <div>
          <span className="erp-label">Start shift</span>
          <ShiftPicker label="Start shift" value={f.startShift} onChange={(startShift) => set({ startShift })} />
        </div>
      </div>

      {task && (
        <section className="knit-panel">
          <p className="knit-panel__title">Task details</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Figure label="Yarn" value={task.yarnItemCode ?? task.yarnCount} note={`${kg(task.remainingKg)} left of ${kg(task.purchasedWeightKg)}${task.knittingRuns.length ? ` · ${task.knittingRuns.length} round${task.knittingRuns.length === 1 ? "" : "s"} so far` : ""}`} />
            <Figure label="Fabric" value={task.fabricType ?? "—"} note={[task.fabricDiameter, gsmText(task.fabricGsm), task.knittingGg, task.knittingLl].filter(Boolean).join(" · ") || "No extra specification"} />
          </div>
          <div className="mt-3">
            <Field label="KG for this machine round" hint={`max ${kg(maxKg)}`}>
              <span className="flex gap-1.5">
                <WeightInput wrapperClassName="flex-1" value={yarnKg} onValueChange={setYarnKg} />
                <Button size="sm" variant="outline" className="h-auto shrink-0" onClick={() => setYarnKg(String(Math.round(maxKg * 1000) / 1000))}>Max</Button>
              </span>
            </Field>
          </div>
          {totalKg > 0 && totalKg < task.remainingKg - EMPTY && (
            <p className="mt-2 text-xs text-gray-500">{kg(task.remainingKg - totalKg)} stays on the task for another machine round.</p>
          )}
          <div className="mt-3"><LoadBar loaded={totalKg} capacity={capacity} /></div>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Operator" hint="Optional">
          <select className="erp-input" value={f.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
            <option value="">Not recorded</option>
            {context.operators.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.code}</option>)}
          </select>
        </Field>
        {showPrices && (
          <Field label="Knitting charge" hint="₹ per KG of fabric" error={rateProblem(f.ratePerKg) || undefined}>
            <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={f.ratePerKg} onChange={(e) => set({ ratePerKg: e.target.value })} />
          </Field>
        )}
        <Field label="Notes" hint="Optional" className={showPrices ? "" : "md:col-span-2"}><Input value={f.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>

      <div className="knit-figures">
        <Figure label="Yarn loaded" value={kg(totalKg)} note={task?.yarnItemCode ?? (task ? task.yarnCount : "Choose a task")} />
        <Figure label="Fabric to expect" value={totalKg > 0 ? `${kg(Math.max(0, totalKg - context.toleranceKg))} – ${kg(totalKg + context.toleranceKg)}` : "—"} note={`About the same weight, ±${context.toleranceKg} KG`} />
        {showPrices && <Figure label="Estimated total" value={money(yarnCost + charge)} note={`Yarn ${money(yarnCost)} + knitting ${money(charge)}`} />}
        {showPrices && <Figure label="Estimated cost per KG" value={totalKg > 0 ? money((yarnCost + charge) / totalKg) : "—"} note="If the fabric weighs the same as the yarn" />}
      </div>
    </KnitDialog>
  );
}

/**
 * Taking the fabric off: its weight (compared with the yarn loaded), rolls and the warehouse it goes into as grey
 * fabric under the run's code, with the final total.
 */
export function FinishRunDialog({ run, context, onClose, onFinished, showPrices }: { run: KnitRun; context: KnitContext; onClose: () => void; onFinished: (run: KnitRun) => void; showPrices: boolean }) {
  const now = currentShift();
  const greyStore = context.warehouses.find((w) => /GREY|FABRIC/i.test(`${w.code} ${w.name}`)) ?? context.warehouses[0];
  const [f, setF] = useState({
    finishDate: now.date,
    finishShift: now.shift,
    outputKg: String(run.yarnKg),
    rollCount: "",
    warehouseId: greyStore?.id ?? "",
    ratePerKg: String(run.ratePerKg || ""),
    notes: "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const output = num(f.outputKg);
  const check = outputCheck(run.yarnKg, output, context.toleranceKg);
  const charge = output * num(f.ratePerKg);
  const total = run.yarnCost + charge;
  const beforeStart = !!f.finishDate && shiftIndex(f.finishDate, f.finishShift) < shiftIndex(run.startedAt, run.startShift);
  const inFuture = !!f.finishDate && shiftIndex(f.finishDate, f.finishShift) > shiftIndex(now.date, now.shift);

  const finish = async () => {
    setError("");
    if (!(output > 0)) return setError("Enter the fabric weight taken off.");
    if (decimals(f.outputKg) > 3) return setError("Use up to 3 decimals for the fabric weight.");
    if (f.rollCount !== "" && !(Number.isInteger(num(f.rollCount)) && num(f.rollCount) >= 0)) return setError("Rolls must be a whole number.");
    if (!f.warehouseId) return setError("Choose the warehouse the fabric goes into.");
    if (beforeStart) return setError(`${run.runNo} started on ${shiftText(run.startedAt, run.startShift)}; it can't finish before that.`);
    if (inFuture) return setError("The finish shift is still to come; choose the shift the fabric was taken off.");
    const badRate = rateProblem(f.ratePerKg);
    if (badRate) return setError(badRate);
    setBusy(true);
    try {
      const saved = await api<KnitRun>(`/knitting/runs/${run.id}/finish`, {
        method: "POST",
        body: JSON.stringify({
          finishDate: f.finishDate,
          finishShift: f.finishShift,
          outputKg: Math.round(output * 1000) / 1000,
          rollCount: f.rollCount === "" ? undefined : num(f.rollCount),
          warehouseId: f.warehouseId,
          ratePerKg: Math.round(num(f.ratePerKg) * 100) / 100,
          notes: f.notes.trim() || undefined,
        }),
      });
      onFinished(saved);
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
      title={`Finish ${run.runNo}`}
      caption={`${run.machine.code} · ${kg(run.yarnKg)} of yarn loaded on ${shiftText(run.startedAt, run.startShift)}. The fabric goes into stock as ${run.runNo} (grey fabric).`}
      wide
      busy={busy}
      onClose={onClose}
      onSubmit={() => void finish()}
      footer={
        <>
          {showPrices && <p className="mr-auto text-sm">Final total <strong>{money(total)}</strong></p>}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn is-blue" disabled={busy}>{busy ? "Saving…" : "Finish & put into stock"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Finish date" error={beforeStart ? "Before the run started" : undefined}>
          <Input type="date" min={run.startedAt.slice(0, 10)} max={now.date} value={f.finishDate} onChange={(e) => set({ finishDate: e.target.value || now.date })} />
        </Field>
        <div className="md:col-span-2">
          <span className="erp-label">Finish shift</span>
          <ShiftPicker label="Finish shift" value={f.finishShift} onChange={(finishShift) => set({ finishShift })} />
        </div>
        <Field label="Fabric weight" hint={`KG · normally ${kg(run.expectedMinKg)} – ${kg(run.expectedMaxKg)}`}>
          <WeightInput value={f.outputKg} onValueChange={(outputKg) => set({ outputKg })} autoFocus />
        </Field>
        <Field label="Rolls" hint="Optional"><Input type="number" min="0" step="1" inputMode="numeric" value={f.rollCount} onChange={(e) => set({ rollCount: e.target.value })} /></Field>
        <Field label="Into warehouse">
          <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
            <option value="">Select warehouse</option>
            {context.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        {showPrices && (
          <Field label="Knitting charge" hint="₹ per KG of fabric" error={rateProblem(f.ratePerKg) || undefined}>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={f.ratePerKg} onChange={(e) => set({ ratePerKg: e.target.value })} />
          </Field>
        )}
        <Field label="Notes" hint="Optional" className="md:col-span-2"><Input value={f.notes} maxLength={1000} placeholder={run.notes ?? undefined} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>

      {output > 0 && <p className={cn("knit-alert", check.outside ? "is-warn" : "is-ok")}>{check.message}</p>}

      <section className="knit-panel">
        <p className="knit-panel__title">How much each yarn gave</p>
        <YarnTable run={run} outputKg={output > 0 ? output : null} showPrices={showPrices} />
      </section>

      <div className="knit-figures">
        <Figure label="Yarn loaded" value={kg(run.yarnKg)} />
        <Figure label="Fabric" value={output > 0 ? kg(output) : "—"} note={output > 0 ? `${check.diff >= 0 ? "+" : "−"}${kg(Math.abs(check.diff))}` : undefined} tone={check.outside ? "text-amber-700" : undefined} />
        {showPrices && <Figure label="Knitting charge" value={money(charge)} note={`${kg(output)} × ${money(num(f.ratePerKg))}`} />}
        {showPrices && <Figure label="Final total" value={money(total)} note={output > 0 ? `${money(total / output)} per KG of fabric` : `Yarn ${money(run.yarnCost)}`} tone="text-[#123f35]" />}
      </div>
    </KnitDialog>
  );
}

/** Each yarn of a run: code, where it came from, KG and share, price and cost, and the fabric it gave (by its share). */
export function YarnTable({ run, outputKg, showPrices, renderCode }: { run: KnitRun; outputKg: number | null; showPrices: boolean; renderCode?: (code: string) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="knit-table w-full min-w-[640px] text-sm">
        <thead>
          <tr><th>Yarn code</th><th>From</th><th className="text-right">KG loaded</th><th className="text-right">Share</th>{showPrices && <><th className="text-right">Price / KG</th><th className="text-right">Cost</th></>}<th className="text-right">Fabric from it</th></tr>
        </thead>
        <tbody>
          {run.yarns.length === 0 && (
            <tr><td colSpan={showPrices ? 7 : 5} className="py-6 text-center text-xs text-gray-400">No yarn recorded on this run.</td></tr>
          )}
          {run.yarns.map((yarn) => (
            <tr key={yarn.id}>
              <td>{renderCode ? renderCode(yarn.itemCode) : <span className="knit-code">{yarn.itemCode}</span>}<span className="block text-xs text-gray-500">{yarn.itemName}</span></td>
              <td className="text-xs text-gray-600">{yarn.warehouse.code}{yarn.lotNo ? ` · lot ${yarn.lotNo}` : ""}</td>
              <td className="text-right font-semibold">{kg(yarn.kg)}</td>
              <td className="text-right">{yarn.sharePct.toFixed(1)}%</td>
              {showPrices && <><td className="text-right">{money(yarn.ratePerKg)}</td><td className="text-right">{money(yarn.cost)}</td></>}
              <td className="text-right font-semibold">{outputKg === null ? "—" : kg((outputKg * yarn.sharePct) / 100)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Total</td><td className="text-right">{kg(run.yarnKg)}</td><td className="text-right">100%</td>{showPrices && <><td /><td className="text-right">{money(run.yarnCost)}</td></>}<td className="text-right">{outputKg === null ? "—" : kg(outputKg)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}
