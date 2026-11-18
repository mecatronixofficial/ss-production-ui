"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  categoryFor,
  KG_CATEGORIES,
  qty,
  receivedQuantity,
  remainingQuantity,
  STOCK_CATEGORIES,
  type PurchaseOrder,
  type PurchaseStatus,
  type PurchaseWarehouse,
} from "@/lib/purchases";
import type { StockCategory } from "@/lib/types";
import { useApiAction } from "@/lib/use-api-action";
import { cn, formatDate, humanize, isWeightUnit, money } from "@/lib/utils";
import { stockText, type WarehouseSummary } from "@/lib/warehouses";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { PACKAGES_PATTERN, packageTotal, packageUnitOf, ReceiveCheck } from "@/components/ui/receive-check";
import { WeightInput } from "@/components/ui/weight-input";

/** What the godown checks on a line besides what it weighed: the DC's quantity, bags / rolls, and the count or shade. */
type LineCheck = { dc: string; packages: string; details: string };
const NO_CHECK: LineCheck = { dc: "", packages: "", details: "" };
/** An ordered detail as checked: as ordered (true), different (false, with what came) or not checked yet (null). */
type DetailCheck = { ok: boolean | null; received: string };
const UNCHECKED: DetailCheck = { ok: null, received: "" };

/** What the receipt posted: the stock categories it went into, and each line's item code (`isNew` when given just now). */
export type ReceiveResult = {
  receiptId: string;
  receiptNo: string;
  status: PurchaseStatus;
  categories: StockCategory[];
  codes: Array<{ itemName: string; itemCode: string; isNew: boolean }>;
};

const decimals = (value: string) => (value.split(".")[1] ?? "").length;
/** Grams are whole numbers (they are kept in stock as KG to 3 decimals); other units take 3 decimals. */
const maxDecimals = (unit: string) => (unit.toUpperCase() === "G" ? 0 : 3);

/** "GRN-2026-000006 posted. New codes: 03SS26 Cotton 30s." for a success message. */
export const receiptSummary = (result: ReceiveResult) => {
  const fresh = result.codes.filter((c) => c.isNew);
  return fresh.length ? ` New item code${fresh.length === 1 ? "" : "s"}: ${fresh.map((c) => `${c.itemCode} ${c.itemName}`).join(", ")}.` : "";
};

/**
 * Goods receipt (GRN) for one open purchase order: enter what arrived today, with the distributor's challan and the
 * vehicle; the rest stays open. Each line is checked: the quantity on their DC against what the godown weighed or
 * counted (matches, short or excess), its bags / rolls (as written, e.g. 30+9) and its count or shade. Posting it
 * updates stock, tells the office and godown, and gives a received challan that prints the checks.
 * Used on the Purchases page and on a warehouse's page, where `fixedWarehouse` receives straight into it.
 */
