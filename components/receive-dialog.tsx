"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  categoryFor,
  isOverdue,
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
import { WeightInput } from "@/components/ui/weight-input";

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

/** "GRN-2026-000006 posted. New codes: SS-2026-003 Cotton 30s." for a success message. */
export const receiptSummary = (result: ReceiveResult) => {
  const fresh = result.codes.filter((c) => c.isNew);
  return fresh.length ? ` New item code${fresh.length === 1 ? "" : "s"}: ${fresh.map((c) => `${c.itemCode} ${c.itemName}`).join(", ")}.` : "";
};

/**
 * Goods receipt (GRN) for one open purchase order: enter what arrived today, with the distributor's challan and the
 * vehicle; the rest stays open. Posting it updates stock, tells the office and godown, and gives a received challan.
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
  const { message, run, reject, busy } = useApiAction();

  const po = purchaseOrders.find((row) => row.id === purchaseOrderId);
  const stock = warehouseSummary?.find((w) => w.id === warehouseId);
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
    const over = po.items.find((item) => Number(quantities[item.id] || 0) > remainingQuantity(item) + 1e-9);
    if (over) return reject(`${over.itemName}: only ${qty(remainingQuantity(over), over.unit)} is still to come.`, "Check receipt");
    const items = po.items
      .map((item) => ({ purchaseOrderItemId: item.id, quantity: Math.round(Number(quantities[item.id] || 0) * 1000) / 1000 }))
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
                  Enter only what arrived today. Whatever is left stays open on the PO. Each item gets its own code (SS-2026-001…) the first time it is received.
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
                    <option key={row.id} value={row.id}>{row.poNo} · {row.supplier.name}{isOverdue(row) ? " · overdue" : ""}</option>
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
                <span className="erp-label">Distributor challan / invoice no</span>
                <Input value={challanNo} maxLength={60} onChange={(event) => setChallanNo(event.target.value)} placeholder="As written on their challan" />
              </label>
              <label>
                <span className="erp-label">Vehicle no</span>
                <Input value={vehicleNo} maxLength={30} className="uppercase" onChange={(event) => setVehicleNo(event.target.value)} placeholder="TN 39 AB 1234" />
              </label>
              <label>
                <span className="erp-label">Distributor lot / batch</span>
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
                    {po.expectedDate ? ` · expected ${formatDate(po.expectedDate)}` : ""}
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
                  <table className="w-full min-w-[720px] text-sm">
                    <thead><tr><th className="px-3 py-2.5">Item</th><th className="px-3 py-2.5">Ordered</th><th className="px-3 py-2.5">Already received</th><th className="px-3 py-2.5">Remaining</th><th className="px-3 py-2.5">Receive now</th></tr></thead>
                    <tbody>
                      {po.items.map((item) => {
                        const remaining = remainingQuantity(item);
                        const value = quantities[item.id] ?? "";
                        const tooMuch = Number(value || 0) > remaining + 1e-9;
                        const badNumber = value !== "" && (Number(value) < 0 || decimals(value) > maxDecimals(item.unit));
                        return (
                          <tr key={item.id}>
                            <td className="px-3 py-2">
                              <p className="font-semibold">{item.itemName}</p>
                              <p className="text-xs text-gray-400">
                                {item.itemCode ?? <span className="text-emerald-700">New code on receipt</span>} · {humanize(lineCategory(item))}
                              </p>
                            </td>
                            <td className="px-3 py-2">{qty(Number(item.quantity), item.unit)}</td>
                            <td className="px-3 py-2 text-blue-700">{qty(receivedQuantity(item), item.unit)}</td>
                            <td className="px-3 py-2 font-semibold">{remaining > 0 ? qty(remaining, item.unit) : <span className="text-emerald-700">Complete</span>}</td>
                            <td className="px-3 py-1.5">
                              {item.unit.toUpperCase() === "KG" ? (
                                <WeightInput
                                  compact
                                  wrapperClassName="max-w-48"
                                  className={cn((tooMuch || badNumber) && "border-red-400")}
                                  disabled={remaining <= 0}
                                  value={quantities[item.id] || ""}
                                  onValueChange={(value) => setQuantities((current) => ({ ...current, [item.id]: value }))}
                                  placeholder="0.000"
                                  aria-label={`Receive now, ${item.itemName}`}
                                  aria-invalid={tooMuch || badNumber}
                                />
                              ) : (
                                <Input
                                  className={cn("max-w-44", (tooMuch || badNumber) && "border-red-400")}
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  max={remaining}
                                  step={item.unit.toUpperCase() === "G" ? "1" : "0.001"}
                                  disabled={remaining <= 0}
                                  value={quantities[item.id] || ""}
                                  onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                                  placeholder={item.unit.toUpperCase() === "G" ? "grams" : "0.000"}
                                  aria-label={`Receive now, ${item.itemName}`}
                                  aria-invalid={tooMuch || badNumber}
                                />
                              )}
                              {tooMuch && <p className="mt-0.5 text-[11px] text-red-600">Only {qty(remaining, item.unit)} left</p>}
                              {badNumber && !tooMuch && <p className="mt-0.5 text-[11px] text-red-600">{maxDecimals(item.unit) ? "0 or more, up to 3 decimals" : "Whole grams, 0 or more"}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                <p className="mr-auto text-sm">
                  {pricesShown ? <>Receipt value <strong>{money(receiptValue)}</strong></> : <span className="text-xs text-gray-500">A received challan is made for the office when you post.</span>}
                </p>
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

