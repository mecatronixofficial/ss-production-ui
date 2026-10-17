"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Send, Trash2, Truck, UserRound } from "lucide-react";
import { api, qs } from "@/lib/api";
import { GSTIN_PATTERN } from "@/lib/india";
import { PartyPicker, type PickParty } from "@/components/party-picker";
import { GST_RATES, type Sale, type SalePartyType } from "@/lib/sales";
import type { StockCategory } from "@/lib/types";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, humanize, money, todayInput, toNumber, unitQty } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { InlineMessage } from "@/components/ui/inline-message";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type Context = { distributors: PickParty[]; textiles: PickParty[]; warehouses: Array<{ id: string; code: string; name: string }> };
type Balance = { category: StockCategory; itemCode: string; itemName: string; lotNo: string | null; warehouseId: string; balanceKg: number; unit: string };
type Line = { key: number; stock: string; quantity: string; rate: string };

const EMPTY = 0.0005;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const decimals = (value: string) => (value.split(".")[1] ?? "").length;
/** One stock position in the warehouse: item, lot, unit (and its material). */
const stockKey = (row: { category: string; itemCode: string; lotNo: string | null; unit: string }) => [row.category, row.itemCode, row.lotNo ?? "", row.unit].join("|");
let lineSeq = 0;
const newLine = (): Line => ({ key: ++lineSeq, stock: "", quantity: "", rate: "" });