export function ReceiveDialog({
  purchaseOrders,
  initialPurchaseOrderId = "",
  warehouses,
  fixedWarehouse,
  warehouseSummary,
  onClose,
  onReceived,
}: {
  /** Open POs to choose from. */
  purchaseOrders: PurchaseOrder[];
  initialPurchaseOrderId?: string;
  /** Active warehouses the material can go into (ignored with `fixedWarehouse`). */
  warehouses: PurchaseWarehouse[];
  fixedWarehouse?: PurchaseWarehouse;
  warehouseSummary?: WarehouseSummary[];
  onClose: () => void;
  /** After posting; open the received challan with `result.receiptId`. */
  onReceived: (result: ReceiveResult, po: PurchaseOrder) => void;
}) {
  const defaultWarehouse = (po?: PurchaseOrder) =>
    fixedWarehouse?.id ??
    (po?.warehouseId && warehouses.some((w) => w.id === po.warehouseId) ? po.warehouseId : undefined) ??
    warehouses.find((w) => w.code.includes("YARN"))?.id ??
    warehouses[0]?.id ??
    "";
  const firstPo = purchaseOrders.find((po) => po.id === initialPurchaseOrderId) ?? (purchaseOrders.length === 1 ? purchaseOrders[0] : undefined);
  const [purchaseOrderId, setPurchaseOrderId] = useState(firstPo?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse(firstPo));
  const [category, setCategory] = useState<StockCategory>(categoryFor(firstPo?.supplier.materialCategory));
  const [lotNo, setLotNo] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, LineCheck>>({});
  const checkOf = (id: string) => checks[id] ?? NO_CHECK;
  const [details, setDetails] = useState<Record<string, Record<string, DetailCheck>>>({});
  const detailOf = (id: string, label: string) => details[id]?.[label] ?? UNCHECKED;
  const setDetail = (id: string, label: string, changes: Partial<DetailCheck>) =>
    setDetails((current) => ({ ...current, [id]: { ...current[id], [label]: { ...(current[id]?.[label] ?? UNCHECKED), ...changes } } }));
  const allAsOrdered = (item: PurchaseOrder["items"][number]) =>
    setDetails((current) => ({ ...current, [item.id]: Object.fromEntries((item.specs ?? []).map((s) => [s.label, { ok: true, received: "" }])) }));
  /** A line being received now with ordered details still to check, or marked different without saying what came. */
  const unchecked = (item: PurchaseOrder["items"][number]) =>
    Number(quantities[item.id] || 0) > 0 && (item.specs ?? []).some((s) => detailOf(item.id, s.label).ok === null || (detailOf(item.id, s.label).ok === false && !detailOf(item.id, s.label).received.trim()));
  const setCheck = (id: string, changes: Partial<LineCheck>) => setChecks((current) => ({ ...current, [id]: { ...(current[id] ?? NO_CHECK), ...changes } }));
  const { message, run, reject, busy } = useApiAction();

  const po = purchaseOrders.find((row) => row.id === purchaseOrderId);
  const stock = warehouseSummary?.find((w) => w.id === warehouseId);
  /** Lines still to receive that were ordered with details: each gets a card to check them on. */
  const checkable = (po?.items ?? []).filter((item) => (item.specs?.length ?? 0) > 0 && remainingQuantity(item) > 0);
  const [flashed, setFlashed] = useState<string | null>(null);
  const showCheck = (id: string) => {
    document.getElementById(`grn-check-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashed(id);
    window.setTimeout(() => setFlashed((current) => (current === id ? null : current)), 1600);
  };
  // Warehouse staff get POs without rates, so there is no value to show them.
  const pricesShown = !!po?.items.every((item) => item.rate !== null);
  const receiptValue = po ? po.items.reduce((sum, item) => sum + Number(quantities[item.id] || 0) * Number(item.rate ?? 0), 0) : 0;
  // Lines are received as the material they were ordered as; only older lines without one need a category here.
  const needsCategory = !!po?.items.some((item) => !item.category);
  const lineCategory = (item: PurchaseOrder["items"][number]) => item.category ?? category;
  const nonKgLines = po ? po.items.filter((item) => KG_CATEGORIES.includes(lineCategory(item)) && !isWeightUnit(item.unit)) : [];

  const choose = (id: string) => {
    const next = purchaseOrders.find((row) => row.id === id);
    setPurchaseOrderId(id);
    setQuantities({});
    setChecks({});
    setDetails({});
    setLotNo("");
    setChallanNo("");
    setVehicleNo("");
    setNotes("");
    if (next) {
      setCategory(categoryFor(next.supplier.materialCategory));
      setWarehouseId(defaultWarehouse(next));
    }
  };

  const save = async () => {
    if (!po || !warehouseId) return reject("Select a purchase order and receiving warehouse.", "Check receipt");
    const invalid = po.items.find((item) => {
      const value = quantities[item.id] ?? "";
      return value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0 || decimals(value) > maxDecimals(item.unit));
    });
    if (invalid)
      return reject(
        `${invalid.itemName}: enter a quantity of 0 or more, ${maxDecimals(invalid.unit) ? "with up to 3 decimals" : "in whole grams"}.`,
        "Check receipt",
      );
    const badPackages = po.items.find((item) => checkOf(item.id).packages.trim() && !PACKAGES_PATTERN.test(checkOf(item.id).packages));
    if (badPackages) return reject(`${badPackages.itemName}: write ${packageUnitOf(lineCategory(badPackages))} as numbers, e.g. 12 or 30+9.`, "Check receipt");
    const badDc = po.items.find((item) => checkOf(item.id).dc.trim() && !(Number(checkOf(item.id).dc) > 0));
    if (badDc) return reject(`${badDc.itemName}: the DC quantity must be a number above 0.`, "Check receipt");
    const over = po.items.find((item) => Number(quantities[item.id] || 0) > remainingQuantity(item) + 1e-9);
    if (over) return reject(`${over.itemName}: only ${qty(remainingQuantity(over), over.unit)} is still to come.`, "Check receipt");
    const notChecked = po.items.find(unchecked);
    if (notChecked) {
      showCheck(notChecked.id);
      return reject(`${notChecked.itemName}: check its ordered details below (Same, or Different and what came), or tap All as ordered.`, "Check receipt");
    }
    const items = po.items
      .map((item) => {
        const check = checkOf(item.id);
        return {
          purchaseOrderItemId: item.id,
          quantity: Math.round(Number(quantities[item.id] || 0) * 1000) / 1000,
          dcQuantity: check.dc.trim() ? Math.round(Number(check.dc) * 1000) / 1000 : undefined,
          packages: check.packages.replace(/\s+/g, "") || undefined,
          details: check.details.trim() || undefined,
          checks: item.specs?.length
            ? item.specs.map((s) => ({ label: s.label, ordered: s.value, ok: detailOf(item.id, s.label).ok === true, received: detailOf(item.id, s.label).received.trim() || undefined }))
            : undefined,
        };
      })
      .filter((item) => item.quantity > 0);
    if (items.length === 0) return reject("Enter a received quantity for at least one item.", "Check receipt");
    let result: ReceiveResult | undefined;
    const ok = await run(async () => {
      result = await api<ReceiveResult>(`/procurement/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          category: needsCategory ? category : undefined,
          lotNo: lotNo.trim() || undefined,
          challanNo: challanNo.trim() || undefined,
          vehicleNo: vehicleNo.trim().toUpperCase() || undefined,
          notes: notes.trim() || undefined,
          items,
        }),
      });
    });
    if (ok && result) onReceived(result, po);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog purchases-dialog" aria-describedby="receive-dialog-help">
          <div className="users-dialog__head">
            <div className="purchases-card-heading">
              <span className="purchases-step-badge purchases-step-badge--2"><ClipboardCheck size={14} /></span>
              <div>
                <Dialog.Title className="text-base font-bold text-[#1b3c55]">
                  Receive Material (GRN){fixedWarehouse ? ` into ${fixedWarehouse.code}` : ""}
                </Dialog.Title>
                <p id="receive-dialog-help" className="text-xs text-gray-500">
                  Enter only what arrived today. Whatever is left stays open on the PO. Each item gets its own code (01SS26…) the first time it is received.
                </p>
              </div>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <form
            noValidate
            className="users-dialog__body"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <InlineMessage message={message} />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label>
                <span className="erp-label">Purchase order *</span>
                <select className="erp-input" value={purchaseOrderId} onChange={(event) => choose(event.target.value)}>
                  <option value="">{purchaseOrders.length ? "Select purchase order" : "No open purchase orders"}</option>
                  {purchaseOrders.map((row) => (
                    <option key={row.id} value={row.id}>{row.poNo} · {row.supplier.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="erp-label">Receiving warehouse *</span>
                {fixedWarehouse ? (
                  <Input value={`${fixedWarehouse.code} · ${fixedWarehouse.name}`} disabled />
                ) : (
                  <select className="erp-input" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                    <option value="">Select warehouse</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                  </select>
                )}
                {stock && (
                  <span className="mt-1 block text-[11px] text-gray-500">
                    In stock now: <strong className="text-gray-700">{stockText(stock)}</strong>
                    {stock.itemCount ? ` · ${stock.itemCount} item${stock.itemCount === 1 ? "" : "s"}` : ""}
                  </span>
                )}
                {po?.warehouse && !fixedWarehouse && po.warehouse.id !== warehouseId && (
                  <span className="mt-0.5 block text-[11px] text-amber-700">This PO was meant for {po.warehouse.code}.</span>
                )}
              </label>
              {needsCategory && (
                <label>
                  <span className="erp-label">Stock category</span>
                  <select className="erp-input" value={category} onChange={(event) => setCategory(event.target.value as StockCategory)}>
                    {STOCK_CATEGORIES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
                  </select>
                  <span className="mt-1 block text-[11px] text-gray-500">For items ordered without a material.</span>
                </label>
              )}
              <label>
                <span className="erp-label">Supplier challan / invoice no</span>
                <Input value={challanNo} maxLength={60} onChange={(event) => setChallanNo(event.target.value)} placeholder="As written on their challan" />
              </label>
              <label>
                <span className="erp-label">Vehicle no</span>
                <Input value={vehicleNo} maxLength={30} className="uppercase" onChange={(event) => setVehicleNo(event.target.value)} placeholder="TN 39 AB 1234" />
              </label>
              <label>
                <span className="erp-label">Supplier lot / batch</span>
                <Input value={lotNo} maxLength={60} onChange={(event) => setLotNo(event.target.value)} placeholder="Optional lot number" />
              </label>
              <label className="sm:col-span-2">
                <span className="erp-label">Remarks</span>
                <Input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Optional, e.g. 2 bags torn, weight checked" />
              </label>
            </div>

            {po ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    {po.supplier.name} · ordered {formatDate(po.orderDate)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setQuantities(Object.fromEntries(po.items.map((item) => [item.id, remainingQuantity(item) > 0 ? String(Number(remainingQuantity(item).toFixed(3))) : ""])))}
                  >
                    Receive all remaining
                  </Button>
                </div>
                <div className="purchases-line-table overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2.5">Item · count / details</th>
                        <th className="px-3 py-2.5">Still to come</th>
                        <th className="px-3 py-2.5">On their DC</th>
                        <th className="px-3 py-2.5">Received here *</th>
                        <th className="px-3 py-2.5">Bags / rolls</th>
                        <th className="px-3 py-2.5">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((item) => {
                        const remaining = remainingQuantity(item);
                        const value = quantities[item.id] ?? "";
                        const tooMuch = Number(value || 0) > remaining + 1e-9;
                        const badNumber = value !== "" && (Number(value) < 0 || decimals(value) > maxDecimals(item.unit));
                        const check = checkOf(item.id);
                        const packUnit = packageUnitOf(lineCategory(item));
                        const packs = packageTotal(check.packages);
                        const badPacks = !!check.packages.trim() && packs === null;
                        const here = value === "" ? null : Number(value);
                        const ordered = item.specs ?? [];
                        const checkedCount = ordered.filter((s) => detailOf(item.id, s.label).ok !== null).length;
                        const differs = ordered.filter((s) => detailOf(item.id, s.label).ok === false).length;
                        return (
                          <tr key={item.id} className="align-top">
                            <td className="px-3 py-2">
                              <p className="font-semibold">{item.itemName}</p>
                              <p className="text-xs text-gray-400">
                                {item.itemCode ?? <span className="text-emerald-700">New code on receipt</span>} · {humanize(lineCategory(item))}
                              </p>
                              {ordered.length > 0 && remaining > 0 && (
                                <button
                                  type="button"
                                  className={cn("grn-check__jump", differs > 0 ? "has-diff" : checkedCount === ordered.length ? "is-ok" : "")}
                                  onClick={() => showCheck(item.id)}
                                >
                                  {differs > 0 ? `${differs} detail${differs === 1 ? "" : "s"} different` : checkedCount === ordered.length ? `All ${ordered.length} details as ordered` : `Check ${ordered.length - checkedCount} detail${ordered.length - checkedCount === 1 ? "" : "s"}`} ↓
                                </button>
                              )}
                              <Input
                                className="mt-1.5 h-8 max-w-56 text-xs"
                                maxLength={160}
                                disabled={remaining <= 0}
                                placeholder={lineCategory(item) === "YARN" ? "Count / shade, e.g. 36'S VL" : "Details (optional)"}
                                value={check.details}
                                onChange={(event) => setCheck(item.id, { details: event.target.value })}
                                aria-label={`Details, ${item.itemName}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-semibold">{remaining > 0 ? qty(remaining, item.unit) : <span className="text-emerald-700">Complete</span>}</p>
                              <p className="text-[11px] text-gray-500">of {qty(Number(item.quantity), item.unit)}{receivedQuantity(item) > 0 ? ` · ${qty(receivedQuantity(item), item.unit)} in` : ""}</p>
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                className="max-w-32"
                                inputMode="decimal"
                                disabled={remaining <= 0}
                                placeholder={item.unit.toUpperCase() === "KG" ? "DC KG" : `DC ${item.unit}`}
                                value={check.dc}
                                onChange={(event) => setCheck(item.id, { dc: event.target.value.replace(/[^\d.]/g, "") })}
                                aria-label={`Quantity on their DC, ${item.itemName}`}
                              />
                              {check.dc && !value && remaining > 0 && (
                                <button type="button" className="mt-0.5 text-[11px] font-semibold text-[#1b3c55] underline" onClick={() => setQuantities((current) => ({ ...current, [item.id]: String(Math.min(Number(check.dc), remaining)) }))}>
                                  Same as DC
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              {item.unit.toUpperCase() === "KG" ? (
                                <WeightInput
                                  compact
                                  wrapperClassName="max-w-40"
                                  className={cn((tooMuch || badNumber) && "border-red-400")}
                                  disabled={remaining <= 0}
                                  value={quantities[item.id] || ""}
                                  onValueChange={(next) => setQuantities((current) => ({ ...current, [item.id]: next }))}
                                  placeholder="weighed"
                                  aria-label={`Received here, ${item.itemName}`}
                                  aria-invalid={tooMuch || badNumber}
                                />
                              ) : (
                                <Input
                                  className={cn("max-w-36", (tooMuch || badNumber) && "border-red-400")}
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  max={remaining}
                                  step={item.unit.toUpperCase() === "G" ? "1" : "0.001"}
                                  disabled={remaining <= 0}
                                  value={quantities[item.id] || ""}
                                  onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                                  placeholder={item.unit.toUpperCase() === "G" ? "grams" : "counted"}
                                  aria-label={`Received here, ${item.itemName}`}
                                  aria-invalid={tooMuch || badNumber}
                                />
                              )}
                              {tooMuch && <p className="mt-0.5 text-[11px] text-red-600">Only {qty(remaining, item.unit)} left</p>}
                              {badNumber && !tooMuch && <p className="mt-0.5 text-[11px] text-red-600">{maxDecimals(item.unit) ? "0 or more, up to 3 decimals" : "Whole grams, 0 or more"}</p>}
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                className={cn("max-w-28", badPacks && "border-red-400")}
                                disabled={remaining <= 0}
                                placeholder={`${packUnit}, e.g. 30+9`}
                                value={check.packages}
                                onChange={(event) => setCheck(item.id, { packages: event.target.value.replace(/[^\d+\s]/g, "") })}
                                aria-label={`${packUnit}, ${item.itemName}`}
                              />
                              {packs !== null && check.packages.includes("+") && <p className="mt-0.5 text-[11px] text-gray-500">= {packs} {packUnit}</p>}
                              {badPacks && <p className="mt-0.5 text-[11px] text-red-600">Numbers, e.g. 30+9</p>}
                            </td>
                            <td className="px-3 py-2">
                              {check.dc && here !== null ? (
                                <ReceiveCheck sent={Number(check.dc)} received={here} unit={item.unit.toUpperCase()} />
                              ) : (
                                <span className="text-[11px] text-gray-400">{remaining <= 0 ? "—" : "Enter the DC quantity to check"}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {checkable.length > 0 && (
                  <section className="grn-checks" aria-label="Check against the order">
                    <div className="grn-checks__head">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#1b3c55]">Check against the order</p>
                        <p className="text-[11px] text-gray-500">For each detail ordered, tap Same, or Different and write what came.</p>
                      </div>
                      <button type="button" className="grn-check__all" onClick={() => checkable.forEach(allAsOrdered)}>Everything as ordered</button>
                    </div>
                    {checkable.map((item) => {
                      const ordered = item.specs ?? [];
                      const checkedCount = ordered.filter((s) => detailOf(item.id, s.label).ok !== null).length;
                      const differs = ordered.filter((s) => detailOf(item.id, s.label).ok === false).length;
                      return (
                        <div
                          key={item.id}
                          id={`grn-check-${item.id}`}
                          className={cn("grn-check", differs > 0 && "has-diff", checkedCount === ordered.length && differs === 0 && "is-ok", flashed === item.id && "is-flash")}
                        >
                          <div className="grn-check__head">
                            <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{item.itemName}</span>
                            {item.itemCode && <span className="font-mono text-[11px] text-gray-500">{item.itemCode}</span>}
                            <span className="text-[11px] text-gray-500">{checkedCount} of {ordered.length} checked{differs ? ` · ${differs} different` : ""}</span>
                            <button type="button" className="grn-check__all" onClick={() => allAsOrdered(item)}>All as ordered</button>
                          </div>
                          <div className="grn-check__grid">
                            {ordered.map((spec) => {
                              const d = detailOf(item.id, spec.label);
                              return (
                                <div key={spec.label} className={cn("grn-check__item", d.ok === true && "is-ok", d.ok === false && "is-diff")}>
                                  <p className="text-[11px] font-bold text-gray-500">{spec.label}</p>
                                  <p className="truncate text-sm font-semibold text-gray-900" title={spec.value}>{spec.value}</p>
                                  <div className="grn-check__toggle" role="group" aria-label={`${spec.label}: as ordered?`}>
                                    <button type="button" aria-pressed={d.ok === true} onClick={() => setDetail(item.id, spec.label, { ok: true, received: "" })}>Same</button>
                                    <button type="button" aria-pressed={d.ok === false} onClick={() => setDetail(item.id, spec.label, { ok: false })}>Different</button>
                                  </div>
                                  {d.ok === false && (
                                    <Input
                                      className="mt-1 h-7 text-xs"
                                      maxLength={120}
                                      placeholder="What came"
                                      value={d.received}
                                      onChange={(event) => setDetail(item.id, spec.label, { received: event.target.value })}
                                      aria-label={`${spec.label} that came, ${item.itemName}`}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                )}
                {nonKgLines.length > 0 && (
                  <p className="text-xs text-amber-700">
                    Yarn and fabric are usually counted in KG. {nonKgLines.map((item) => item.itemName).join(", ")}{" "}
                    {nonKgLines.length === 1 ? "is" : "are"} ordered in {[...new Set(nonKgLines.map((item) => item.unit))].join(" / ")} and will be kept in that unit.
                  </p>
                )}
                {po.items.some((item) => item.unit.toUpperCase() === "G") && (
                  <p className="text-xs text-gray-500">Lines ordered in grams (G) go into stock in KG: 500 g is added as 0.5 KG.</p>
                )}
              </>
            ) : (
              <div className="purchases-empty">Select the purchase order this material came for.</div>
            )}

            <div className="users-dialog__foot items-center">
              {po && (
                <div className="mr-auto text-sm">
                  {pricesShown ? <>Receipt value <strong>{money(receiptValue)}</strong></> : <span className="text-xs text-gray-500">A received challan is made for the office when you post.</span>}
                  {(() => {
                    const packed = po.items.reduce((sum, item) => sum + (packageTotal(checkOf(item.id).packages) ?? 0), 0);
                    const short = po.items.filter((item) => checkOf(item.id).dc && quantities[item.id] && Number(quantities[item.id]) < Number(checkOf(item.id).dc) - 0.0005).length;
                    const differing = po.items.reduce((sum, item) => sum + (item.specs ?? []).filter((s) => detailOf(item.id, s.label).ok === false).length, 0);
                    const toCheck = po.items.filter(unchecked).length;
                    const notes = [
                      packed ? <span key="p">{packed} bags / rolls</span> : null,
                      short ? <span key="s" className="font-semibold text-rose-700">{short} line{short === 1 ? "" : "s"} short of the DC</span> : null,
                      differing ? <span key="d" className="font-semibold text-rose-700">{differing} detail{differing === 1 ? "" : "s"} different from the order</span> : null,
                      toCheck ? <span key="c" className="font-semibold text-amber-700">{toCheck} line{toCheck === 1 ? "" : "s"} still to check</span> : null,
                    ].filter(Boolean);
                    return notes.length ? <p className="flex flex-wrap gap-x-2 text-[11px] text-gray-600">{notes}</p> : null;
                  })()}
                </div>
              )}
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" className="purchases-action-btn" disabled={busy || !po}>
                <ClipboardCheck size={16} />
                {busy ? "Posting..." : "Post receipt & make challan"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

