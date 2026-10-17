"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerUpLeft, Truck, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { PARTY_LABEL, type Sale } from "@/lib/sales";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, humanize, toNumber, unitQty } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { InlineMessage } from "@/components/ui/inline-message";

type Balance = { category: string; itemCode: string; lotNo: string | null; unit: string; balanceKg: number };

const EMPTY = 0.0005;
const qtyText = (value: number, unit: string) => unitQty(value, unit);
const decimals = (value: string) => (value.split(".")[1] ?? "").length;

/**
 * The warehouse's check before a sale leaves: what is actually loaded (up to what was sold, never more than in
 * stock), the vehicle as it leaves, and remarks. Dispatching takes the stock out and makes the delivery challan for
 * the office; "Send back" returns it to admin. `onDone` says which happened, so an admin can open the challan.
 */
export function DispatchDialog({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: (text: string, dispatched: boolean) => void }) {
  const { data: stock } = useApiQuery<Balance[]>(`/inventory/balances${qs({ warehouseId: sale.warehouseId })}`);
  const inStock = (item: Sale["items"][number]) =>
    stock?.filter((row) => row.itemCode === item.itemCode && (row.lotNo ?? "") === (item.lotNo ?? "") && row.unit === item.unit).reduce((sum, row) => sum + row.balanceKg, 0) ?? null;
  const [loaded, setLoaded] = useState<Record<string, string>>(() => Object.fromEntries(sale.items.map((item) => [item.id, String(Number(item.quantity))])));
  const [v, setV] = useState({ vehicleNo: sale.vehicleNo ?? "", driverName: sale.driverName ?? "", driverPhone: sale.driverPhone ?? "", transporter: sale.transporter ?? "", lrNo: sale.lrNo ?? "" });
  const [notes, setNotes] = useState("");
  const [checked, setChecked] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");
  const { message, run, reject, busy } = useApiAction();

  const dispatch = async () => {
    for (const item of sale.items) {
      const raw = loaded[item.id] ?? "";
      const qty = toNumber(raw);
      if (raw === "" || qty < 0) return reject(`${item.itemCode}: enter what was loaded (0 if none).`, "Check dispatch");
      if (decimals(raw) > 3) return reject(`${item.itemCode}: at most 3 decimals.`, "Check dispatch");
      if (qty > Number(item.quantity) + EMPTY) return reject(`${item.itemCode}: only ${qtyText(Number(item.quantity), item.unit)} was sold.`, "Check dispatch");
      const held = inStock(item);
      if (held !== null && qty > held + EMPTY) return reject(`${item.itemCode}: only ${qtyText(Math.max(held, 0), item.unit)} is in stock here.`, "Check dispatch");
    }
    if (!sale.items.some((item) => toNumber(loaded[item.id]) > EMPTY)) return reject("Nothing is loaded. Send it back instead.", "Check dispatch");
    if (!v.vehicleNo.trim()) return reject("Enter the vehicle number it leaves on.", "Check dispatch");
    if (!checked) return reject("Tick that you have checked the items, quantities and vehicle.", "Check dispatch");
    const ok = await run(
      () =>
        api(`/sales/${sale.id}/dispatch`, {
          method: "POST",
          body: JSON.stringify({
            items: sale.items.map((item) => ({ id: item.id, quantity: Math.round(toNumber(loaded[item.id]) * 1000) / 1000 })),
            vehicleNo: v.vehicleNo.trim().toUpperCase(),
            driverName: v.driverName.trim(),
            driverPhone: v.driverPhone.trim(),
            transporter: v.transporter.trim(),
            lrNo: v.lrNo.trim(),
            notes: notes.trim() || undefined,
          }),
        }),
      `${sale.saleNo} dispatched on ${v.vehicleNo.trim().toUpperCase()}; the stock has left ${sale.warehouse.code}. The delivery challan is made for the office.`,
    );
    if (ok) onDone(`${sale.saleNo} dispatched.`, true);
  };

  const sendBack = async () => {
    if (!reason.trim()) return reject("Say what is wrong, so admin can correct it.", "Send back");
    const ok = await run(() => api(`/sales/${sale.id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }), `${sale.saleNo} sent back to admin.`);
    if (ok) onDone(`${sale.saleNo} sent back.`, false);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog purchases-dialog" aria-describedby="dispatch-help">
          <div className="users-dialog__head">
            <div className="purchases-card-heading">
              <span className="purchases-step-badge purchases-step-badge--2"><Truck size={14} /></span>
              <div>
                <Dialog.Title className="text-base font-bold text-[#1b3c55]">Verify & dispatch {sale.saleNo}</Dialog.Title>
                <p id="dispatch-help" className="text-xs text-gray-500">
                  {PARTY_LABEL[sale.partyType]} {sale.partyName} · entered {formatDate(sale.saleDate)}. Check what is loaded and the vehicle; dispatching takes the stock out of {sale.warehouse.code}.
                </p>
              </div>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <div className="users-dialog__body">
            <InlineMessage message={message} />
            {sale.notes && <p className="users-note">Note from admin: {sale.notes}</p>}

            <div className="purchases-line-table overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Sold</th><th className="px-3 py-2 text-right">In stock now</th><th className="px-3 py-2">Loaded *</th></tr></thead>
                <tbody>
                  {sale.items.map((item) => {
                    const held = inStock(item);
                    const qty = toNumber(loaded[item.id]);
                    const problem = qty > Number(item.quantity) + EMPTY || (held !== null && qty > held + EMPTY);
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2"><span className="font-mono text-xs font-bold">{item.itemCode}</span><span className="block text-xs text-gray-500">{item.itemName} · {humanize(item.category)}{item.lotNo ? ` · lot ${item.lotNo}` : ""}</span></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{qtyText(Number(item.quantity), item.unit)}</td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", held !== null && held < Number(item.quantity) - EMPTY && "font-semibold text-red-600")}>{held === null ? "…" : qtyText(Math.max(held, 0), item.unit)}</td>
                        <td className="px-3 py-1.5">
                          {item.unit.toUpperCase() === "KG" ? (
                            <WeightInput compact wrapperClassName="max-w-48" className={cn(problem && "border-red-400")} value={loaded[item.id] ?? ""} onValueChange={(value) => setLoaded((current) => ({ ...current, [item.id]: value }))} aria-invalid={problem} aria-label={`Loaded, ${item.itemCode}`} />
                          ) : (
                            <Input className={cn("max-w-40", problem && "border-red-400")} type="number" min="0" step={item.unit.toUpperCase() === "G" ? "1" : "0.001"} inputMode="decimal" value={loaded[item.id] ?? ""} onChange={(e) => setLoaded((current) => ({ ...current, [item.id]: e.target.value }))} aria-invalid={problem} aria-label={`Loaded, ${item.itemCode}`} />
                          )}
                          {qty < Number(item.quantity) - EMPTY && !problem && <span className="mt-0.5 block text-[11px] text-amber-700">Short by {qtyText(Number(item.quantity) - qty, item.unit)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Vehicle no *"><Input value={v.vehicleNo} maxLength={30} className="uppercase" onChange={(e) => setV({ ...v, vehicleNo: e.target.value.toUpperCase() })} /></Field>
              <Field label="Driver"><Input value={v.driverName} maxLength={80} onChange={(e) => setV({ ...v, driverName: e.target.value })} /></Field>
              <Field label="Driver phone"><Input type="tel" value={v.driverPhone} maxLength={30} onChange={(e) => setV({ ...v, driverPhone: e.target.value })} /></Field>
              <Field label="Transporter"><Input value={v.transporter} maxLength={120} onChange={(e) => setV({ ...v, transporter: e.target.value })} /></Field>
              <Field label="LR no"><Input value={v.lrNo} maxLength={60} onChange={(e) => setV({ ...v, lrNo: e.target.value })} /></Field>
              <Field label="Remarks" hint="Optional"><Input value={notes} maxLength={500} placeholder="e.g. 2 rolls short, sent next load" onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>

            {sendingBack ? (
              <label className="block">
                <span className="erp-label">What is wrong? *</span>
                <textarea className="erp-input h-auto min-h-20 py-2" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lot L-101 not found; vehicle didn't come" autoFocus />
              </label>
            ) : (
              <label className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                I have checked the items, quantities and vehicle, and the material is loaded.
              </label>
            )}

            <div className="users-dialog__foot items-center">
              {sendingBack ? (
                <>
                  <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => setSendingBack(false)}>Back to dispatch</Button>
                  <Button variant="danger" disabled={busy} onClick={() => void sendBack()}><CornerUpLeft size={15} /> {busy ? "Sending…" : "Send back to admin"}</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="mr-auto text-red-600" disabled={busy} onClick={() => setSendingBack(true)}><CornerUpLeft size={15} /> Report a problem</Button>
                  <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
                  <Button disabled={busy} onClick={() => void dispatch()}><Truck size={15} /> {busy ? "Dispatching…" : "Dispatch & make challan"}</Button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
