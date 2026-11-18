"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Download, FileText, Search, X } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { STATUS_LABEL, statusTone, type PurchaseStatus } from "@/lib/purchases";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, kg, money } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ReceiveCheck } from "@/components/ui/receive-check";
import { itemHref } from "../warehouses/item-details";
import "../yarn-received/yarn-received.css";

type Knit = { flowNo: string; fabric: string; mill: string | null; startedAt: string | null; done: boolean; yarnKg: number; fabricKg: number | null; colours: number };
type Check = { label: string; ordered: string; ok: boolean; received?: string };
/** `GET /procurement/yarn-lines`: one yarn line ordered, what came, its checks and where its yarn is now. */
type YarnLine = {
  id: string;
  po: { id: string; poNo: string; orderDate: string; expectedDate: string | null; status: PurchaseStatus; supplier: { code: string; name: string }; warehouse: { code: string } | null };
  itemName: string;
  itemCode: string | null;
  unit: string;
  specs: Array<{ label: string; value: string }>;
  orderedQty: number;
  receivedQty: number;
  balanceQty: number;
  rate: number | null;
  amount: number | null;
  receipts: Array<{
    id: string;
    receiptNo: string;
    receivedAt: string;
    dcNo: string | null;
    vehicleNo: string | null;
    lotNo: string | null;
    warehouse: string;
    quantity: number;
    dcQuantity: number | null;
    packages: string | null;
    packageCount: number | null;
    details: string | null;
    checks: Check[];
  }>;
  usage: { inStockKg: number; toKnittingKg: number; returnedKg: number; otherOutKg: number; knitting: Knit[] } | null;
};

type Filter = "all" | "coming" | "part" | "received" | "stock" | "used";
const EMPTY = 0.0005;
const qty = (v: number, unit: string) => (unit.toUpperCase() === "KG" ? kg(v) : `${v.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`);
const spec = (l: YarnLine, label: string) => l.specs.find((s) => s.label.toLowerCase() === label.toLowerCase())?.value ?? null;
const arrival = (l: YarnLine): Exclude<Filter, "all" | "stock" | "used"> => (l.receivedQty <= EMPTY ? "coming" : l.balanceQty > EMPTY && !["RECEIVED", "CLOSED"].includes(l.po.status) ? "part" : "received");
const usedUp = (l: YarnLine) => !!l.usage && l.receivedQty > EMPTY && l.usage.inStockKg <= EMPTY;
const inStock = (l: YarnLine) => !!l.usage && l.usage.inStockKg > EMPTY;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "coming", label: "Not received" },
  { value: "part", label: "Part received" },
  { value: "received", label: "Received" },
  { value: "stock", label: "In stock" },
  { value: "used", label: "Used up" },
];

/**
 * Yarn on purchase orders, line by line, like the yarn received register: each count ordered with its details (count,
 * quality, blend, mill, shade, bags), ordered against received and still to come, and the yarn's code and where it is
 * now. A line opens into every receipt (the supplier's DC, the weight weighed against it, bags, each ordered detail
 * checked, its received challan), the yarn in stock, at knitting and back, and the knitting batches it went into.
 */