/** New sale, or a correction of one not yet dispatched (`sale`). Saving sends it to the warehouse to dispatch. */
export function SaleForm({ sale }: { sale?: Sale }) {
  const router = useRouter();
  const context = useApiQuery<Context>("/sales/context");
  const { message, run, reject, busy } = useApiAction();
  const [f, setF] = useState({
    saleDate: sale ? sale.saleDate.slice(0, 10) : todayInput(),
    partyType: (sale?.partyType ?? "DISTRIBUTOR") as SalePartyType,
    supplierId: sale?.supplierId ?? "",
    textileId: sale?.textileId ?? "",
    partyGst: sale?.partyGst ?? "",
    partyPhone: sale?.partyPhone ?? "",
    partyAddress: sale?.partyAddress ?? "",
    warehouseId: sale?.warehouseId ?? "",
    gstRate: sale ? String(Number(sale.gstRate)) : "5",
    vehicleNo: sale?.vehicleNo ?? "",
    driverName: sale?.driverName ?? "",
    driverPhone: sale?.driverPhone ?? "",
    transporter: sale?.transporter ?? "",
    lrNo: sale?.lrNo ?? "",
    notes: sale?.notes ?? "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [added, setAdded] = useState<PickParty[]>([]);
  const [lines, setLines] = useState<Line[]>(() =>
    sale ? sale.items.map((item) => ({ key: ++lineSeq, stock: stockKey(item), quantity: String(Number(item.quantity)), rate: String(Number(item.rate ?? 0)) })) : [newLine()],
  );
  const stockQuery = useApiQuery<Balance[]>(f.warehouseId ? `/inventory/balances${qs({ warehouseId: f.warehouseId })}` : null);
  const stock = useMemo(() => (stockQuery.data ?? []).filter((row) => row.balanceKg > EMPTY), [stockQuery.data]);
  const stockByKey = useMemo(() => new Map(stock.map((row) => [stockKey(row), row])), [stock]);
  const categories = useMemo(() => [...new Set(stock.map((row) => row.category))], [stock]);

  if (!context.data) return context.error ? <ErrorState message={context.error} onRetry={() => void context.reload()} /> : <Loading />;
  const ctx = context.data;
  // Parties just added here (until the list reloads), and the sale's own party if it has since been made inactive.
  const withExtra = (list: PickParty[], own: PickParty | null) => {
    const all = [...list, ...added.filter((p) => !list.some((x) => x.id === p.id))];
    return own && !all.some((p) => p.id === own.id) ? [...all, own] : all;
  };
  const ownParty = (p: { id: string; code: string; name: string } | null | undefined): PickParty | null =>
    p && sale ? { ...p, gst: sale.partyGst, mobile: sale.partyPhone, address: sale.partyAddress } : null;
  const distributors = withExtra(ctx.distributors, ownParty(sale?.supplier));
  const textiles = withExtra(ctx.textiles, ownParty(sale?.textile));
  const parties = f.partyType === "DISTRIBUTOR" ? distributors : textiles;
  const partyId = f.partyType === "DISTRIBUTOR" ? f.supplierId : f.textileId;
  const party = parties.find((p) => p.id === partyId);

  /** Picking a party fills its details for the bill (they can still be changed for this bill). */
  const pickParty = (picked: PickParty | null) =>
    set({
      ...(f.partyType === "DISTRIBUTOR" ? { supplierId: picked?.id ?? "" } : { textileId: picked?.id ?? "" }),
      partyGst: picked?.gst ?? "",
      partyPhone: picked?.mobile ?? "",
      partyAddress: picked?.address ?? "",
    });
  const partyAdded = (created: PickParty) => {
    setAdded((current) => [...current, created]);
    void context.reload();
  };
  const updateLine = (key: number, changes: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));

  const filled = lines.filter((line) => line.stock || line.quantity || line.rate);
  const amountOf = (line: Line) => Math.round(toNumber(line.quantity) * toNumber(line.rate) * 100) / 100;
  const subtotal = filled.reduce((sum, line) => sum + amountOf(line), 0);
  const gst = Math.round(subtotal * toNumber(f.gstRate)) / 100;

  const save = async () => {
    if (f.partyType === "DISTRIBUTOR" && !f.supplierId) return reject("Choose the distributor.", "Check sale");
    if (f.partyType === "TEXTILE" && !f.textileId) return reject("Choose the textile, or add a new one from the list.", "Check sale");
    if (f.partyGst.trim() && !GSTIN_PATTERN.test(f.partyGst.trim().toUpperCase())) return reject("Enter a valid 15-character GSTIN for the party.", "Check sale");
    if (f.partyPhone.trim() && !PHONE.test(f.partyPhone.trim())) return reject("Enter a valid party phone number.", "Check sale");
    if (f.driverPhone.trim() && !PHONE.test(f.driverPhone.trim())) return reject("Enter a valid driver phone number.", "Check sale");
    if (!f.warehouseId) return reject("Choose the warehouse the material leaves from.", "Check sale");
    if (filled.length === 0) return reject("Add at least one item.", "Check sale");
    const keys = new Set<string>();
    for (const [index, line] of filled.entries()) {
      const row = stockByKey.get(line.stock);
      const label = `Line ${index + 1}`;
      if (!row) return reject(`${label}: choose an item in stock.`, "Check sale");
      if (keys.has(line.stock)) return reject(`${row.itemCode} is on two lines; put all of it on one.`, "Check sale");
      keys.add(line.stock);
      if (!(toNumber(line.quantity) > 0)) return reject(`${label}: enter the quantity.`, "Check sale");
      if (decimals(line.quantity) > 3) return reject(`${label}: quantity can have at most 3 decimals.`, "Check sale");
      if (toNumber(line.quantity) > row.balanceKg + EMPTY) return reject(`${label}: only ${unitQty(row.balanceKg, row.unit)} of ${row.itemCode} is in stock.`, "Check sale");
      if (line.rate === "" || toNumber(line.rate) < 0) return reject(`${label}: enter the rate.`, "Check sale");
      if (decimals(line.rate) > 2) return reject(`${label}: rate can have at most 2 decimals.`, "Check sale");
    }
    const body = {
      saleDate: f.saleDate,
      partyType: f.partyType,
      supplierId: f.partyType === "DISTRIBUTOR" ? f.supplierId : undefined,
      textileId: f.partyType === "TEXTILE" ? f.textileId : undefined,
      partyGst: f.partyGst.trim().toUpperCase() || undefined,
      partyPhone: f.partyPhone.trim() || undefined,
      partyAddress: f.partyAddress.trim() || undefined,
      warehouseId: f.warehouseId,
      gstRate: Number(f.gstRate),
      vehicleNo: f.vehicleNo.trim() || undefined,
      driverName: f.driverName.trim() || undefined,
      driverPhone: f.driverPhone.trim() || undefined,
      transporter: f.transporter.trim() || undefined,
      lrNo: f.lrNo.trim() || undefined,
      notes: f.notes.trim() || undefined,
      items: filled.map((line) => {
        const row = stockByKey.get(line.stock)!;
        return { category: row.category, itemCode: row.itemCode, itemName: row.itemName, lotNo: row.lotNo ?? undefined, unit: row.unit, quantity: toNumber(line.quantity), rate: toNumber(line.rate) };
      }),
    };
    let saved: Sale | undefined;
    const warehouseCode = ctx.warehouses.find((w) => w.id === f.warehouseId)?.code ?? "the warehouse";
    const ok = await run(async () => {
      saved = await api<Sale>(sale ? `/sales/${sale.id}` : "/sales", { method: sale ? "PATCH" : "POST", body: JSON.stringify(body) });
    }, sale ? `Sale updated and sent to ${warehouseCode} again.` : `Sale saved; ${warehouseCode} has been asked to verify and dispatch it.`);
    if (ok && saved) router.push(`/sales/${saved.id}`);
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <InlineMessage message={message} />
      {sale?.rejectReason && <p className="warehouses-inactive-note">The warehouse sent this back: {sale.rejectReason}</p>}

      <section className="item-details-section">
        <h3 className="text-sm font-bold text-[#1b3c55]">Sold to</h3>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Sold to">
          {([
            ["DISTRIBUTOR", "Distributor", "Pick from your Distributors, or add one", Building2],
            ["TEXTILE", "Textile", "Pick from your Textiles, or add one", UserRound],
          ] as const).map(([value, label, caption, Icon]) => (
            <label key={value} className={cn("sale-party-choice", f.partyType === value && "is-selected")}>
              <input type="radio" name="party-type" className="sr-only" checked={f.partyType === value} onChange={() => set({ partyType: value, supplierId: "", textileId: "", partyGst: "", partyPhone: "", partyAddress: "" })} />
              <span className="sale-party-choice__icon"><Icon size={16} /></span>
              <span><span className="block text-sm font-bold text-gray-800">{label}</span><span className="block text-xs text-gray-500">{caption}</span></span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {/* Not a <label>: clicking an option must not re-focus the search box. */}
          <div className="xl:col-span-2">
            <span className="erp-label flex items-center justify-between gap-2">
              {f.partyType === "DISTRIBUTOR" ? "Distributor *" : "Textile *"}
              <span className="font-medium normal-case tracking-normal text-gray-400">
                {party ? [party.city, party.mobile].filter(Boolean).join(" · ") || party.code : `${parties.length} on your list`}
              </span>
            </span>
            <PartyPicker key={f.partyType} kind={f.partyType} parties={parties} value={partyId} onChange={pickParty} onCreated={partyAdded} />
          </div>
          <Field label="GSTIN" hint={party?.gst ? `From the ${f.partyType === "DISTRIBUTOR" ? "distributor" : "textile"}` : "Optional"}>
            <Input value={f.partyGst} maxLength={15} className="uppercase tracking-wide" placeholder="33ABCDE1234F1Z5" onChange={(e) => set({ partyGst: e.target.value.toUpperCase().replace(/\s/g, "") })} />
          </Field>
          <Field label="Phone" hint="Optional">
            <Input type="tel" value={f.partyPhone} maxLength={30} onChange={(e) => set({ partyPhone: e.target.value })} />
          </Field>
          <Field label="Billing address" hint="Optional" className="md:col-span-2 xl:col-span-4">
            <Input value={f.partyAddress} maxLength={500} onChange={(e) => set({ partyAddress: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="item-details-section">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="From warehouse *">
            <select className="erp-input" value={f.warehouseId} onChange={(e) => { set({ warehouseId: e.target.value }); setLines([newLine()]); }}>
              <option value="">Select warehouse</option>
              {ctx.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </Field>
          <Field label="Bill date"><Input type="date" max={todayInput()} value={f.saleDate} onChange={(e) => set({ saleDate: e.target.value || todayInput() })} /></Field>
          <Field label="GST">
            <select className="erp-input" value={f.gstRate} onChange={(e) => set({ gstRate: e.target.value })}>
              {GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
            </select>
          </Field>
        </div>

        {!f.warehouseId ? (
          <div className="purchases-empty">Choose the warehouse first; its stock is listed to pick from.</div>
        ) : !stockQuery.data ? (
          stockQuery.error ? <ErrorState message={stockQuery.error} onRetry={() => void stockQuery.reload()} /> : <Loading />
        ) : stock.length === 0 ? (
          <div className="purchases-empty">Nothing is in stock in this warehouse.</div>
        ) : (
          <>
            <div className="purchases-line-table overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr><th className="w-8 px-3 py-2">#</th><th className="px-3 py-2">Item in stock *</th><th className="px-3 py-2">Quantity *</th><th className="px-3 py-2">Rate (₹) *</th><th className="px-3 py-2 text-right">Amount</th><th className="w-10" /></tr></thead>
                <tbody>
                  {lines.map((line, index) => {
                    const row = stockByKey.get(line.stock);
                    const over = !!row && toNumber(line.quantity) > row.balanceKg + EMPTY;
                    return (
                      <tr key={line.key}>
                        <td className="px-3 text-xs text-gray-400">{index + 1}</td>
                        <td className="p-1.5 align-top">
                          <select className="erp-input" value={line.stock} onChange={(e) => updateLine(line.key, { stock: e.target.value })} aria-label={`Item, line ${index + 1}`}>
                            <option value="">Select item</option>
                            {categories.map((category) => (
                              <optgroup key={category} label={humanize(category)}>
                                {stock.filter((s) => s.category === category).map((s) => (
                                  <option key={stockKey(s)} value={stockKey(s)} disabled={lines.some((l) => l.key !== line.key && l.stock === stockKey(s))}>
                                    {s.itemCode} · {s.itemName}{s.lotNo ? ` · lot ${s.lotNo}` : ""} · {unitQty(s.balanceKg, s.unit)}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td className="p-1.5 align-top">
                          <span className="flex gap-1.5">
                            {(row?.unit ?? "KG").toUpperCase() === "KG" ? (
                              <WeightInput compact wrapperClassName="flex-1" value={line.quantity} onValueChange={(quantity) => updateLine(line.key, { quantity })} aria-invalid={over} aria-label={`Quantity, line ${index + 1}`} />
                            ) : (
                              <Input type="number" min="0.001" step={row?.unit.toUpperCase() === "G" ? "1" : "0.001"} inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} aria-invalid={over} aria-label={`Quantity, line ${index + 1}`} />
                            )}
                            {row && <Button size="sm" variant="outline" className="h-auto shrink-0" onClick={() => updateLine(line.key, { quantity: String(Math.round(row.balanceKg * 1000) / 1000) })}>All</Button>}
                          </span>
                          {row && <span className={cn("mt-0.5 block text-[11px]", over ? "text-red-600" : "text-gray-400")}>{over ? "More than " : ""}{unitQty(row.balanceKg, row.unit)} in stock</span>}
                        </td>
                        <td className="p-1.5 align-top"><Input type="number" min="0" step="0.01" inputMode="decimal" value={line.rate} placeholder={row ? `per ${row.unit}` : "0.00"} onChange={(e) => updateLine(line.key, { rate: e.target.value })} aria-label={`Rate, line ${index + 1}`} /></td>
                        <td className="whitespace-nowrap p-2 text-right font-semibold">{money(amountOf(line))}</td>
                        <td className="pr-1.5">
                          <button type="button" className="purchases-row-action purchases-row-action--delete" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1 && !line.stock && !line.quantity && !line.rate} onClick={() => setLines((current) => (current.length === 1 ? [newLine()] : current.filter((l) => l.key !== line.key)))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <Button variant="outline" disabled={lines.length >= 50} onClick={() => setLines((current) => [...current, newLine()])}><Plus size={15} /> Add item</Button>
            </div>
          </>
        )}
      </section>

      <section className="item-details-section">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#1b3c55]"><Truck size={15} /> Vehicle</h3>
        <p className="-mt-2 text-xs text-gray-500">The warehouse sees these and can correct them when the vehicle leaves.</p>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Field label="Vehicle no"><Input value={f.vehicleNo} maxLength={30} className="uppercase" placeholder="TN 39 AB 1234" onChange={(e) => set({ vehicleNo: e.target.value.toUpperCase() })} /></Field>
          <Field label="Driver"><Input value={f.driverName} maxLength={80} onChange={(e) => set({ driverName: e.target.value })} /></Field>
          <Field label="Driver phone"><Input type="tel" value={f.driverPhone} maxLength={30} onChange={(e) => set({ driverPhone: e.target.value })} /></Field>
          <Field label="Transporter"><Input value={f.transporter} maxLength={120} onChange={(e) => set({ transporter: e.target.value })} /></Field>
          <Field label="LR no"><Input value={f.lrNo} maxLength={60} onChange={(e) => set({ lrNo: e.target.value })} /></Field>
        </div>
        <Field label="Notes" hint="Optional · printed on the bill"><Input value={f.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </section>

      <div className="sale-form-foot">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div><dt className="inline text-gray-500">Taxable </dt><dd className="inline font-semibold">{money(subtotal)}</dd></div>
          <div><dt className="inline text-gray-500">GST {f.gstRate}% </dt><dd className="inline font-semibold">{money(gst)}</dd></div>
          <div><dt className="inline text-gray-500">Total </dt><dd className="inline text-base font-black text-[#1b3c55]">{money(subtotal + gst)}</dd></div>
        </dl>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={busy}><Send size={15} /> {busy ? "Saving…" : sale ? "Save & send again" : "Save & send to warehouse"}</Button>
        </div>
      </div>
    </form>
  );
}
