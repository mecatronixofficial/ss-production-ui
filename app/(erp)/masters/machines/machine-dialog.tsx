"use client";

import { useState } from "react";
import { Factory, PowerOff } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { MACHINE_STATUSES } from "@/lib/types";
import { errorMessage, humanize, kg } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { KnitDialog } from "./knit-dialog";
import { decimals, type KnitMachine } from "./types";

/** Adds a knitting machine or edits one: its yarn capacity per load and knitting charge per KG are its own. */
export function MachineDialog({
  machine,
  defaultCapacityKg,
  existingCodes,
  knitting,
  onClose,
  onSaved,
  onRemoved,
}: {
  /** null to add a new machine. */
  machine: KnitMachine | null;
  defaultCapacityKg: number;
  /** Codes already in use, to catch a duplicate before saving. */
  existingCodes: string[];
  /** The run on this machine now, if any (it can't be removed while knitting). */
  knitting: string | null;
  onClose: () => void;
  onSaved: (text: string) => void;
  /** After the machine is removed; defaults to `onSaved`. */
  onRemoved?: (text: string) => void;
}) {
  const [f, setF] = useState({
    code: machine?.code ?? "",
    name: machine?.name ?? "",
    type: machine?.type ?? "",
    capacityKg: String(machine?.capacityKg ?? defaultCapacityKg),
    ratePerKg: machine?.ratePerKg ? String(machine.ratePerKg) : "",
    manufacturer: machine?.manufacturer ?? "",
    status: machine?.status ?? "IDLE",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const capacity = Number(f.capacityKg);

  const save = async () => {
    setError("");
    const code = f.code.trim();
    if (!code || !f.name.trim()) return setError("Enter the machine code and name.");
    if (existingCodes.some((c) => c.toUpperCase() === code && c.toUpperCase() !== machine?.code.toUpperCase())) return setError(`Machine ${code} already exists.`);
    if (!(capacity > 0)) return setError("Enter the yarn capacity per load, e.g. 240 KG.");
    if (decimals(f.capacityKg) > 3) return setError("Use up to 3 decimals for the capacity.");
    if (f.ratePerKg !== "" && !(Number(f.ratePerKg) >= 0)) return setError("The knitting charge can't be below zero.");
    if (decimals(f.ratePerKg) > 2) return setError("Use up to 2 decimals for the knitting charge.");
    setBusy(true);
    try {
      const body = {
        code,
        name: f.name.trim(),
        type: f.type.trim() || undefined,
        capacityKg: capacity,
        ratePerKg: f.ratePerKg === "" ? 0 : Number(f.ratePerKg),
        manufacturer: f.manufacturer.trim() || undefined,
        status: f.status,
        ...(machine ? {} : { department: "Knitting" }),
      };
      await api(machine ? `/masters/machines/${machine.id}` : "/masters/machines", { method: machine ? "PATCH" : "POST", body: JSON.stringify(body) });
      onSaved(machine ? `${body.code} saved.` : `Machine ${body.code} added.`);
    } catch (e) {
      setError(errorMessage(e, "Could not save the machine"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!machine) return;
    const ok = await confirmDialog({
      title: `Remove ${machine.code}?`,
      description: "It is set to Disabled and leaves the Machines page. Its runs stay in the register.",
      confirmLabel: "Remove machine",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/masters/machines/${machine.id}`, { method: "DELETE" });
      (onRemoved ?? onSaved)(`${machine.code} removed.`);
    } catch (e) {
      setError(errorMessage(e, "Could not remove the machine"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={Factory}
      title={machine ? `Edit ${machine.code}` : "Add knitting machine"}
      caption="Machines run day and night: Day 9 AM – 9 PM, Night 9 PM – 9 AM."
      busy={busy}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          {machine && (
            <Button variant="ghost" className="mr-auto text-red-600" disabled={busy || !!knitting} title={knitting ? `Knitting ${knitting} now` : undefined} onClick={() => void remove()}>
              <PowerOff size={15} /> Remove
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy}>{busy ? "Saving…" : machine ? "Save machine" : "Add machine"}</Button>
        </>
      }
    >
      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Machine code"><Input value={f.code} maxLength={30} placeholder="KN-01" className="uppercase" onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, "") })} autoFocus={!machine} /></Field>
        <Field label="Machine name"><Input value={f.name} maxLength={80} placeholder="Circular knitting 1" onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Knitting type / model" hint="Optional" className="sm:col-span-2"><Input value={f.type} placeholder={'e.g. Single jersey 30" 24G'} onChange={(e) => set({ type: e.target.value })} /></Field>
        <Field label="Yarn capacity per load" hint="KG">
          <WeightInput value={f.capacityKg} onValueChange={(capacityKg) => set({ capacityKg })} />
        </Field>
        <Field label="Knitting charge" hint="₹ per KG of fabric">
          <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={f.ratePerKg} onChange={(e) => set({ ratePerKg: e.target.value })} />
        </Field>
        <Field label="Manufacturer" hint="Optional"><Input value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} /></Field>
        <Field label="Status">
          <select className="erp-input" value={f.status} onChange={(e) => set({ status: e.target.value as KnitMachine["status"] })}>
            {MACHINE_STATUSES.filter((s) => s !== "DISABLED").map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </Field>
      </div>
      {knitting && machine && f.status !== machine.status && (f.status === "MAINTENANCE" || f.status === "BREAKDOWN") && (
        <p className="knit-alert is-warn">{machine.code} is knitting {knitting}. Marking it {humanize(f.status).toLowerCase()} keeps that run going; finish it when the fabric comes off.</p>
      )}
      <p className="text-xs text-gray-500">Each load can take up to {capacity > 0 ? kg(capacity) : "— kg"} of yarn on this machine. Status changes to Running and back to Idle by itself when yarn is loaded and the fabric taken off.</p>
    </KnitDialog>
  );
}