export function YarnPurchases({ showPrices, onChallan }: { showPrices: boolean; onChallan: (receiptId: string) => void }) {
  const { data, error, reload } = useApiQuery<YarnLine[]>("/procurement/yarn-lines");
  const [find, setFind] = useState("");
  const [supplier, setSupplier] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const all = useMemo(() => data ?? [], [data]);
  const suppliers = useMemo(() => [...new Set(all.map((l) => l.po.supplier.name))].sort(), [all]);
  const q = find.trim().toUpperCase();
  const lines = all.filter((l) => {
    if (supplier && l.po.supplier.name !== supplier) return false;
    if (filter === "stock" && !inStock(l)) return false;
    if (filter === "used" && !usedUp(l)) return false;
    if (["coming", "part", "received"].includes(filter) && arrival(l) !== filter) return false;
    if (!q) return true;
    return [l.itemCode, l.itemName, l.po.poNo, l.po.supplier.name, ...l.specs.map((s) => s.value), ...l.receipts.flatMap((r) => [r.receiptNo, r.dcNo]), ...(l.usage?.knitting.map((k) => k.flowNo) ?? [])].some((v) => v?.toUpperCase().includes(q));
  });
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, coming: 0, part: 0, received: 0, stock: 0, used: 0 };
    for (const l of all) {
      c[arrival(l)] += 1;
      if (inStock(l)) c.stock += 1;
      if (usedUp(l)) c.used += 1;
    }
    return c;
  }, [all]);
  const kgLines = lines.filter((l) => l.unit.toUpperCase() === "KG");
  const sum = (pick: (l: YarnLine) => number) => kgLines.reduce((t, l) => t + pick(l), 0);
  const totals = {
    ordered: sum((l) => l.orderedQty),
    received: sum((l) => l.receivedQty),
    toCome: sum((l) => (["RECEIVED", "CLOSED"].includes(l.po.status) ? 0 : l.balanceQty)),
    inStock: sum((l) => Math.max(0, l.usage?.inStockKg ?? 0)),
    atKnitting: sum((l) => l.usage?.toKnittingKg ?? 0),
    value: showPrices ? lines.reduce((t, l) => t + (l.amount ?? 0), 0) : null,
  };
  const filtered = !!(q || supplier || filter !== "all");

  const exportCsv = () =>
    downloadCsv(
      "yarn-purchases.csv",
      ["PO No", "Order date", "Supplier", "Count / item", "Details", "Bags", "Ordered", "Received", "To come", "Unit", ...(showPrices ? ["Rate", "Amount"] : []), "Yarn code", "Receipts (GRN · DC · qty)", "In stock KG", "At knitting KG"],
      lines.map((l) => [
        l.po.poNo,
        l.po.orderDate.slice(0, 10),
        l.po.supplier.name,
        l.itemName,
        l.specs.map((s) => `${s.label} ${s.value}`).join("; "),
        spec(l, "Bags") ?? "",
        l.orderedQty,
        l.receivedQty,
        l.balanceQty,
        l.unit,
        ...(showPrices ? [l.rate ?? "", l.amount ?? ""] : []),
        l.itemCode ?? "",
        l.receipts.map((r) => `${r.receiptNo} · DC ${r.dcNo ?? "—"} · ${r.quantity}`).join("; "),
        l.usage?.inStockKg ?? "",
        l.usage?.toKnittingKg ?? "",
      ]),
    );

  if (!data) return error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error} <button type="button" className="underline" onClick={() => void reload()}>Try again</button></p> : <Loading />;

  return (
    <div className="yarn-reg">
      <div className="yarn-reg__tiles">
        <div><p>Yarn ordered</p><strong>{kg(totals.ordered)}</strong><span>{lines.length} line{lines.length === 1 ? "" : "s"} on {new Set(lines.map((l) => l.po.id)).size} POs</span></div>
        <div><p>Received</p><strong>{kg(totals.received)}</strong><span>{lines.reduce((t, l) => t + l.receipts.length, 0)} receipts</span></div>
        <div><p>Still to come</p><strong>{kg(totals.toCome)}</strong><span>on open POs</span></div>
        <div><p>In stock now</p><strong>{kg(totals.inStock)}</strong><span>{kg(totals.atKnitting)} at knitting</span></div>
        {showPrices && <div><p>Ordered value</p><strong>{money(totals.value ?? 0)}</strong><span>at the PO rates</span></div>}
      </div>

      <div className="yarn-reg__filters">
        <label className="yarn-reg__find">
          <Search size={15} aria-hidden />
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a yarn code, count, PO, supplier, GRN, DC or knitting batch" aria-label="Find" />
        </label>
        <select className="erp-input w-48" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier">
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="yarn-reg__states" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={filter === f.value} className={cn(f.value === "stock" && "is-stock", f.value === "part" && "is-partly")} onClick={() => setFilter(f.value)}>
              {f.label} <b>{counts[f.value]}</b>
            </button>
          ))}
        </div>
        {filtered && <button type="button" className="yarn-reg__clear" onClick={() => { setFind(""); setSupplier(""); setFilter("all"); }}><X size={13} /> Clear</button>}
        <Button size="sm" variant="outline" className="ml-auto" disabled={!lines.length} onClick={exportCsv}><Download size={14} /> CSV</Button>
      </div>

      <section className="yarn-sheet">
        {lines.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">{all.length ? "No yarn line matches." : "No yarn ordered yet. Create a purchase order with Yarn as the material."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="yarn-sheet__table">
              <thead>
                <tr>
                  <th>Order</th><th>Supplier</th><th>Count · details</th><th className="num">Bags</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">To come</th>
                  {showPrices && <th className="num">Rate</th>}
                  <th>Yarn code</th><th>Now</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const isOpen = open === l.id;
                  const pct = l.orderedQty > 0 ? Math.min(100, (l.receivedQty / l.orderedQty) * 100) : 0;
                  return (
                    <Fragment key={l.id}>
                      <tr className={cn("yarn-row", isOpen && "is-open")} onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}>
                        <td>
                          <Link href={`/purchases/${l.po.id}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-[#1b3c55] hover:underline">{l.po.poNo}</Link>
                          <span className="block text-[11px] text-gray-500">{formatDate(l.po.orderDate)}</span>
                        </td>
                        <td>{l.po.supplier.name}<span className="block"><Badge tone={statusTone(l.po.status)}>{STATUS_LABEL[l.po.status]}</Badge></span></td>
                        <td className="whitespace-normal">
                          <b>{l.itemName.toUpperCase()}</b>
                          {l.specs.filter((s) => !["bags", "kg per bag"].includes(s.label.toLowerCase())).length > 0 && (
                            <span className="purchases-item-specs">{l.specs.filter((s) => !["bags", "kg per bag"].includes(s.label.toLowerCase())).map((s) => <span key={s.label}>{s.label} {s.value}</span>)}</span>
                          )}
                        </td>
                        <td className="num">{spec(l, "Bags") ?? "—"}</td>
                        <td className="num">{qty(l.orderedQty, l.unit)}</td>
                        <td className="num font-semibold">
                          {l.receivedQty > EMPTY ? qty(l.receivedQty, l.unit) : "—"}
                          <span className="yarn-share mt-1"><span style={{ width: `${pct}%` }} /></span>
                        </td>
                        <td className="num">{["RECEIVED", "CLOSED"].includes(l.po.status) ? "—" : l.balanceQty > EMPTY ? qty(l.balanceQty, l.unit) : "—"}</td>
                        {showPrices && <td className="num">{l.rate === null ? "—" : money(l.rate)}</td>}
                        <td>{l.itemCode ? <Link href={itemHref(l.itemCode)} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-[#1b3c55] hover:underline" title="Yarn story">{l.itemCode}</Link> : <span className="text-xs text-gray-400">on receipt</span>}</td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            {!l.usage ? <span className="text-xs text-gray-400">—</span> : l.usage.inStockKg > EMPTY ? <span className={cn("yarn-state", l.usage.toKnittingKg > EMPTY || l.usage.knitting.length ? "is-part" : "is-stock")}>{kg(l.usage.inStockKg)} in stock</span> : <span className="yarn-state is-used">Used up</span>}
                            <ChevronDown size={14} className={cn("text-gray-400 transition-transform", isOpen && "rotate-180")} aria-hidden />
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="yarn-detail-row">
                          <td colSpan={showPrices ? 10 : 9}><LineDetail line={l} showPrices={showPrices} onChallan={onChallan} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** One yarn line in full: what was ordered, every receipt with its checks and challan, and where the yarn is now. */
function LineDetail({ line: l, showPrices, onChallan }: { line: YarnLine; showPrices: boolean; onChallan: (receiptId: string) => void }) {
  const u = l.usage;
  const knitted = u ? u.knitting.filter((k) => k.done).reduce((t, k) => t + k.yarnKg, 0) : 0;
  const atKnitting = u ? Math.max(0, u.toKnittingKg - knitted) : 0;
  const base = Math.max(l.receivedQty, 1);
  const share = (v: number) => `${Math.min(100, (v / base) * 100)}%`;
  return (
    <div className="yarn-detail">
      <div className="yarn-detail__grid">
        <div className="min-w-0">
          <p className="yarn-detail__label">Ordered</p>
          <dl className="yarn-detail__facts">
            <div><dt>Purchase order</dt><dd>{l.po.poNo} · {formatDate(l.po.orderDate)}</dd></div>
            <div><dt>Supplier</dt><dd>{l.po.supplier.name} · {l.po.supplier.code}</dd></div>
            <div><dt>Quantity</dt><dd>{qty(l.orderedQty, l.unit)}</dd></div>
            <div><dt>Deliver to</dt><dd>{l.po.warehouse?.code ?? "—"}</dd></div>
            {showPrices && <div><dt>Rate · value</dt><dd>{l.rate === null ? "—" : `${money(l.rate)} / ${l.unit} · ${money(l.amount ?? 0)}`}</dd></div>}
            {l.specs.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
          </dl>
        </div>
        {u && (
          <div className="yarn-detail__now">
            <p className="yarn-detail__label">Where this yarn is now</p>
            <div className="yarn-detail__bar" aria-hidden>
              <span className="is-knitted" style={{ width: share(knitted) }} />
              <span className="is-knitting" style={{ width: share(atKnitting) }} />
              <span className="is-stock" style={{ width: share(Math.max(0, u.inStockKg)) }} />
            </div>
            <ul className="yarn-detail__legend">
              <li className="is-stock"><span />In stock <b>{kg(Math.max(0, u.inStockKg))}</b></li>
              <li className="is-knitting"><span />At knitting <b>{kg(atKnitting)}</b></li>
              <li className="is-knitted"><span />Knitted (used) <b>{kg(knitted)}</b></li>
              {u.returnedKg > EMPTY && <li><span className="is-back" />Came back from knitting <b>{kg(u.returnedKg)}</b></li>}
              {u.otherOutKg > EMPTY && <li><span className="is-other" />Out otherwise <b>{kg(u.otherOutKg)}</b></li>}
            </ul>
          </div>
        )}
      </div>

      <div>
        <p className="yarn-detail__label">Received · {qty(l.receivedQty, l.unit)} of {qty(l.orderedQty, l.unit)}</p>
        {l.receipts.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="yarn-detail__knits">
              <thead><tr><th>Receipt</th><th>Date</th><th>Their DC</th><th className="num">Bags</th><th className="num">On DC</th><th className="num">Weighed</th><th>Check</th><th>Details checked</th><th /></tr></thead>
              <tbody>
                {l.receipts.map((r) => {
                  const off = r.checks.filter((c) => !c.ok);
                  return (
                    <tr key={r.id}>
                      <td className="font-mono font-semibold">{r.receiptNo}</td>
                      <td>{formatDate(r.receivedAt)} · {r.warehouse}</td>
                      <td>{r.dcNo ?? "—"}{r.vehicleNo ? <span className="block text-[11px] text-gray-500">{r.vehicleNo}</span> : null}</td>
                      <td className="num">{r.packages ? `${r.packages}${r.packageCount !== null && r.packages !== String(r.packageCount) ? ` = ${r.packageCount}` : ""}` : "—"}</td>
                      <td className="num">{r.dcQuantity !== null ? qty(r.dcQuantity, l.unit) : "—"}</td>
                      <td className="num font-semibold">{qty(r.quantity, l.unit)}</td>
                      <td>{r.dcQuantity !== null ? <ReceiveCheck sent={r.dcQuantity} received={r.quantity} unit={l.unit.toUpperCase()} /> : <span className="text-[11px] text-gray-400">no DC qty</span>}</td>
                      <td className="whitespace-normal text-xs">
                        {r.checks.length === 0 ? <span className="text-gray-400">—</span> : off.length ? (
                          <span className="font-semibold text-rose-700">{off.map((c) => `${c.label}: ordered ${c.ordered}, came ${c.received || "different"}`).join("; ")}</span>
                        ) : (
                          <span className="font-semibold text-emerald-700">All {r.checks.length} as ordered</span>
                        )}
                        {r.details && <span className="block text-gray-500">{r.details}</span>}
                      </td>
                      <td><button type="button" className="yarn-challan" onClick={() => onChallan(r.id)} title="Open the received challan"><FileText size={12} aria-hidden /> Challan</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {u && u.knitting.length > 0 && (
        <div>
          <p className="yarn-detail__label">Knitting batches from this yarn</p>
          <div className="overflow-x-auto">
            <table className="yarn-detail__knits">
              <thead><tr><th>Batch</th><th>Fabric</th><th>Knitted at</th><th className="num">Yarn</th><th className="num">Fabric made</th><th>Check</th><th>Now</th></tr></thead>
              <tbody>
                {u.knitting.map((k) => (
                  <tr key={k.flowNo}>
                    <td><Link href={`/production?batch=${encodeURIComponent(k.flowNo)}`} className="font-mono font-semibold text-[#1b3c55] hover:underline">{k.flowNo}</Link></td>
                    <td>{k.fabric}{k.colours ? <span className="text-gray-500"> · {k.colours} colour{k.colours === 1 ? "" : "s"}</span> : null}</td>
                    <td className="text-gray-600">{k.mill ?? "—"}{k.startedAt ? ` · ${formatDate(k.startedAt)}` : ""}</td>
                    <td className="num">{kg(k.yarnKg)}<span className="block text-[10px] text-gray-400">{k.done ? "used" : "given"}</span></td>
                    <td className="num font-semibold">{k.fabricKg !== null ? kg(k.fabricKg) : "—"}</td>
                    <td>{k.done && k.fabricKg !== null ? <ReceiveCheck sent={k.yarnKg} received={k.fabricKg} unit="KG" warnPct={5} /> : <span className="text-[11px] text-gray-400">when finished</span>}</td>
                    <td><span className={cn("yarn-state", k.done ? "is-used" : "is-part")}>{k.done ? "Knitted" : "Knitting"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {l.itemCode && <Link href={itemHref(l.itemCode)} className="yarn-detail__story">Full yarn story: fabrics, colours and weight checks <ArrowRight size={14} /></Link>}
    </div>
  );
}
