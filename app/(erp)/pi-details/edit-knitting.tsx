"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { toast } from "@/lib/toast-store";
import { todayInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { isKnitting, type FabricFlow } from "../production/types";
import { productionHref } from "./pi-details";

const dateInput = (value: string | null) => (value ? value.slice(0, 10) : todayInput());

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-[#1b3c55]">
      <span>{label}{hint && <span className="ml-1.5 text-xs font-normal text-gray-400">{hint}</span>}</span>
      {children}
    </label>
  );
}

/**
 * Corrects a batch's knitting details (start date, mill, party, GG, LL, yarn rate) while it is still knitting,
 * using the same update as the Production page. The yarn taken stays as it is.
 */
export function EditKnittingDialog({ code, onClose, onSaved }: { code: string; onClose: () => void; onSaved: () => void }) {
  const batch = useApiQuery<FabricFlow>(`/production/fabric-flows/code/${encodeURIComponent(code)}`);
  const flow = batch.data;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog money-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">Edit {code} · knitting details</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          {!flow ? (
            <div className="users-dialog__body pb-4">{batch.error ? <p className="text-sm text-red-600" role="alert">{batch.error}</p> : <Loading />}</div>
          ) : !isKnitting(flow) ? (
            <div className="users-dialog__body pb-4">
              <p className="text-sm text-gray-600">
                {code} has finished knitting, so its knitting details can no longer be changed. Later stages (dyeing, compacting, deliveries and expenses) are corrected on its production record.
              </p>
              <div className="users-dialog__foot">
                <Button variant="outline" onClick={onClose}>Close</Button>
                <Button asChild><Link href={productionHref(code)}>Open production record</Link></Button>
              </div>
            </div>
          ) : (
            <EditForm flow={flow} onClose={onClose} onSaved={onSaved} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditForm({ flow, onClose, onSaved }: { flow: FabricFlow; onClose: () => void; onSaved: () => void }) {
  const own = flow.knittingMillType === "OWN";
  const [form, setForm] = useState({
    startDate: dateInput(flow.knittingDate),
    mill: flow.knittingMillDetails ?? "",
    party: flow.knittingPartyDetails && flow.knittingPartyDetails !== flow.knittingMillDetails ? flow.knittingPartyDetails : "",
    gg: flow.knittingGg ?? "",
    ll: flow.knittingLl ?? "",
    rate: flow.yarnRatePerKg ? String(flow.yarnRatePerKg) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }));
  const rate = form.rate.trim() === "" ? undefined : Number(form.rate);
  const problem =
    !form.startDate ? "Choose the start date." :
    form.startDate > todayInput() ? "Knitting can't start on a future date." :
    !form.mill.trim() ? "Enter the knitting mill." :
    rate !== undefined && !(Number.isFinite(rate) && rate >= 0) ? "Enter a valid yarn rate per KG." : "";

  const submit = async () => {
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      await api(`/production/fabric-flows/${flow.id}/knitting`, {
        method: "PATCH",
        silent: true,
        body: JSON.stringify({
          startDate: form.startDate,
          millDetails: form.mill.trim(),
          partyDetails: form.party.trim() || undefined,
          gg: form.gg.trim() || undefined,
          ll: form.ll.trim() || undefined,
          yarnRatePerKg: rate === undefined ? undefined : Math.round(rate * 100) / 100,
        }),
      });
      toast.success(`${flow.flowNo} knitting details saved.`, "Saved");
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the knitting details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="users-dialog__body" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start date">
          <Input type="date" max={todayInput()} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="Knitting mill" hint={own ? "Own mill" : undefined}>
          <Input value={form.mill} maxLength={200} onChange={(e) => set({ mill: e.target.value })} />
        </Field>
        <Field label="Responsible party" hint="Optional; the mill when left empty">
          <Input value={form.party} maxLength={200} onChange={(e) => set({ party: e.target.value })} />
        </Field>
        <Field label="Yarn rate / KG" hint="₹">
          <Input type="number" inputMode="decimal" min="0" step="0.01" value={form.rate} onChange={(e) => set({ rate: e.target.value })} />
        </Field>
        <Field label="GG" hint="Optional">
          <Input value={form.gg} maxLength={40} onChange={(e) => set({ gg: e.target.value })} />
        </Field>
        <Field label="LL" hint="Optional">
          <Input value={form.ll} maxLength={40} onChange={(e) => set({ ll: e.target.value })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-gray-500">The yarn given to knitting stays as it is. Yarn used, fabric weight and rolls are entered when knitting finishes.</p>
      {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
      <div className="users-dialog__foot">
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save changes"}</Button>
      </div>
    </form>
  );
}
