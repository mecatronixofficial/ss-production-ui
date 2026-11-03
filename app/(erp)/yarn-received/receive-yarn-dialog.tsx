"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, PackagePlus, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Warehouse } from "@/lib/types";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReceiveCheck } from "@/components/ui/receive-check";
import { keepDialogForOpenDropdown, SearchableSelect } from "@/components/ui/searchable-select";

export type ReceiptLine = { id: string; count: string; bags: string | null; bagCount: number | null; weightKg: number; dcWeightKg: number | null; ratePerKg: number | null; itemCode: string };
/** `GET /inventory/yarn-receipts/:id`: one delivery with its counts. */
export type YarnReceipt = {
  id: string;
  receiptNo: string;
  receivedAt: string;
  dcNo: string;
  millName: string;
  agentName: string | null;
  warehouseId: string;
  vehicleNo: string | null;
  notes: string | null;
  lines: ReceiptLine[];
  /** Its received challan, made when it was saved. */
  challan?: { id: string; no: string } | null;
};
type Directory = { mills: string[]; agents: string[]; counts: string[] };
type Line = { id?: string; itemCode?: string; count: string; bags: string; dcWeightKg: string; weightKg: string; ratePerKg: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** "30+9" → 39. */
const bagsOf = (bags: string) => bags.split("+").map((p) => p.trim()).filter(Boolean).reduce((t, p) => t + Number(p), 0);
const emptyLine = (): Line => ({ count: "", bags: "", dcWeightKg: "", weightKg: "", ratePerKg: "" });

/**
 * Receiving yarn as the register keeps it: the date, the mill's DC number, the mill and the agent (Direct when bought
 * straight from the mill), the warehouse, and each count on the DC with its bags (as written, e.g. 30+9), weight and,
 * for admins, rate. Each count goes into stock under a yarn code of its own (01SS26…). Also corrects a delivery.
 */
export function ReceiveYarnDialog({ receipt, showPrices, onClose, onSaved }: { receipt?: YarnReceipt; showPrices: boolean; onClose: () => void; onSaved: (saved: YarnReceipt) => void }) {
  const editing = !!receipt;
  const { data: directory } = useApiQuery<Directory>("/inventory/yarn-receipts/directory");
  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const active = warehouses.filter((w) => w.active !== false || w.id === receipt?.warehouseId);
  const [f, setF] = useState({
    receivedAt: receipt ? receipt.receivedAt.slice(0, 10) : today(),
    dcNo: receipt?.dcNo ?? "",
    millName: receipt?.millName ?? "",
    agentName: receipt?.agentName ?? "Direct",
    warehouseId: receipt?.warehouseId ?? "",
    vehicleNo: receipt?.vehicleNo ?? "",
    notes: receipt?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(
    receipt
      ? receipt.lines.map((l) => ({ id: l.id, itemCode: l.itemCode, count: l.count, bags: l.bags ?? "", dcWeightKg: l.dcWeightKg === null ? "" : String(l.dcWeightKg), weightKg: String(l.weightKg), ratePerKg: l.ratePerKg === null ? "" : String(l.ratePerKg) }))
      : [emptyLine()],
  );
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const setLine = (index: number, changes: Partial<Line>) => setLines((current) => current.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const warehouseId = f.warehouseId || (active.length === 1 ? active[0].id : "");

  const totalKg = lines.reduce((t, l) => t + (Number(l.weightKg) || 0), 0);
  const totalBags = lines.reduce((t, l) => t + (/^[\d\s+]*$/.test(l.bags) ? bagsOf(l.bags) : 0), 0);
  const totalAmount = lines.reduce((t, l) => t + (Number(l.weightKg) || 0) * (Number(l.ratePerKg) || 0), 0);
  const problem =
    !f.receivedAt ? "Enter the date." :
    !f.dcNo.trim() ? "Enter the DC number." :
    !f.millName.trim() ? "Choose or type the mill name." :
    !warehouseId ? "Choose the warehouse it came into." :
    lines.some((l) => !l.count.trim()) ? "Enter the count of every line." :
    lines.some((l) => l.bags.trim() && !/^\s*\d+(\s*\+\s*\d+)*\s*$/.test(l.bags)) ? "Write bags as numbers, e.g. 12 or 30+9." :
    lines.some((l) => !(Number(l.weightKg) > 0)) ? "Enter the weight weighed here (KG) of every line." :
    lines.some((l) => l.dcWeightKg.trim() && !(Number(l.dcWeightKg) > 0)) ? "The DC weight must be a number above 0." :
    "";

  const save = async () => {
    setError("");
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const body = {
        receivedAt: f.receivedAt,
        dcNo: f.dcNo.trim(),
        millName: f.millName.trim(),
        agentName: f.agentName.trim() || undefined,
        warehouseId,
        vehicleNo: f.vehicleNo.trim() || undefined,
        notes: f.notes.trim() || undefined,
        lines: lines.map((l) => ({
          id: l.id,
          count: l.count.trim(),
          bags: l.bags.replace(/\s+/g, "") || undefined,
          weightKg: Math.round(Number(l.weightKg) * 1000) / 1000,
          dcWeightKg: l.dcWeightKg.trim() ? Math.round(Number(l.dcWeightKg) * 1000) / 1000 : undefined,
          ratePerKg: showPrices && l.ratePerKg.trim() ? Number(l.ratePerKg) : undefined,
        })),
      };
      const saved = await api<YarnReceipt>(editing ? `/inventory/yarn-receipts/${receipt.id}` : "/inventory/yarn-receipts", { method: editing ? "PATCH" : "POST", body: JSON.stringify(body), silent: true });
      toast.success(
        editing
          ? `DC ${saved.dcNo} corrected.`
          : `DC ${saved.dcNo} received: ${saved.lines.map((l) => `${l.itemCode} ${l.count}`).join(", ")}. Write these codes on the bags.${saved.challan ? ` Received challan ${saved.challan.no}.` : ""}`,
        editing ? "Yarn receipt saved" : "Yarn received",
      );
      onSaved(saved);
    } catch (e) {
      setError(errorMessage(e, "Could not save the yarn receipt"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog yarn-dialog" aria-describedby="yarn-dialog-caption" onEscapeKeyDown={keepDialogForOpenDropdown}>
          <div className="users-dialog__head">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-base font-bold text-[#123f35]"><PackagePlus size={17} /> {editing ? `Correct ${receipt.receiptNo}` : "Receive yarn"}</Dialog.Title>
              <Dialog.Description id="yarn-dialog-caption" className="text-xs text-gray-500">
                {editing ? "Weights can change only while that yarn is still in stock." : "One mill DC: each count on it goes into stock with its own yarn code (01SS26…)."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <form className="users-dialog__body" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {error && <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle size={17} />{error}</div>}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block"><span className="erp-label">Date *</span><Input type="date" max={today()} value={f.receivedAt} onChange={(e) => set({ receivedAt: e.target.value })} /></label>
              <label className="block"><span className="erp-label">DC no *</span><Input maxLength={60} placeholder="Mill's delivery challan" value={f.dcNo} onChange={(e) => set({ dcNo: e.target.value })} /></label>
              <label className="block">
                <span className="erp-label">Warehouse *</span>
                <select className="erp-input" value={warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
                  <option value="">Select warehouse</option>
                  {active.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </label>
              <div><span className="erp-label">Mill name *</span><SearchableSelect placeholder="Search mill or type a new one" options={directory?.mills ?? []} value={f.millName} onChange={(millName) => set({ millName })} /></div>
              <div><span className="erp-label">Agent name</span><SearchableSelect placeholder="Direct, or the agent" options={["Direct", ...(directory?.agents ?? [])]} value={f.agentName} onChange={(agentName) => set({ agentName })} /></div>
              <label className="block"><span className="erp-label">Vehicle</span><Input maxLength={40} placeholder="Optional" value={f.vehicleNo} onChange={(e) => set({ vehicleNo: e.target.value.toUpperCase() })} /></label>
            </div>

            <div className="yarn-lines">
              <div className={cn("yarn-lines__row is-head", showPrices && "has-rate")} aria-hidden>
                <span>Count *</span><span>No of bags</span><span>DC weight</span><span>Weighed here *</span>{showPrices && <span>Rate / KG</span>}<span>Code · check</span><span />
              </div>
              {lines.map((line, index) => (
                <div key={line.id ?? `new-${index}`} className={cn("yarn-lines__row", showPrices && "has-rate")}>
                  <SearchableSelect placeholder="e.g. 36'S VL" options={directory?.counts ?? []} value={line.count} onChange={(count) => setLine(index, { count: count.toUpperCase() })} />
                  <Input aria-label="No of bags" placeholder="e.g. 30+9" value={line.bags} onChange={(e) => setLine(index, { bags: e.target.value.replace(/[^\d+\s]/g, "") })} />
                  <Input aria-label="Weight on the DC, KG" inputMode="decimal" placeholder="as on DC" value={line.dcWeightKg} onChange={(e) => setLine(index, { dcWeightKg: e.target.value.replace(/[^\d.]/g, "") })} />
                  <Input aria-label="Weight weighed here, KG" inputMode="decimal" placeholder={line.dcWeightKg || "KG"} value={line.weightKg} onChange={(e) => setLine(index, { weightKg: e.target.value.replace(/[^\d.]/g, "") })} />
                  {showPrices && <Input aria-label="Rate per KG" inputMode="decimal" placeholder="₹ / KG" value={line.ratePerKg} onChange={(e) => setLine(index, { ratePerKg: e.target.value.replace(/[^\d.]/g, "") })} />}
                  <span className="yarn-lines__code">
                    {line.itemCode ?? "new code"}
                    {line.dcWeightKg && Number(line.weightKg) > 0 && <span className="block"><ReceiveCheck sent={Number(line.dcWeightKg)} received={Number(line.weightKg)} unit="KG" /></span>}
                  </span>
                  {lines.length > 1 ? (
                    <button type="button" className="yarn-lines__remove" aria-label={`Remove line ${index + 1}`} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
                  ) : <span />}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button type="button" className="yarn-lines__add" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus size={14} /> Add another count on this DC</button>
                <span className="text-xs text-gray-600"><b>{totalBags}</b> bags · <b>{kg(totalKg)}</b>{showPrices && totalAmount > 0 ? <> · <b>{money(totalAmount)}</b></> : null}</span>
              </div>
            </div>

            <label className="block"><span className="erp-label">Notes</span><Input maxLength={500} placeholder="Optional: torn bags, short weight…" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>

            <div className="users-dialog__foot items-center">
              <p className={cn("mr-auto text-xs", problem ? "font-semibold text-amber-700" : "text-gray-500")}>{problem || `${lines.length} count${lines.length === 1 ? "" : "s"} into stock with a received challan.`}</p>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !!problem}>{busy ? "Saving…" : editing ? "Save changes" : "Receive yarn"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
