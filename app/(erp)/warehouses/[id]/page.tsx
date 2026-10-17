"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Boxes, Download, Layers, PackageCheck, ReceiptIndianRupee, Search, Warehouse as WarehouseIcon, X } from "lucide-react";
import { qs } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { ADMIN_ROLES, GODOWN_EDIT_ROLES } from "@/lib/navigation";
import type { PurchaseOrder } from "@/lib/purchases";
import type { Sale } from "@/lib/sales";
import type { StockCategory } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, humanize, todayInput } from "@/lib/utils";
import { quantity, stockText, type WarehouseSummary } from "@/lib/warehouses";
import { useAuth } from "@/components/auth-provider";
import { Empty } from "@/components/empty";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionCenter } from "../action-center";
import { itemHref } from "../item-details";
import type { IncomingFabric } from "../receive-fabric-dialog";
import { sortRows, SortMenu, type SortKey } from "../sort-menu";
import { DatePick } from "../date-pick";

/** One item code's position in the warehouse, from `/inventory/items-summary`. */
type ItemRow = {
  itemCode: string;
  itemName: string;
  category: StockCategory;
  unit: string;
  lots: string[];
  inQty: number;
  outQty: number;
  balance: number;
  soldQty: number;
  otherOutQty: number;
  soldThisMonth: number;
  lastSoldAt: string | null;
  /** When the item last moved in or out here. */
  lastMovedAt: string | null;
  /** Whether it moved in the chosen dates (always true without dates). */
  moved: boolean;
};

/** ISO start / end of a local `YYYY-MM-DD` day. */
const dayStart = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const dayEnd = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);

const EMPTY = 0.0005;
/** Per-unit totals as text, e.g. "1,200.000 KG · 40.000 CONE". */
const totalsOf = (rows: ItemRow[], pick: (row: ItemRow) => number) => {
  const totals: Record<string, number> = {};
  for (const row of rows) totals[row.unit] = (totals[row.unit] ?? 0) + pick(row);
  return stockText({ totals }) === "Empty" ? "0.000 KG" : stockText({ totals });
};

/**
 * `/warehouses/<id>`: one warehouse in full — what is waiting there, and every material by item code: received, sold,
 * otherwise issued and in stock now. Stock entries and bills stay on the warehouse's stock page.
 */
