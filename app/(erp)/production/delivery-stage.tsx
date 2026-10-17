"use client";

import { useState } from "react";
import { Building2, Check, Paperclip, Trash2, Truck, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import type { Warehouse } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, kg, money, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { Attachments } from "./attachments";
import { Field, SectionHeading } from "./fields";
import type { RunStage } from "./knitting-stage";
import { leftToDeliver, localDate, numeric, shortDate, type FabricFlow, type FlowDelivery } from "./types";

type Destination = FlowDelivery["destination"];

const EMPTY = 0.0005;

/**
 * Delivery, the last part of compacting: the compacted fabric goes to parties (typed, e.g. a distributor) and / or
 * warehouses, in one or more deliveries. Fabric put into a warehouse becomes Finished fabric stock there under the
 * batch's code. `parties` are names used before, suggested while typing.
 */
export function DeliveryStage({ flow, saving, run, onFilesChanged, parties = [] }: { flow: FabricFlow; saving: boolean; run: RunStage; onFilesChanged: () => void; parties?: string[] }) {
  const { data: warehouseList = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouses = warehouseList.filter((w) => w.active !== false);
  const left = leftToDeliver(flow) ?? 0;
  const delivered = flow.finalDeliveredKg ?? 0;
  // Batches delivered before destinations were recorded keep only their totals.
  const legacy = flow.deliveries.length === 0 && delivered > EMPTY;

  const [f, setF] = useState({
    destination: "CUSTOMER" as Destination,
    partyName: "",
    warehouseId: "",
    deliveredDate: localDate(),
    weightKg: left > EMPTY ? String(Number(left.toFixed(3))) : "",
    amount: "",
    expense: "",
    notes: "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const toParty = f.destination === "CUSTOMER";
  const weight = numeric(f.weightKg);
  const tooMuch = weight > left + EMPTY;
  const ready = weight > 0 && !tooMuch && !!f.deliveredDate && (toParty ? !!f.partyName.trim() : !!f.warehouseId);

  const record = async () => {
    const saved = await run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/deliveries`, {
          method: "POST",
          body: JSON.stringify({
            deliveredDate: f.deliveredDate,
            destination: f.destination,
            partyName: toParty ? f.partyName.trim() : undefined,
            warehouseId: toParty ? undefined : f.warehouseId,
            weightKg: Math.round(weight * 1000) / 1000,
            amount: toParty ? numeric(f.amount) : undefined,
            expense: numeric(f.expense),
            notes: f.notes || undefined,
          }),
        }),
      "compacting",
    );
    if (saved) {
      const nowLeft = Math.max(0, left - weight);
      set({ weightKg: nowLeft > EMPTY ? String(Number(nowLeft.toFixed(3))) : "", amount: "", expense: "", notes: "" });
    }
  };

  const undo = async (delivery: FlowDelivery) => {
    const where = delivery.destination === "CUSTOMER" ? delivery.partyName ?? "the party" : `${delivery.warehouse?.code ?? "the warehouse"} stock`;
    const ok = await confirmDialog({
      title: `Undo delivery of ${kg(delivery.weightKg)}?`,
      description:
        delivery.destination === "CUSTOMER"
          ? `The delivery to ${where} and its ${money(delivery.amount)} collection are removed; the fabric is ready to deliver again.`
          : delivery.receivedAt
            ? `The fabric comes back out of ${where} and is ready to deliver again. Not possible if it has already been issued from there.`
            : `The warehouse hasn't received it yet, so it is simply cancelled and the fabric is ready to deliver again.`,
      confirmLabel: "Undo delivery",
      tone: "danger",
    });
    if (ok) await run(() => api<FabricFlow>(`/production/fabric-flows/${flow.id}/deliveries/${delivery.id}`, { method: "DELETE" }), "compacting");
  };

  return (
    <div className="space-y-5">
      <div className="production-estimate grid gap-3 sm:grid-cols-4">
        <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Compacted</p><p className="mt-1 text-base font-bold text-gray-800">{kg(flow.officeDeliveryKg ?? 0)}</p></div>
        <div><p className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">Delivered</p><p className="mt-1 text-base font-bold text-emerald-700">{kg(delivered)}</p></div>
        <div><p className="text-[9px] font-bold uppercase tracking-wider text-amber-600">Left to deliver</p><p className="mt-1 text-base font-bold text-amber-800">{kg(left)}</p></div>
        <div><p className="text-[9px] font-bold uppercase tracking-wider text-blue-600">Collected</p><p className="mt-1 text-base font-bold text-blue-800">{money(flow.collectedAmount)}</p></div>
      </div>

      <div className="production-field-section">
        <SectionHeading icon={Truck} title="Deliveries" caption={`Where ${flow.flowNo}'s finished fabric went`} />
        {flow.deliveries.length === 0 && !legacy ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">Nothing delivered yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">To</th><th className="px-3 py-2 text-right">Weight</th><th className="px-3 py-2 text-right">Collected</th><th className="px-3 py-2">Notes</th><th className="w-10" /></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {flow.deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{shortDate(d.deliveredAt)}</td>
                    <td className="px-3 py-2">
                      {d.destination === "CUSTOMER" ? (
                        <span className="inline-flex items-center gap-1.5"><UserRound size={13} className="text-gray-400" />{d.partyName ?? "Party"}</span>
                      ) : (
                        <span>
                          <span className="inline-flex items-center gap-1.5"><Building2 size={13} className="text-gray-400" />{d.warehouse?.code ?? "Warehouse"}</span>
                          {d.receivedAt ? (
                            <span className="block text-[11px] text-emerald-700">Received {shortDate(d.receivedAt)} · {kg(d.receivedWeightKg ?? d.weightKg)} in stock as {flow.flowNo}</span>
                          ) : (
                            <span className="block text-[11px] text-amber-700">On its way · waiting for {d.warehouse?.code ?? "the warehouse"} to receive it</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{kg(d.weightKg)}</td>
                    <td className="px-3 py-2 text-right">{d.destination === "CUSTOMER" ? money(d.amount) : "—"}{toNumber(d.expense) > 0 && <span className="block text-[11px] text-gray-400">cost {money(d.expense)}</span>}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-gray-500" title={d.notes ?? undefined}>{d.notes || "—"}</td>
                    <td className="pr-2"><Button size="sm" variant="ghost" className="text-red-600" disabled={saving} onClick={() => void undo(d)} aria-label={`Undo delivery of ${kg(d.weightKg)}`}><Trash2 size={14} /></Button></td>
                  </tr>
                ))}
                {legacy && (
                  <tr>
                    <td className="px-3 py-2 whitespace-nowrap">{shortDate(flow.finalDate)}</td>
                    <td className="px-3 py-2 text-gray-500">Recorded before destinations were kept</td>
                    <td className="px-3 py-2 text-right font-semibold">{kg(delivered)}</td>
                    <td className="px-3 py-2 text-right">{money(flow.collectedAmount)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{flow.notes || "—"}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {flow.officeDeliveryKg !== null && left > EMPTY && (
        <div className="production-field-section">
          <SectionHeading icon={Check} title="Record a delivery" caption="All of it, or part now and the rest later" />
          <div className="mb-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Deliver to">
            {([
              ["CUSTOMER", "To a party", "Fabric sold and sent out, e.g. to a distributor; record what they paid.", UserRound],
              ["WAREHOUSE", "To a warehouse", `The warehouse is notified and receives it into stock as ${flow.flowNo}.`, Building2],
            ] as const).map(([value, label, caption, Icon]) => (
              <label key={value} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition focus-within:ring-2 focus-within:ring-emerald-200", f.destination === value ? "border-[#78b8a1] bg-emerald-50/70" : "border-gray-200 hover:bg-gray-50")}>
                <input type="radio" name="delivery-destination" className="sr-only" value={value} checked={f.destination === value} onChange={() => set({ destination: value })} />
                <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl", f.destination === value ? "bg-[#1c7a5f] text-white" : "bg-gray-100 text-gray-500")}><Icon size={15} /></span>
                <span><span className="block text-sm font-bold text-gray-800">{label}</span><span className="mt-0.5 block text-xs text-gray-500">{caption}</span></span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {toParty ? (
              <Field label="Delivered to" hint="Party name" className="md:col-span-2 xl:col-span-1">
                <Input value={f.partyName} maxLength={160} list="delivery-parties" autoComplete="off" placeholder="e.g. Sri Textiles" onChange={(e) => set({ partyName: e.target.value })} />
                <datalist id="delivery-parties">{parties.map((name) => <option key={name} value={name} />)}</datalist>
              </Field>
            ) : (
              <Field label="Warehouse" className="md:col-span-2 xl:col-span-1">
                <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
                  <option value="">Select warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Delivery date"><Input type="date" value={f.deliveredDate} onChange={(e) => set({ deliveredDate: e.target.value })} /></Field>
            <Field label="Weight" hint={`KG · ${kg(left)} left`}>
              <WeightInput className={cn(tooMuch && "border-red-400")} value={f.weightKg} onValueChange={(weightKg) => set({ weightKg })} aria-invalid={tooMuch} />
              {tooMuch && <span className="mt-1 block text-[11px] text-red-600">Only {kg(left)} is left to deliver</span>}
            </Field>
            {toParty && <Field label="Amount collected" hint="₹ · optional"><Input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>}
            <Field label="Delivery cost" hint="₹ · optional"><Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Transport etc." value={f.expense} onChange={(e) => set({ expense: e.target.value })} /></Field>
            <Field label="Notes" hint="Optional" className="md:col-span-2 xl:col-span-1"><Input placeholder="Vehicle, challan, invoice…" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button disabled={saving || !ready} onClick={() => void record()}>
              <Truck size={15} /> {saving ? "Saving…" : toParty ? "Record delivery" : "Send to warehouse"}
            </Button>
          </div>
        </div>
      )}
      {flow.officeDeliveryKg !== null && left <= EMPTY && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"><Check size={15} /> All finished fabric of {flow.flowNo} has been delivered.</p>
      )}

      <div className="production-field-section">
        <SectionHeading icon={Paperclip} title="Delivery documents" caption="Delivery challans, invoices, photos of the loaded fabric; each delivery's own note is kept with it above" />
        <Attachments flowId={flow.id} stage="FINAL" attachments={flow.attachments} onChanged={onFilesChanged} />
      </div>
    </div>
  );
}
