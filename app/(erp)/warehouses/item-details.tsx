"use client";

import Link from "next/link";
import { Boxes, Factory, History, Layers, ReceiptIndianRupee, Route, ShoppingCart, Warehouse as WarehouseIcon } from "lucide-react";
import { qs } from "@/lib/api";
import { STATUS_LABEL, statusTone, type PurchaseStatus } from "@/lib/purchases";
import type { StockCategory } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime, humanize, money, toNumber } from "@/lib/utils";
import { quantity } from "@/lib/warehouses";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { BatchJourney, ItemSummary, RunsTable, SalesTable, type JourneyBatch, type JourneyRun, type JourneySale, type MovementTotal } from "./item-journey";
import { YarnStorySection, type YarnStory } from "./yarn-story";
import { ReceiveCheck } from "@/components/ui/receive-check";

type ItemDetails = {
  itemCode: string;
  itemName: string;
  otherNames: string[];
  categories: StockCategory[];
  stock: Array<{
    category: StockCategory;
    lotNo: string | null;
    unit: string;
    quantityIn: number;
    quantityOut: number;
    balanceKg: number;
    warehouseId: string;
    warehouse: { code: string; name: string } | null;
  }>;
  purchases: Array<{
    id: string;
    purchaseOrder: { id: string; poNo: string; orderDate: string; status: PurchaseStatus; supplier: { code: string; name: string } };
    quantity: number;
    unit: string;
    rate: number;
    /** Its details as ordered (count, quality, shade…). */
    specs: Array<{ label: string; value: string }>;
    receipts: Array<{
      receiptNo: string;
      receivedAt: string;
      lotNo: string | null;
      challanNo: string | null;
      warehouse: { code: string };
      quantity: number;
      /** What was checked on arrival. */
      dcQuantity: number | null;
      packages: string | null;
      packageCount: number | null;
      details: string | null;
      checks: Array<{ label: string; ordered: string; ok: boolean; received?: string }>;
    }>;
  }>;
  /** What the item is: count, quality, shade… as ordered; fabric type, dia, GSM, colour… as made; mill and DC for yarn received. */
  specs: Array<{ label: string; value: string }>;
  movements: Array<{
    id: string;
    createdAt: string;
    txnType: string;
    lotNo: string | null;
    quantityIn: string;
    quantityOut: string;
    unit: string;
    referenceType: string;
    referenceId: string;
    notes: string | null;
    warehouse: { code: string };
  }>;
  movementsCapped: boolean;
  /** Production batches this code went into as yarn, or came out of as finished fabric. */
  batches: Array<{
    flowNo: string;
    status: string;
    fabricType: string | null;
    fabricDiameter: string | null;
    fabricGsm: string | null;
    purchasedWeightKg: number;
    dyeingDeliveryKg: number | null;
    officeDeliveryKg: number | null;
    finalDeliveredKg: number | null;
  }>;
  /** Knitting machine runs this code was loaded on as yarn, or knitted as grey fabric. */
  knittingRuns: Array<{
    runNo: string;
    status: "RUNNING" | "FINISHED";
    startedAt: string;
    finishedAt: string | null;
    yarnKg: number;
    outputKg: number | null;
    thisYarnKg: number;
    machine: { code: string };
  }>;
  /** Every movement added up by type, for the summary (received, made, used, sold, moved). */
  totals: MovementTotal[];
  /** Each batch it went into or is, from yarn to delivery. */
  journey: JourneyBatch[];
  /** Knitting runs outside those batches that used it or knitted it. */
  runs: JourneyRun[];
  /** Sales of the code and of fabric made from it. */
  sales: JourneySale[];
  /** The yarn behind the code (itself, or the yarn a batch, lot or run was made from), receipt to delivery. */
  yarnStory: YarnStory | null;
};

const EMPTY = 0.0005;

/**
 * The page with one item's full details. Codes can hold spaces, colons and slashes, so the code goes in the query.
 * `warehouse` is the warehouse it was opened from: highlighted in the stock table and used by the back link.
 */
export const itemHref = (code: string, warehouseId?: string) => `/warehouses/item${qs({ code, warehouse: warehouseId || undefined })}`;

