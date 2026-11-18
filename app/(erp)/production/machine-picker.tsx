"use client";

import { Factory } from "lucide-react";
import type { KnitContext } from "../masters/machines/types";
import { Input } from "@/components/ui/input";
import { cn, money } from "@/lib/utils";
import { Field } from "./fields";

export type MachinePick = { machineId: string; operatorId: string; ratePerKg: string };

export const machineAvailable = (machine: KnitContext["machines"][number], context: KnitContext) =>
  !["DISABLED", "MAINTENANCE", "BREAKDOWN"].includes(machine.status) && !context.busyMachineIds.includes(machine.id);

export function MachinePicker({ context, picks, reservedIds, disabled, onChange }: {
  context: KnitContext;
  picks: MachinePick[];
  reservedIds: string[];
  disabled: boolean;
  onChange: (picks: MachinePick[]) => void;
}) {
  const update = (machineId: string, changes: Partial<MachinePick>) => onChange(picks.map((pick) => pick.machineId === machineId ? { ...pick, ...changes } : pick));
  return (
    <fieldset disabled={disabled} className="mt-3 min-w-0 border-t border-gray-200 pt-3">
      <legend className="px-1 text-xs font-bold text-[#123f35]">Choose machines</legend>
      <p className="mb-3 text-xs text-gray-500">Choose one or more free machines for this fabric. They start knitting when you submit this form.</p>
      {!context.machines.length && <p className="text-xs text-amber-700">No machines are available. Add a machine in Machine Details first.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {context.machines.map((machine) => {
          const pick = picks.find((entry) => entry.machineId === machine.id);
          const reserved = reservedIds.includes(machine.id);
          const available = machineAvailable(machine, context) && !reserved;
          const reason = reserved ? "Chosen for another fabric type" : context.busyMachineIds.includes(machine.id) ? "Already knitting" : machine.status === "MAINTENANCE" ? "Under maintenance" : machine.status === "BREAKDOWN" ? "Breakdown" : machine.status === "DISABLED" ? "Disabled" : "Available";
          return (
            <div key={machine.id} className={cn("min-w-0 rounded-xl border p-3", pick ? "border-emerald-500 bg-emerald-50/60" : "border-gray-200 bg-white", !available && "opacity-60")}>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-1 accent-emerald-700" aria-label={`Choose ${machine.code}`} checked={!!pick} disabled={!available && !pick} onChange={(event) => onChange(event.target.checked ? [...picks, { machineId: machine.id, operatorId: "", ratePerKg: String(machine.ratePerKg) }] : picks.filter((entry) => entry.machineId !== machine.id))} />
                <Factory size={17} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
                <span className="min-w-0">
                  <strong className="block text-sm text-gray-800">{machine.code} · {machine.name}</strong>
                  <span className="block text-xs text-gray-500">{[machine.type, machine.manufacturer].filter(Boolean).join(" · ") || "Machine details not recorded"}</span>
                  <span className="block text-xs text-gray-500">{reason} · Default charge {money(machine.ratePerKg)} / KG</span>
                </span>
              </label>
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
