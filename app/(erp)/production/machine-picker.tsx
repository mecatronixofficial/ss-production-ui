"use client";

import { ChevronDown, Factory } from "lucide-react";
import { shiftText, type KnitContext, type KnitRun } from "../masters/machines/types";
import { Input } from "@/components/ui/input";
import { cn, formatDate, kg, money } from "@/lib/utils";
import { Field } from "./fields";

export type MachinePick = { machineId: string; operatorId: string; ratePerKg: string };

export const machineAvailable = (machine: KnitContext["machines"][number], context: KnitContext) =>
  machine.status === "IDLE" && !context.busyMachineIds.includes(machine.id);

export function MachinePicker({ context, runs = [], picks, reservedIds, disabled, onChange }: {
  context: KnitContext;
  runs?: KnitRun[];
  picks: MachinePick[];
  reservedIds: string[];
  disabled: boolean;
  onChange: (picks: MachinePick[]) => void;
}) {
  const update = (machineId: string, changes: Partial<MachinePick>) => onChange(picks.map((pick) => pick.machineId === machineId ? { ...pick, ...changes } : pick));
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Choose machines for this fabric</legend>
      {!context.machines.length && <p className="text-xs text-amber-700">No machines are available. Add a machine in Machine Details first.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {[...context.machines].sort((a, b) => Number(machineAvailable(b, context)) - Number(machineAvailable(a, context)) || a.code.localeCompare(b.code)).map((machine) => {
          const pick = picks.find((entry) => entry.machineId === machine.id);
          const reserved = reservedIds.includes(machine.id);
          const available = machineAvailable(machine, context) && !reserved;
          const working = context.busyMachineIds.includes(machine.id) || machine.status === "RUNNING";
          const reason = reserved ? "Chosen for another fabric" : working ? "Working" : machine.status === "MAINTENANCE" ? "Maintenance" : machine.status === "BREAKDOWN" ? "Breakdown" : machine.status === "DISABLED" ? "Disabled" : "Free";
          const machineRuns = runs.filter((run) => run.machine.id === machine.id).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
          const activeRun = machineRuns.find((run) => run.status === "RUNNING");
          const run = activeRun ?? machineRuns[0];
          return (
            <div key={machine.id} data-machine-id={machine.id} className={cn("min-w-0 rounded-xl border p-3", pick ? "border-emerald-500 bg-emerald-50/60" : "border-gray-200 bg-white")}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-emerald-700" aria-label={`Choose ${machine.code}`} checked={!!pick} disabled={!available && !pick} onChange={(event) => onChange(event.target.checked ? [...picks, { machineId: machine.id, operatorId: "", ratePerKg: String(machine.ratePerKg) }] : picks.filter((entry) => entry.machineId !== machine.id))} />
                <Factory size={17} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
                <span className="min-w-0 flex-1">
                  <strong className="block break-words text-sm text-gray-800">{machine.code} · {machine.name}</strong>
                  <span className="block text-xs text-gray-500">{machine.type || "Knitting machine"}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-bold", available ? "bg-emerald-100 text-emerald-800" : working ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600")}>{reason}</span>
              </label>
              {activeRun && <p className="mt-2 break-words text-xs text-gray-500">Knitting {activeRun.productionFlow?.flowNo ?? activeRun.runNo}{activeRun.fabricType ? ` · ${activeRun.fabricType}` : ""}</p>}
              <details className="group mt-3 border-t border-gray-100 pt-2">
                <summary aria-label={`More details for ${machine.code}`} className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-[#1b3c55]">More details <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden /></summary>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  {([
                    ["Machine status", machine.status[0] + machine.status.slice(1).toLowerCase()],
                    ["Availability", reason],
                    ["Manufacturer", machine.manufacturer],
                    ["Machine type", machine.type],
                    ["Default charge", `${money(machine.ratePerKg)} / KG`],
                    ["Last updated", machine.updatedAt ? formatDate(machine.updatedAt) : null],
                    ["Work stage", activeRun ? "Knitting in progress" : run ? "Last run finished" : "No work assigned"],
                    [activeRun ? "Current run" : "Last run", run?.runNo],
                    ["Batch", run?.productionFlow?.flowNo],
                    ["Fabric", run ? [run.fabricType, run.productionFlow?.fabricDiameter, run.productionFlow?.fabricGsm && `${run.productionFlow.fabricGsm} GSM`].filter(Boolean).join(" · ") : null],
                    ["Operator", run?.operator ? `${run.operator.code} · ${run.operator.name}` : null],
                    ["Started", run ? shiftText(run.startedAt, run.startShift) : null],
                    ["Finished", run?.finishedAt ? shiftText(run.finishedAt, run.finishShift) : null],
                    ["Fabric knitted", run ? kg(run.outputKg ?? 0) : null],
                    ["Yarn used", run ? kg(run.yarnKg) : null],
                    ["Rolls", run?.rollCount !== null && run?.rollCount !== undefined ? String(run.rollCount) : null],
                    ["Production entries", run ? String(run.days.length) : null],
                    ["Fabric warehouse", run?.warehouse ? `${run.warehouse.code} · ${run.warehouse.name}` : null],
                    ["Notes", run?.notes],
                  ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-gray-500">{label}</dt><dd className="mt-0.5 break-words font-medium text-gray-800">{value || "—"}</dd></div>)}
                </dl>
              </details>
              {pick && (
                <div className="mt-3 grid gap-2">
                  <Field label={`Operator on ${machine.code}`} hint="Optional">
                    <select className="erp-input" value={pick.operatorId} onChange={(event) => update(machine.id, { operatorId: event.target.value })}>
                      <option value="">Operator not recorded</option>
                      {context.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.code} · {operator.name}</option>)}
                    </select>
                  </Field>
                  <Field label={`Knitting charge on ${machine.code}`} hint="₹ per KG">
                    <Input type="number" min="0" step="0.01" inputMode="decimal" value={pick.ratePerKg} onChange={(event) => update(machine.id, { ratePerKg: event.target.value })} />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