function Section({ icon: Icon, title, caption, children }: { icon: typeof Boxes; title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="item-details-section">
      <div className="item-details-section__head">
        <span className="item-details-section__icon"><Icon size={14} /></span>
        <div>
          <h3 className="text-sm font-bold text-[#1b3c55]">{title}</h3>
          {caption && <p className="text-xs text-gray-500">{caption}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Everything about one item code: name, material, stock in every warehouse, where it was bought, and its movements. */
export function ItemDetailsView({ itemCode, currentWarehouseId, showPrices = true }: { itemCode: string; currentWarehouseId?: string; showPrices?: boolean }) {
  const { data, error, reload } = useApiQuery<ItemDetails>(`/inventory/item${qs({ code: itemCode })}`);

  if (!data) return error ? <ErrorState message={error} onRetry={() => void reload()} /> : <Loading />;

  const held = data.stock.filter((row) => Math.abs(row.balanceKg) > EMPTY);
  const totals: Record<string, number> = {};
  for (const row of held) totals[row.unit] = (totals[row.unit] ?? 0) + row.balanceKg;
  const inStock = Object.entries(totals).map(([unit, value]) => quantity(value, unit)).join(" · ") || "Nothing";
  const holding = [...new Set(held.map((row) => row.warehouse?.code ?? "?"))];
  const negative = held.some((row) => row.balanceKg < -EMPTY);

  return (
    <>
      <div className="item-details-header">
        <span className="warehouses-page-icon"><Boxes size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            <span className="font-mono">{data.itemCode}</span>
            {data.categories.map((category) => <Badge key={category} tone="info">{humanize(category)}</Badge>)}
          </h2>
          <p className="text-sm font-semibold text-gray-700">{data.itemName}</p>
          {data.otherNames.length > 0 && <p className="text-xs text-gray-400">Also entered as {data.otherNames.join(", ")}</p>}
          {data.specs.length > 0 && (
            <dl className="item-specs">
              {data.specs.map((s) => (
                <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className={cn("godown-stat erp-card", negative && "is-warning")}>
          <span className="godown-stat__icon"><Layers size={16} /></span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">In stock now</span>
            <span className={cn("block text-lg font-bold", negative ? "text-red-600" : "text-emerald-700")}>{inStock}</span>
          </span>
        </div>
        <div className="godown-stat erp-card">
          <span className="godown-stat__icon"><WarehouseIcon size={16} /></span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">Warehouses holding it</span>
            <span className="block truncate text-lg font-bold">{holding.join(", ") || "None"}</span>
          </span>
        </div>
        <div className="godown-stat erp-card">
          <span className="godown-stat__icon"><ShoppingCart size={16} /></span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">Purchase orders</span>
            <span className="block text-lg font-bold">{data.purchases.length}</span>
          </span>
        </div>
        <div className="godown-stat erp-card">
          <span className="godown-stat__icon"><History size={16} /></span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">Movements</span>
            <span className="block text-lg font-bold">{data.movementsCapped ? `${data.movements.length}+` : data.movements.length}</span>
          </span>
        </div>
      </div>

      <Section icon={WarehouseIcon} title="Stock by warehouse and lot" caption="Open a warehouse to see this item there.">
        {data.stock.length === 0 ? (
          <div className="purchases-empty">No stock movements yet.</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2">Material</th><th className="px-3 py-2">Lot</th><th className="px-3 py-2 text-right">In</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
              <tbody>
                {data.stock.map((row) => (
                  <tr key={`${row.warehouseId}|${row.category}|${row.lotNo}|${row.unit}`} className={cn(row.warehouseId === currentWarehouseId && "bg-emerald-50/60")}>
                    <td className="px-3 py-2 font-semibold">
                      <Link href={`/warehouses${qs({ warehouse: row.warehouseId, category: row.category })}`} className="text-[#1b3c55] hover:underline" title={row.warehouse?.name}>
                        {row.warehouse?.code ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{humanize(row.category)}</td>
                    <td className="px-3 py-2">{row.lotNo || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{quantity(row.quantityIn, row.unit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{quantity(row.quantityOut, row.unit)}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", row.balanceKg < -EMPTY ? "text-red-600" : "text-emerald-700")}>{quantity(row.balanceKg, row.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {data.yarnStory && (
        <Section
          icon={Route}
          title={data.yarnStory.code === data.itemCode ? `Yarn story · ${data.yarnStory.code}` : `Made from yarn ${data.yarnStory.code}`}
          caption="How much yarn came in and was used, which fabrics were knitted from it, every colour (sub-code), and the weight at each step: loss, equal or gain."
        >
          <YarnStorySection story={data.yarnStory} />
        </Section>
      )}

      <ItemSummary totals={data.totals} />

      {data.journey.length > 0 && (
        <Section
          icon={Factory}
          title={`Production journey (${data.journey.length} batch${data.journey.length === 1 ? "" : "es"})`}
          caption="What was made: knitting (every machine run, start and finish), dyeing, compacting and where the fabric went."
        >
          <div className="space-y-3">
            {data.journey.map((batch) => (
              <BatchJourney key={batch.flowNo} batch={batch} itemCode={data.itemCode} showPrices={showPrices} />
            ))}
          </div>
        </Section>
      )}

      {data.runs.length > 0 && (
        <Section icon={Layers} title="Knitting runs" caption="Machine runs that used this code as yarn, or knitted it as grey fabric.">
          <RunsTable runs={data.runs} showPrices={showPrices} />
        </Section>
      )}

      {data.sales.length > 0 && (
        <Section icon={ReceiptIndianRupee} title={`Sold (${data.sales.length})`} caption="Every sale of this code and of the fabric made from it.">
          <SalesTable sales={data.sales} itemCode={data.itemCode} showPrices={showPrices} />
        </Section>
      )}

      <Section icon={ShoppingCart} title="Purchased on" caption="Purchase orders for this code and the receipts that brought it in.">
        {data.purchases.length === 0 ? (
          <div className="purchases-empty">Not bought on a purchase order (entered in stock directly).</div>
        ) : (
          <ul className="space-y-2">
            {data.purchases.map((line) => (
              <li key={line.id} className="rounded-xl border bg-white p-3 text-sm">
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {/* Only admins (who see prices) can open the Purchases page. */}
                    {showPrices ? (
                      <Link href={`/purchases/${line.purchaseOrder.id}`} className="text-[#1b3c55] hover:underline">{line.purchaseOrder.poNo}</Link>
                    ) : (
                      line.purchaseOrder.poNo
                    )}{" "}
                    · {line.purchaseOrder.supplier.name}{" "}
                    <Badge tone={statusTone(line.purchaseOrder.status)}>{STATUS_LABEL[line.purchaseOrder.status]}</Badge>
                  </span>
                  <span className="text-xs text-gray-500">Ordered {formatDate(line.purchaseOrder.orderDate)}</span>
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {quantity(line.quantity, line.unit)}{showPrices && <> at {money(line.rate)} / {line.unit} = <strong>{money(line.quantity * line.rate)}</strong></>}
                </p>
                {line.specs.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    <span className="text-[11px] font-semibold text-gray-500">Ordered as</span>
                    {line.specs.map((s) => <span key={s.label} className="rounded-full bg-[#eef4f8] px-2 text-[11px] font-semibold text-[#35546b]">{s.label} {s.value}</span>)}
                  </p>
                )}
                {line.receipts.length > 0 && (
                  <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
                    {line.receipts.map((r) => {
                      const off = r.checks.filter((c) => !c.ok);
                      return (
                        <li key={r.receiptNo} className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                          <p className="flex flex-wrap justify-between gap-2">
                            <span>{r.receiptNo} · {formatDate(r.receivedAt)} · {r.warehouse.code}{r.challanNo ? ` · DC ${r.challanNo}` : ""}{r.lotNo ? ` · lot ${r.lotNo}` : ""}</span>
                            <span className="font-semibold">{quantity(r.quantity, line.unit)}</span>
                          </p>
                          {(r.dcQuantity !== null || r.packages || r.details || r.checks.length > 0) && (
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              {r.dcQuantity !== null && <span>On DC {quantity(r.dcQuantity, line.unit)} <ReceiveCheck sent={r.dcQuantity} received={r.quantity} unit={line.unit.toUpperCase()} /></span>}
                              {r.packages && <span>· {r.packages}{r.packageCount !== null && r.packages !== String(r.packageCount) ? ` = ${r.packageCount}` : ""} bags / rolls</span>}
                              {r.details && <span>· {r.details}</span>}
                              {r.checks.length > 0 && (off.length ? (
                                <span className="font-semibold text-rose-700">· Differs: {off.map((c) => `${c.label} ordered ${c.ordered}, came ${c.received || "different"}`).join("; ")}</span>
                              ) : (
                                <span className="font-semibold text-emerald-700">· All {r.checks.length} details as ordered</span>
                              ))}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        icon={History}
        title={`Movements ${data.movementsCapped ? `(latest ${data.movements.length})` : `(${data.movements.length})`}`}
        caption="Every stock in and out for this code, newest first."
      >
        <div className="purchases-line-table overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2">Lot</th><th className="px-3 py-2 text-right">In / out</th><th className="px-3 py-2">Reference</th></tr></thead>
            <tbody>
              {data.movements.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">No movements yet.</td></tr>
              )}
              {data.movements.map((m) => {
                const inQty = toNumber(m.quantityIn);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(m.createdAt)}</td>
                    <td className="px-3 py-2"><Badge tone={inQty > 0 ? "success" : "warning"}>{humanize(m.txnType)}</Badge></td>
                    <td className="px-3 py-2">{m.warehouse.code}</td>
                    <td className="px-3 py-2">{m.lotNo || "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", inQty > 0 ? "text-emerald-700" : "text-rose-600")}>
                      {inQty > 0 ? `+${quantity(inQty, m.unit)}` : `−${quantity(toNumber(m.quantityOut), m.unit)}`}
                    </td>
                    <td className="max-w-[18rem] px-3 py-2 text-xs text-gray-500">
                      <span className="block truncate" title={m.notes || undefined}>{m.notes || humanize(m.referenceType)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