export default function WarehouseDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canEdit = !!user && GODOWN_EDIT_ROLES.includes(user.role);
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const summary = useApiQuery<WarehouseSummary[]>("/masters/warehouses/summary");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const ranged = !!(from || to);
  // With dates, received / sold / issued cover those dates; in stock is always today's.
  const items = useApiQuery<ItemRow[]>(`/inventory/items-summary${qs({ warehouseId: id, from: dayStart(from), to: dayEnd(to) })}`);
  const sales = useApiQuery<Sale[]>(canEdit ? `/sales/outgoing${qs({ warehouseId: id })}` : null);
  const pos = useApiQuery<PurchaseOrder[]>(`/procurement/incoming${qs({ warehouseId: id })}`);
  const fabric = useApiQuery<IncomingFabric[]>(`/production/incoming-fabric${qs({ warehouseId: id })}`);
  const bills = useApiQuery<{ unbilled: number }>(isAdmin ? `/inventory/bills${qs({ warehouseId: id })}` : null);
  const [category, setCategory] = useState<"ALL" | StockCategory>("ALL");
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(true);

  const rows = useMemo(() => items.data ?? [], [items.data]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = rows.filter(
      (r) =>
        (category === "ALL" || r.category === category) &&
        (ranged ? r.moved : !inStockOnly || Math.abs(r.balance) > EMPTY) &&
        (!q || [r.itemCode, r.itemName, ...r.lots].some((v) => v.toLowerCase().includes(q))),
    );
    return sortRows(shown, sort, (r) => ({ date: r.lastMovedAt, name: r.itemName, code: r.itemCode }));
  }, [rows, category, search, inStockOnly, ranged, sort]);

  const warehouse = summary.data?.find((w) => w.id === id);
  const stockPage = `/warehouses?warehouse=${id}`;
  const back = <Link href="/warehouses?warehouse=all" className="purchases-back-link"><ArrowLeft size={15} /> All warehouses</Link>;
  if (!summary.data || !items.data) {
    const error = summary.error || items.error;
    return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void Promise.all([summary.reload(), items.reload()])} /></div> : <Loading />;
  }
  if (!warehouse) return <div className="inventory-list-page">{back}<Empty title="Warehouse not found" description="It may have been deleted. Open a warehouse from the list." /></div>;

  const negatives = rows.filter((r) => r.balance < -EMPTY).map((r) => ({ itemCode: r.itemCode, itemName: r.itemName, lotNo: null, unit: r.unit, balanceKg: r.balance }));
  const inStock = rows.filter((r) => Math.abs(r.balance) > EMPTY);
  const soldMonth = rows.filter((r) => r.soldThisMonth > EMPTY);
  const pending = (sales.data?.length ?? 0) + (pos.data?.length ?? 0) + (fabric.data?.length ?? 0);

  const exportItems = () =>
    downloadCsv(
      `${warehouse.code}-items-${ranged ? `${from || "start"}-to-${to || todayInput()}` : todayInput()}.csv`,
      ["Item code", "Item", "Material", "Lots", "Received", "Sold", "Other issued", "In stock", "Unit", "Sold this month", "Last sold"],
      visible.map((r) => [r.itemCode, r.itemName, humanize(r.category), r.lots.join(" "), r.inQty.toFixed(3), r.soldQty.toFixed(3), r.otherOutQty.toFixed(3), r.balance.toFixed(3), r.unit, r.soldThisMonth.toFixed(3), r.lastSoldAt?.slice(0, 10)]),
    );

  return (
    <div className="inventory-list-page">
      {back}

      <header className="wh-hero">
        <div className="wh-hero__top">
          <div className="flex min-w-0 items-center gap-3">
            <span className="wh-hero__icon"><WarehouseIcon size={20} /></span>
            <div className="min-w-0">
              <p className="wh-hero__eyebrow">Warehouse details{warehouse.location ? ` · ${warehouse.location}` : ""}</p>
              <h2 className="wh-hero__title">
                {warehouse.code}
                <span>{warehouse.name}</span>
                {!warehouse.active && <Badge tone="warning">Inactive</Badge>}
              </h2>
            </div>
          </div>
          <Button className="wh-hero__cta" asChild><Link href={stockPage}><Boxes size={15} /> Stock & entries</Link></Button>
        </div>
        <div className="wh-hero__stats">
          <div><p>In stock now</p><strong>{stockText(warehouse)}</strong></div>
          <div><p>Item codes in stock</p><strong>{inStock.length}</strong></div>
          <div><p>Sold this month</p><strong>{soldMonth.length ? totalsOf(soldMonth, (r) => r.soldThisMonth) : "Nothing yet"}</strong></div>
          <div className={cn(pending > 0 && "is-alert")}><p>Waiting here</p><strong>{pending}</strong></div>
        </div>
      </header>

      <ActionCenter
        sales={sales.data ?? []}
        purchaseOrders={pos.data ?? []}
        fabric={fabric.data ?? []}
        unbilled={isAdmin ? bills.data?.unbilled ?? null : null}
        negatives={negatives}
        canEdit={canEdit}
        canBill={isAdmin}
        inactive={!warehouse.active}
        actionsHref={stockPage}
      />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(warehouse.byCategory).map(([material, totals]) => (
          <button
            key={material}
            type="button"
            data-material={material}
            className={cn("wh-tile text-left", category === material && "is-active")}
            aria-pressed={category === material}
            onClick={() => setCategory(category === material ? "ALL" : (material as StockCategory))}
          >
            <span className="wh-tile__icon"><Layers size={16} /></span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">{humanize(material)}</span>
              <span className="block truncate text-lg font-bold">{Object.entries(totals).map(([unit, value]) => quantity(value, unit)).join(" · ")}</span>
              <span className="block text-[11px] text-gray-400">{rows.filter((r) => r.category === material && Math.abs(r.balance) > EMPTY).length} item codes</span>
            </span>
          </button>
        ))}
        {Object.keys(warehouse.byCategory).length === 0 && <p className="text-sm text-gray-500">Nothing in stock here.</p>}
      </div>

      <section className="item-details-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><PackageCheck size={14} /></span>
            <div>
              <h3 className="text-sm font-bold text-[#1b3c55]">Stock by item code</h3>
              <p className="text-xs text-gray-500">
                {ranged
                  ? <>Received, sold and otherwise issued <b>{from ? formatDate(from) : "from the start"} – {to ? formatDate(to) : "today"}</b>; in stock is today&apos;s balance. Only items that moved in these dates.</>
                  : "Received, sold (dispatched on sales), otherwise issued (production, knitting, waste…) and in stock now."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <Search size={16} className="text-gray-400" aria-hidden />
              <Input value={search} placeholder="Search code, item or lot" aria-label="Search items" onChange={(e) => setSearch(e.target.value)} />
            </label>
            <Button size="sm" variant="outline" disabled={visible.length === 0} onClick={exportItems}><Download size={14} /> Export CSV</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="purchases-filters" role="tablist" aria-label="Material">
            {(["ALL", ...categories] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={category === value} className={cn(category === value && "is-active")} onClick={() => setCategory(value)}>
                {value === "ALL" ? "All materials" : humanize(value)} <span>{value === "ALL" ? rows.length : rows.filter((r) => r.category === value).length}</span>
              </button>
            ))}
          </div>
          {!ranged && (
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
              In stock only
            </label>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <div className="wh-dates">
              <DatePick label="From date" value={from} max={to || todayInput()} onChange={setFrom} />
              <span>to</span>
              <DatePick label="To date" value={to} min={from || undefined} max={todayInput()} onChange={setTo} />
              {ranged && (
                <button type="button" className="wh-dates__clear" aria-label="All dates" title="All dates" onClick={() => { setFrom(""); setTo(""); }}>
                  <X size={13} />
                </button>
              )}
            </div>
            <SortMenu value={sort} onChange={setSort} />
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="purchases-empty">{ranged ? "Nothing moved here in these dates." : rows.length ? "No item matches." : "Nothing has been received here yet."}</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2">Item code</th>
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2 text-right">Received{ranged && <span className="block text-[10px] font-normal normal-case">in dates</span>}</th>
                  <th className="px-3 py-2 text-right">Sold{ranged && <span className="block text-[10px] font-normal normal-case">in dates</span>}</th>
                  <th className="px-3 py-2 text-right">Other issued{ranged && <span className="block text-[10px] font-normal normal-case">in dates</span>}</th>
                  <th className="px-3 py-2 text-right">In stock{ranged && <span className="block text-[10px] font-normal normal-case">today</span>}</th>
                  <th className="px-3 py-2">Sold this month</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const soldPct = r.inQty > 0 ? Math.min(100, (r.soldQty / r.inQty) * 100) : 0;
                  const leftPct = r.inQty > 0 ? Math.max(0, Math.min(100, (r.balance / r.inQty) * 100)) : 0;
                  return (
                    <tr key={`${r.itemCode}|${r.unit}`}>
                      <td className="px-3 py-2">
                        <Link href={itemHref(r.itemCode, id)} className="customers-code">{r.itemCode}</Link>
                        <span className="mt-0.5 block text-xs text-gray-600">{r.itemName}</span>
                        {r.lastMovedAt && <span className="block text-[11px] text-gray-400">Last moved {formatDate(r.lastMovedAt)}</span>}
                        {r.lots.length > 0 && <span className="block text-[11px] text-gray-400">Lot {r.lots.slice(0, 3).join(", ")}{r.lots.length > 3 ? ` +${r.lots.length - 3}` : ""}</span>}
                      </td>
                      <td className="px-3 py-2"><Badge tone="info">{humanize(r.category)}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{quantity(r.inQty, r.unit)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-blue-700">{r.soldQty > EMPTY ? quantity(r.soldQty, r.unit) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600">{r.otherOutQty > EMPTY ? quantity(r.otherOutQty, r.unit) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <span className={cn("font-bold tabular-nums", r.balance < -EMPTY ? "text-red-600" : r.balance > EMPTY ? "text-emerald-700" : "text-gray-400")}>{quantity(r.balance, r.unit)}</span>
                        {!ranged && <span className="wh-split" aria-hidden title={`${soldPct.toFixed(0)}% sold · ${leftPct.toFixed(0)}% in stock`}>
                          <span className="is-sold" style={{ width: `${soldPct}%` }} />
                          <span className="is-left" style={{ width: `${leftPct}%` }} />
                        </span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {r.soldThisMonth > EMPTY ? <span className="font-semibold text-blue-700">{quantity(r.soldThisMonth, r.unit)}</span> : <span className="text-gray-400">—</span>}
                        {r.lastSoldAt && <span className="block text-gray-400">Last sold {formatDate(r.lastSoldAt)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="px-3 py-2.5 text-right font-bold">Total ({visible.length} item codes)</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{totalsOf(visible, (r) => r.inQty)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-blue-700">{totalsOf(visible, (r) => r.soldQty)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{totalsOf(visible, (r) => r.otherOutQty)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-emerald-700">{totalsOf(visible, (r) => r.balance)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{totalsOf(visible, (r) => r.soldThisMonth)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><i className="wh-legend is-sold" /> Sold</span>
          <span className="inline-flex items-center gap-1"><i className="wh-legend is-left" /> In stock</span>
          <span className="inline-flex items-center gap-1"><ReceiptIndianRupee size={12} /> Sales are entered on the Sales page and leave stock when dispatched here.</span>
        </p>
      </section>
    </div>
  );
}
