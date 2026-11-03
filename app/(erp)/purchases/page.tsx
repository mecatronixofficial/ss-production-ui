"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Download,
  Eye,
  IndianRupee,
  Info,
  PackageCheck,
  Plus,
  Printer,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { downloadCsv } from "@/lib/csv";
import {
  categoryFor,
  daysToExpected,
  dueText,
  isOpen,
  isOverdue,
  orderValue,
  pendingValue,
  qty,
  receiptValue,
  receivedQuantity,
  SPEC_FIELDS,
  SPEC_GROUP_LABEL,
  specGroup,
  specsText,
  STATUS_LABEL,
  statusTone,
  STOCK_CATEGORIES,
  suggestedName,
  bagsKg,
  type ItemSpec,
  type PurchaseOrder,
  type PurchaseReceipt,
  type PurchaseStatus,
  type PurchaseSupplier,
  type PurchaseWarehouse,
} from "@/lib/purchases";
import { toast } from "@/lib/toast-store";
import type { StockCategory } from "@/lib/types";
import { prefetchApi, useApiQuery } from "@/lib/use-api-query";
import { ATTENTION_KINDS, type AttentionKind } from "@/lib/attention";
import { useAuth } from "@/components/auth-provider";
import { useNewParam } from "@/lib/use-new-param";
import { cn, formatDate, humanize, money, todayInput } from "@/lib/utils";
import { type WarehouseSummary } from "@/lib/warehouses";
import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/page-state";
import { ClosePurchaseOrderDialog } from "@/components/close-purchase-order-dialog";
import { ReceiveDialog, receiptSummary, type ReceiveResult } from "@/components/receive-dialog";
import { ReceivedChallanDialog } from "@/components/received-challan";
import { YarnPurchases } from "./yarn-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";

/**
 * A line being ordered. No item code: each line gets its own yarn code (01SS26…) when first received.
 * `category` "" follows the distributor's usual material until the line picks its own.
 */
type PurchaseLineDraft = {
  key: number;
  itemName: string;
  category: StockCategory | "";
  quantity: string;
  unit: string;
  rate: string;
  /** Its details by material (Count, Quality, Bags…), by label. */
  specs: Record<string, string>;
  /** The quantity was worked out from bags × KG per bag (and follows them until typed over). */
  autoQuantity: boolean;
};
type LineErrors = Partial<Record<"itemName" | "quantity" | "rate", string>>;
/** DUE_SOON and STALLED come from "needs attention"; the rest are the register's tabs. */
type StatusFilter = "ALL" | "OPEN" | "OVERDUE" | "DUE_SOON" | "STALLED" | PurchaseStatus;
type RegisterView = "orders" | "challans" | "yarn";
/** One goods receipt with its PO, as a row of the received-challan register. */
type ChallanRow = { receipt: PurchaseReceipt; po: PurchaseOrder; value: number; itemsText: string };

/** An open PO expected within this many days is pointed out as due soon. */
const DUE_SOON_DAYS = 3;
/** A partly received PO with no delivery for this many days has stalled. */
const STALLED_DAYS = 15;
/** The register lists the latest this many POs (the server's limit). */
const LIST_LIMIT = 1000;
const PO_LIST_PATH = "/procurement/purchase-orders";
const CONTEXT_PATH = "/procurement/context";
const WAREHOUSE_SUMMARY_PATH = "/masters/warehouses/summary";
const NO_SUPPLIERS: PurchaseSupplier[] = [];
const NO_WAREHOUSES: PurchaseWarehouse[] = [];

/** A timestamp as a day on this computer's calendar (IST), not UTC's. */
const dayOf = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysSince = (value: string) => {
  const from = new Date(value);
  from.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - from.getTime()) / 86_400_000));
};
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** The latest delivery on a PO. */
const lastReceiptAt = (po: PurchaseOrder) => po.receipts.reduce<string | null>((latest, r) => (!latest || r.receivedAt > latest ? r.receivedAt : latest), null);
/** Open and expected within DUE_SOON_DAYS (today included), not late yet. */
const isDueSoon = (po: PurchaseOrder) => {
  const days = daysToExpected(po);
  return isOpen(po) && days !== null && days >= 0 && days <= DUE_SOON_DAYS;
};
/** Partly received and nothing more delivered for STALLED_DAYS. */
const isStalled = (po: PurchaseOrder) => {
  const last = po.status === "PARTIALLY_RECEIVED" ? lastReceiptAt(po) : null;
  return !!last && daysSince(last) > STALLED_DAYS;
};
/** How much of the order (by value at its rates, or by quantity when unpriced) has arrived. */
const receivedShare = (po: PurchaseOrder) => {
  const ordered = orderValue(po);
  if (ordered > 0) return Math.min(100, (po.receipts.reduce((sum, r) => sum + receiptValue(po, r), 0) / ordered) * 100);
  const qtyOrdered = po.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  return qtyOrdered > 0 ? Math.min(100, (po.items.reduce((sum, item) => sum + receivedQuantity(item), 0) / qtyOrdered) * 100) : 0;
};
const poPath = (id: string) => `/procurement/purchase-orders/${id}`;
/** Pointing at a Receive button starts loading the warehouses' stock its window shows. */
const prefetchReceive = () => prefetchApi(WAREHOUSE_SUMMARY_PATH);

/** G = grams (dyes, chemicals): received grams go into stock as KG. */
const UNITS = ["KG", "G", "CONE", "BAG", "LTR", "PCS", "ROLL"];

let lineSeq = 0;
const blankLine = (): PurchaseLineDraft => ({ key: ++lineSeq, itemName: "", category: "", quantity: "", unit: "KG", rate: "", specs: {}, autoQuantity: false });
const isBlank = (line: PurchaseLineDraft) => !line.itemName.trim() && !line.quantity && !line.rate && !Object.values(line.specs).some((v) => v.trim());
const decimals = (value: string) => (value.split(".")[1] ?? "").length;

/**
 * Mirrors the backend DTO (quantity ≥ 0.001 with 3 decimals, rate ≥ 0 with 2) so the problem shows on the line. A line
 * without a name takes the one its details suggest.
 */
function lineErrors(line: PurchaseLineDraft, suggestion = ""): LineErrors {
  const e: LineErrors = {};
  if (!line.itemName.trim() && !suggestion) e.itemName = "Enter the item name, or its details below.";
  const quantity = Number(line.quantity);
  if (!line.quantity || !(quantity > 0)) e.quantity = "Enter a quantity above 0.";
  else if (line.unit === "G" && decimals(line.quantity) > 0) e.quantity = "Grams are whole numbers.";
  else if (decimals(line.quantity) > 3) e.quantity = "Use up to 3 decimals.";
  const rate = Number(line.rate);
  if (line.rate === "" || !Number.isFinite(rate) || rate < 0) e.rate = "Enter a rate (0 or more).";
  else if (decimals(line.rate) > 2) e.rate = "Use up to 2 decimals.";
  return e;
}

function exportPurchaseOrders(rows: PurchaseOrder[]) {
  downloadCsv(
    `purchase-orders-${todayInput()}.csv`,
    ["PO No", "Order date", "Distributor code", "Distributor", "Deliver to", "Expected", "Status", "Items", "Ordered value", "Still to come", "Receipts"],
    rows.map((po) => [
      po.poNo,
      po.orderDate.slice(0, 10),
      po.supplier.code,
      po.supplier.name,
      po.warehouse?.code ?? "",
      po.expectedDate?.slice(0, 10) ?? "",
      STATUS_LABEL[po.status],
      po.items.map((item) => `${item.itemName}${item.specs?.length ? ` (${specsText(item.specs)})` : ""} ${receivedQuantity(item)}/${Number(item.quantity)} ${item.unit}`).join("; "),
      orderValue(po).toFixed(2),
      pendingValue(po).toFixed(2),
      po.receipts.map((r) => r.receiptNo).join(" "),
    ]),
  );
}

function exportChallans(rows: ChallanRow[]) {
  downloadCsv(
    `received-challans-${todayInput()}.csv`,
    ["GRN / challan", "Received on", "PO No", "Distributor code", "Distributor", "Distributor challan no", "Vehicle", "Warehouse", "Lot", "Items", "Value", "Received by", "Remarks"],
    rows.map(({ receipt, po, value, itemsText }) => [
      receipt.receiptNo,
      dayOf(receipt.receivedAt),
      po.poNo,
      po.supplier.code,
      po.supplier.name,
      receipt.challanNo ?? "",
      receipt.vehicleNo ?? "",
      receipt.warehouse.code,
      receipt.lotNo ?? "",
      itemsText,
      value.toFixed(2),
      receipt.receivedBy ?? "",
      receipt.notes ?? "",
    ]),
  );
}

/** The page's shape while the POs load for the first time in this tab. */
function PurchasesSkeleton() {
  return (
    <div className="purchases-page" role="status" aria-label="Loading purchases">
      <div className="h-16 animate-pulse rounded-2xl bg-gray-200/60" />
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200/60" />)}
      </div>
      <div className="h-[420px] animate-pulse rounded-2xl bg-gray-200/60" />
    </div>
  );
}

export default function PurchasesPage() {
  const { user } = useAuth();
  // The POs and the distributors / warehouses to order from, kept for the tab so coming back (or reloading) shows them
  // at once while they refresh.
  const orders = useApiQuery<PurchaseOrder[]>(PO_LIST_PATH, { persist: user?.id });
  const contextQuery = useApiQuery<{ suppliers: PurchaseSupplier[]; warehouses: PurchaseWarehouse[] }>(CONTEXT_PATH, { persist: user?.id });
  const rows = orders.data ?? null;
  const loadError = orders.error;
  const suppliers = contextQuery.data?.suppliers ?? NO_SUPPLIERS;
  const warehouses = contextQuery.data?.warehouses ?? NO_WAREHOUSES;
  const [search, setSearch] = useState("");
  /** The goods-receipt window, with the PO chosen from the register ("" to pick one inside). */
  const [receiving, setReceiving] = useState<{ purchaseOrderId: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [purchase, setPurchase] = useState({ supplierId: "", warehouseId: "", expectedDate: "" });
  const [lines, setLines] = useState<PurchaseLineDraft[]>(() => [blankLine()]);
  /** The create-PO window; its draft stays in the page, so closing it keeps what was typed. */
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showLineErrors, setShowLineErrors] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [closing, setClosing] = useState<PurchaseOrder | null>(null);
  /** The goods receipt whose received challan is open (just posted, or from the register). */
  const [challanId, setChallanId] = useState<string | null>(null);
  const [registerView, setRegisterView] = useState<RegisterView>("orders");
  // Stock held per warehouse, shown only in the receipt window: it loads when that window opens (or a Receive button is
  // pointed at), not with every visit. Warehouses are managed on the Warehouses page.
  const { data: warehouseSummary, reload: reloadWarehouseSummary } = useApiQuery<WarehouseSummary[]>(receiving ? WAREHOUSE_SUMMARY_PATH : null);

  const { reload: reloadOrders } = orders;
  const { reload: reloadContext } = contextQuery;
  const load = async () => {
    await Promise.all([reloadOrders(), reloadContext()]);
  };
  const retry = () => void load();

  // Deliver to the yarn warehouse by default; keep a choice unless it was deactivated or deleted meanwhile.
  const context = contextQuery.data;
  useEffect(() => {
    if (!context) return;
    setPurchase((current) => ({
      ...current,
      supplierId: context.suppliers.some((supplier) => supplier.id === current.supplierId) ? current.supplierId : "",
      warehouseId: context.warehouses.some((warehouse) => warehouse.id === current.warehouseId)
        ? current.warehouseId
        : context.warehouses.find((warehouse) => warehouse.code.includes("YARN"))?.id || context.warehouses[0]?.id || "",
    }));
  }, [context]);

  const openPurchaseOrders = useMemo(() => (rows ?? []).filter(isOpen), [rows]);
  /** Yarn lines on live POs, for the Yarn view's tab. */
  const yarnLineCount = useMemo(() => (rows ?? []).filter((po) => po.status !== "CANCELLED").reduce((n, po) => n + po.items.filter((item) => item.category === "YARN").length, 0), [rows]);

  /** Every goods receipt across the POs, newest first: the office's register of received challans. */
  const challans = useMemo<ChallanRow[]>(
    () =>
      (rows ?? [])
        .flatMap((po) =>
          po.receipts.map((receipt) => ({
            receipt,
            po,
            value: receiptValue(po, receipt),
            itemsText: receipt.items
              .map((line) => {
                const item = po.items.find((row) => row.id === line.purchaseOrderItemId);
                return `${item?.itemName ?? "Item"} ${qty(Number(line.quantity), item?.unit ?? "")}`;
              })
              .join("; "),
          })),
        )
        .sort((a, b) => b.receipt.receivedAt.localeCompare(a.receipt.receivedAt)),
    [rows],
  );

  /** Items ordered before, by name, newest first, to suggest the name, material, unit and last rate. */
  const knownItems = useMemo(() => {
    const byName = new Map<string, { itemName: string; category?: StockCategory | null; unit: string; rate: string | null; specs?: ItemSpec[] | null }>();
    for (const po of rows ?? []) {
      for (const item of po.items) if (!byName.has(item.itemName.toLowerCase())) byName.set(item.itemName.toLowerCase(), item);
    }
    return [...byName.values()];
  }, [rows]);

  /** Opens the goods-receipt window, with a PO already chosen when opened from the register. */
  const openReceive = (purchaseOrderId = "") => {
    setMessage(null);
    setReceiving({ purchaseOrderId });
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
      void reloadWarehouseSummary();
      setMessage({ text: success, error: false });
      toast.success(success);
      return true;
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Action failed", error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancelPurchaseOrder = async (po: PurchaseOrder) => {
    const ok = await confirmDialog({
      title: `Cancel ${po.poNo}?`,
      description: `The purchase order to ${po.supplier.name} (${money(orderValue(po))}) will be cancelled. This cannot be undone.`,
      confirmLabel: "Cancel PO",
      cancelLabel: "Keep PO",
      tone: "danger",
    });
    if (!ok) return;
    await runAction(() => api(`/procurement/purchase-orders/${po.id}/cancel`, { method: "POST" }), `${po.poNo} cancelled.`);
  };

  const closePurchaseOrder = async (po: PurchaseOrder, reason: string) => {
    const ok = await runAction(
      () => api(`/procurement/purchase-orders/${po.id}/close`, { method: "POST", body: JSON.stringify({ reason: reason || undefined }) }),
      `${po.poNo} closed short.`,
    );
    if (ok) setClosing(null);
  };

  // Memoised register columns call the latest handlers through a ref.
  const actions = useRef({
    receive: (_po: PurchaseOrder) => {},
    cancel: (_po: PurchaseOrder) => {},
    close: (_po: PurchaseOrder) => {},
    challan: (_receiptId: string) => {},
  });
  actions.current = {
    receive: (po) => openReceive(po.id),
    cancel: (po) => void cancelPurchaseOrder(po),
    close: setClosing,
    challan: setChallanId,
  };

  const updateLine = (key: number, field: "itemName" | "category" | "quantity" | "unit" | "rate", value: string) => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next: PurchaseLineDraft = { ...line, [field]: value, ...(field === "quantity" ? { autoQuantity: false } : {}) };
        // Picking an item ordered before fills in the rest of the line (without overwriting what was typed).
        const known = field === "itemName" ? knownItems.find((item) => item.itemName.toLowerCase() === value.trim().toLowerCase()) : undefined;
        if (known) {
          if (line.unit === "KG" && !line.quantity) next.unit = known.unit;
          if (!next.rate && known.rate !== null) next.rate = String(Number(known.rate));
          if (!next.category && known.category) next.category = known.category;
          if (!Object.values(line.specs).some((v) => v.trim()) && known.specs?.length) next.specs = Object.fromEntries(known.specs.map((s) => [s.label, s.value]));
        }
        return next;
      }),
    );
  };
  /** A detail of a line; yarn by bags fills its KG (bags × KG per bag) until the quantity is typed over. */
  const updateSpec = (key: number, label: string, value: string) => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next: PurchaseLineDraft = { ...line, specs: { ...line.specs, [label]: value } };
        const byBags = (label === "Bags" || label === "KG per bag") && bagsKg(next.specs);
        if (byBags && (line.autoQuantity || !line.quantity)) Object.assign(next, { quantity: String(byBags.kg), unit: "KG", autoQuantity: true });
        return next;
      }),
    );
  };
  const groupOf = (line: PurchaseLineDraft) => specGroup(line.category || supplierMaterial);
  const nameOf = (line: PurchaseLineDraft) => line.itemName.trim() || suggestedName(groupOf(line), line.specs);
  const removeLine = (key: number) => setLines((current) => (current.length === 1 ? [blankLine()] : current.filter((line) => line.key !== key)));

  const supplier = suppliers.find((s) => s.id === purchase.supplierId);
  /** A new line's material until it picks one: what this distributor usually sells ("Yarn / Cotton" → Yarn). */
  const supplierMaterial = categoryFor(supplier?.materialCategory);
  const hasDraft = Boolean(purchase.supplierId || purchase.expectedDate || lines.some((line) => !isBlank(line)));

  const openCreate = () => {
    setMessage(null);
    setCreateError("");
    setCreating(true);
  };
  // `/purchases?new=1` (the "+" quick-create menu) opens the window straight away.
  useNewParam(openCreate);

  const clearDraft = () => {
    setPurchase((current) => ({ ...current, supplierId: "", expectedDate: "" }));
    setLines([blankLine()]);
    setCreateError("");
    setShowLineErrors(false);
  };

  const createPurchaseOrder = async () => {
    setCreateError("");
    const filled = lines.filter((line) => !isBlank(line));
    if (!purchase.supplierId) return setCreateError("Select a distributor.");
    if (!purchase.warehouseId) return setCreateError("Choose the warehouse the material is delivered to.");
    if (filled.length === 0) return setCreateError("Add at least one item.");
    if (filled.some((line) => Object.keys(lineErrors(line, nameOf(line))).length > 0)) {
      setShowLineErrors(true);
      return setCreateError("Fix the highlighted item lines.");
    }
    const items = filled.map((line) => ({
      itemName: nameOf(line),
      category: line.category || supplierMaterial,
      quantity: Math.round(Number(line.quantity) * 1000) / 1000,
      unit: line.unit,
      rate: Math.round(Number(line.rate) * 100) / 100,
      // In the order its form asks them; any kept from another material after the material changed go last.
      specs: [
        ...SPEC_FIELDS[groupOf(line)].map((f) => ({ label: f.label, value: line.specs[f.label] ?? "" })),
        ...Object.entries(line.specs).filter(([label]) => !SPEC_FIELDS[groupOf(line)].some((f) => f.label === label)).map(([label, value]) => ({ label, value })),
      ].filter((s) => s.value.trim()),
    }));
    setBusy(true);
    try {
      const po = await api<PurchaseOrder>("/procurement/purchase-orders", {
        method: "POST",
        body: JSON.stringify({ supplierId: purchase.supplierId, warehouseId: purchase.warehouseId, expectedDate: purchase.expectedDate || undefined, items }),
      });
      const text = `Purchase order ${po.poNo} created. ${po.warehouse?.code ?? "The warehouse"} will see it as waiting to be received; each item gets its code when it arrives.`;
      setCreating(false);
      setMessage({ text, error: false });
      toast.success(text);
      // Keep the warehouse: the next order most likely goes to the same place.
      clearDraft();
      setStatusFilter("ALL");
      await load().catch(() => undefined);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create the purchase order");
    } finally {
      setBusy(false);
    }
  };

  /** After a receipt in the window: close it, refresh the POs and stock, and say what happened. */
  const received = async (result: ReceiveResult, po: PurchaseOrder) => {
    setReceiving(null);
    setChallanId(result.receiptId);
    const text = `${result.receiptNo} posted to stock. ${po.poNo} is ${result.status === "RECEIVED" ? "fully received" : "partly received"}.${receiptSummary(result)}`;
    setMessage({ text, error: false });
    toast.success(text);
    await load().catch(() => undefined);
    void reloadWarehouseSummary();
  };

  const columns = useMemo<ColumnDef<PurchaseOrder>[]>(() => [
    {
      header: "Purchase order",
      id: "po",
      accessorFn: (row) => `${row.poNo} ${row.orderDate}`,
      cell: ({ row }) => (
        <div>
          <Link href={`/purchases/${row.original.id}`} className="font-semibold text-[#1b3c55] hover:underline" onPointerEnter={() => prefetchApi(poPath(row.original.id))} onFocus={() => prefetchApi(poPath(row.original.id))}>{row.original.poNo}</Link>
          <p className="text-xs text-gray-400">{formatDate(row.original.orderDate)}</p>
        </div>
      ),
    },
    {
      header: "Distributor",
      id: "supplier",
      accessorFn: (row) => `${row.supplier.name} ${row.supplier.code} ${row.warehouse?.code ?? ""}`,
      cell: ({ row }) => (
        <div className="max-w-40">
          <p className="truncate font-medium" title={row.original.supplier.name}>{row.original.supplier.name}</p>
          <p className="truncate text-xs text-gray-400">
            {row.original.supplier.code}
            {row.original.warehouse ? ` · to ${row.original.warehouse.code}` : ""}
          </p>
        </div>
      ),
    },
    {
      header: "Items / received",
      id: "items",
      enableSorting: false,
      accessorFn: (row) => row.items.map((item) => `${item.itemCode ?? ""} ${item.itemName} ${specsText(item.specs)}`).join(" "),
      cell: ({ row }) => (
        <div className="w-64 max-w-64 space-y-1.5">
          {row.original.items.map((item) => {
            const ordered = Number(item.quantity);
            const pct = ordered > 0 ? Math.min(100, (receivedQuantity(item) / ordered) * 100) : 0;
            return (
              <div key={item.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-gray-700" title={[item.itemName, specsText(item.specs)].filter(Boolean).join(" · ")}>{item.itemCode ? `${item.itemCode} · ` : ""}{item.itemName}</span>
                  <span className="shrink-0 whitespace-nowrap font-medium">{qty(receivedQuantity(item), "").trim()} / {qty(ordered, item.unit)}</span>
                </div>
                <div className={cn("purchases-progress", pct >= 100 && "is-complete")} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.itemName} received`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ),
    },
    {
      header: "Value",
      id: "value",
      accessorFn: orderValue,
      meta: { align: "right" },
      cell: ({ row }) => (
        <div className="text-right">
          <p className="font-semibold">{money(orderValue(row.original))}</p>
          {pendingValue(row.original) > 0 && <p className="text-xs text-gray-400">{money(pendingValue(row.original))} to come</p>}
        </div>
      ),
    },
    {
      header: "Expected",
      id: "expected",
      accessorFn: (row) => row.expectedDate ?? "",
      cell: ({ row }) => {
        const due = dueText(row.original);
        return (
          <span className={cn("whitespace-nowrap", isOverdue(row.original) && "font-medium text-red-600")}>
            {formatDate(row.original.expectedDate)}
            {due && <span className={cn("block text-[11px]", !isOverdue(row.original) && "text-gray-400")}>{due}</span>}
          </span>
        );
      },
    },
    {
      header: "Receipts",
      id: "receipts",
      accessorFn: (row) => row.receipts.map((r) => r.receiptNo).join(" "),
      cell: ({ row }) =>
        row.original.receipts[0] ? (
          <div>
            <button type="button" className="font-medium text-[#1b3c55] hover:underline" title="Open its received challan" onClick={() => actions.current.challan(row.original.receipts[0].id)}>
              {row.original.receipts[0].receiptNo}
            </button>
            <p className="text-xs text-gray-400">
              {formatDate(row.original.receipts[0].receivedAt)}
              {row.original.receipts.length > 1 ? ` · +${row.original.receipts.length - 1} more` : ""}
            </p>
          </div>
        ) : <span className="text-gray-400">—</span>,
    },
    {
      header: "Status",
      id: "status",
      accessorFn: (row) => STATUS_LABEL[row.status],
      cell: ({ row }) => {
        const po = row.original;
        const share = receivedShare(po);
        const last = lastReceiptAt(po);
        const stalled = isStalled(po);
        return (
          <div className="min-w-[8.5rem]">
            <Badge tone={statusTone(po.status)}>{STATUS_LABEL[po.status]}</Badge>
            {po.status !== "CANCELLED" && (
              <>
                <div className={cn("purchases-progress mt-1.5", share >= 99.95 && "is-complete")} aria-hidden><span style={{ width: `${share}%` }} /></div>
                <p className={cn("mt-0.5 text-[11px]", stalled ? "font-semibold text-amber-700" : "text-gray-400")}>
                  {Math.round(share)}% received{last && po.status === "PARTIALLY_RECEIVED" ? ` · last ${daysSince(last)}d ago` : ""}
                </p>
              </>
            )}
          </div>
        );
      },
    },
    {
      header: "",
      id: "actions",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => {
        const po = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" asChild><Link href={`/purchases/${po.id}`} aria-label={`Open ${po.poNo}`} title="Open details"><Eye size={14} /></Link></Button>
            {isOpen(po) && <Button size="sm" variant="outline" disabled={busy} onPointerEnter={prefetchReceive} onClick={() => actions.current.receive(po)}>Receive</Button>}
            {po.status === "ORDERED" && po.receipts.length === 0 && <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => actions.current.cancel(po)}>Cancel</Button>}
            {po.status === "PARTIALLY_RECEIVED" && <Button size="sm" variant="ghost" disabled={busy} title="The rest won't be delivered" onClick={() => actions.current.close(po)}>Close</Button>}
          </div>
        );
      },
    },
  ], [busy]);

  const challanColumns = useMemo<ColumnDef<ChallanRow>[]>(() => [
    {
      header: "Challan (GRN)",
      id: "grn",
      accessorFn: (row) => `${row.receipt.receiptNo} ${row.receipt.receivedAt}`,
      cell: ({ row }) => (
        <div>
          <button type="button" className="font-semibold text-[#1b3c55] hover:underline" onClick={() => actions.current.challan(row.original.receipt.id)}>
            {row.original.receipt.receiptNo}
          </button>
          <p className="text-xs text-gray-400">{formatDate(row.original.receipt.receivedAt)}</p>
        </div>
      ),
    },
    {
      header: "PO / distributor",
      id: "po",
      accessorFn: (row) => `${row.po.poNo} ${row.po.supplier.name} ${row.po.supplier.code}`,
      cell: ({ row }) => (
        <div className="max-w-44">
          <Link href={`/purchases/${row.original.po.id}`} className="font-medium hover:underline">{row.original.po.poNo}</Link>
          <p className="truncate text-xs text-gray-500" title={row.original.po.supplier.name}>{row.original.po.supplier.name}</p>
        </div>
      ),
    },
    {
      header: "Their challan / vehicle",
      id: "challan",
      accessorFn: (row) => `${row.receipt.challanNo ?? ""} ${row.receipt.vehicleNo ?? ""}`,
      cell: ({ row }) => (
        <div className="text-xs">
          <p className="font-semibold text-gray-700">{row.original.receipt.challanNo || "—"}</p>
          <p className="text-gray-500">{row.original.receipt.vehicleNo || "No vehicle"}</p>
        </div>
      ),
    },
    {
      header: "Items received",
      id: "items",
      enableSorting: false,
      accessorFn: (row) => row.itemsText,
      cell: ({ row }) => <p className="line-clamp-2 max-w-64 text-xs text-gray-700" title={row.original.itemsText}>{row.original.itemsText}</p>,
    },
    {
      header: "Warehouse",
      id: "warehouse",
      accessorFn: (row) => row.receipt.warehouse.code,
      cell: ({ row }) => <span className="whitespace-nowrap text-sm">{row.original.receipt.warehouse.code}</span>,
    },
    {
      header: "Value",
      id: "value",
      meta: { align: "right" },
      accessorFn: (row) => row.value,
      cell: ({ row }) => <span className="font-semibold">{money(row.original.value)}</span>,
    },
    {
      header: "Received by",
      id: "by",
      accessorFn: (row) => row.receipt.receivedBy ?? "",
      cell: ({ row }) => <span className="text-xs text-gray-600">{row.original.receipt.receivedBy || "—"}</span>,
    },
    {
      header: "",
      id: "actions",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => actions.current.challan(row.original.receipt.id)}>
          <Printer size={14} /> Print
        </Button>
      ),
    },
  ], []);

  if (!rows && loadError) return <ErrorState message={loadError} onRetry={retry} />;
  if (!rows) return <PurchasesSkeleton />;

  const liveRows = rows.filter((row) => row.status !== "CANCELLED");
  const totalValue = liveRows.reduce((sum, row) => sum + orderValue(row), 0);
  const toCome = openPurchaseOrders.reduce((sum, row) => sum + pendingValue(row), 0);
  const overdue = openPurchaseOrders.filter(isOverdue);
  const byStatus = (status: PurchaseStatus) => rows.filter((r) => r.status === status);
  const statusCounts: Record<StatusFilter, number> = {
    ALL: rows.length,
    OPEN: openPurchaseOrders.length,
    OVERDUE: overdue.length,
    ORDERED: byStatus("ORDERED").length,
    PARTIALLY_RECEIVED: byStatus("PARTIALLY_RECEIVED").length,
    RECEIVED: byStatus("RECEIVED").length,
    CLOSED: byStatus("CLOSED").length,
    CANCELLED: byStatus("CANCELLED").length,
    DUE_SOON: 0,
    STALLED: 0,
  };
  const dueSoon = openPurchaseOrders.filter(isDueSoon);
  const stalled = openPurchaseOrders.filter(isStalled);
  statusCounts.DUE_SOON = dueSoon.length;
  statusCounts.STALLED = stalled.length;
  const visibleRows =
    statusFilter === "ALL" ? rows
      : statusFilter === "OPEN" ? openPurchaseOrders
        : statusFilter === "OVERDUE" ? overdue
          : statusFilter === "DUE_SOON" ? dueSoon
            : statusFilter === "STALLED" ? stalled
              : byStatus(statusFilter);

  // Material received this month (by the day on this calendar), at the POs' rates.
  const month = todayInput().slice(0, 7);
  const monthReceipts = challans.filter((c) => dayOf(c.receipt.receivedAt).slice(0, 7) === month);
  const receivedMonth = monthReceipts.reduce((sum, c) => sum + c.value, 0);

  /** Shows one slice of the orders register (from a figure or "needs attention"). */
  const showOrders = (filter: StatusFilter, find = "") => {
    setRegisterView("orders");
    setStatusFilter(filter);
    setSearch(find);
  };

  // What needs someone, most urgent first, each with what it is about (as on the Dashboard).
  const attention: Array<{ tone: "danger" | "warning" | "info"; kind: AttentionKind; text: string; filter: StatusFilter }> = [];
  if (overdue.length) attention.push({ tone: "danger", kind: "purchases", text: `${plural(overdue.length, "purchase order")} past the expected date · ${money(overdue.reduce((sum, po) => sum + pendingValue(po), 0))} still to come`, filter: "OVERDUE" });
  if (stalled.length) attention.push({ tone: "warning", kind: "warehouse", text: `${plural(stalled.length, "PO")} partly received with nothing more for over ${STALLED_DAYS} days: chase the rest or close short`, filter: "STALLED" });
  if (dueSoon.length) attention.push({ tone: "info", kind: "warehouse", text: `${plural(dueSoon.length, "delivery", "deliveries")} expected within ${DUE_SOON_DAYS} days`, filter: "DUE_SOON" });

  // Open orders by distributor: what is still to come from each, the largest first.
  const bySupplier = new Map<string, { id: string; code: string; name: string; open: number; late: number; toCome: number; next: string | null }>();
  for (const po of openPurchaseOrders) {
    const row = bySupplier.get(po.supplier.id) ?? { id: po.supplier.id, code: po.supplier.code, name: po.supplier.name, open: 0, late: 0, toCome: 0, next: null };
    row.open += 1;
    row.toCome += pendingValue(po);
    if (isOverdue(po)) row.late += 1;
    if (po.expectedDate && (!row.next || po.expectedDate < row.next)) row.next = po.expectedDate;
    bySupplier.set(po.supplier.id, row);
  }
  const suppliersOpen = [...bySupplier.values()].sort((a, b) => b.toCome - a.toCome || b.open - a.open).slice(0, 6);
  const supplierMax = suppliersOpen[0]?.toCome ?? 0;
  // Arriving soon: late ones first, then the next 7 days.
  const arriving = openPurchaseOrders
    .filter((po) => {
      const days = daysToExpected(po);
      return days !== null && days <= 7;
    })
    .sort((a, b) => (a.expectedDate ?? "").localeCompare(b.expectedDate ?? ""))
    .slice(0, 6);
  const filters: Array<{ value: StatusFilter; label: string }> = [
    { value: "ALL", label: "All" },
    { value: "OPEN", label: "Open" },
    { value: "OVERDUE", label: "Overdue" },
    { value: "ORDERED", label: "Not received" },
    { value: "PARTIALLY_RECEIVED", label: "Partly received" },
    { value: "RECEIVED", label: "Received" },
    { value: "CLOSED", label: "Closed short" },
    { value: "CANCELLED", label: "Cancelled" },
  ];
  const attentionFilterLabel = statusFilter === "DUE_SOON" ? `Expected within ${DUE_SOON_DAYS} days` : statusFilter === "STALLED" ? `Partly received, nothing for over ${STALLED_DAYS} days` : "";

  const filledLines = lines.filter((line) => !isBlank(line));
  const draftTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.rate || 0), 0);
  const draftErrors = new Map(lines.map((line) => [line.key, showLineErrors && !isBlank(line) ? lineErrors(line, nameOf(line)) : {}]));

  const statTile = (filter: StatusFilter) => ({
    type: "button" as const,
    "aria-pressed": statusFilter === filter,
    onClick: () => setStatusFilter(statusFilter === filter ? "ALL" : filter),
  });

  return (
    <div className="purchases-page">
      <div className="purchases-page-header">
        <span className="purchases-page-icon">
          <Truck size={18} />
        </span>
        <div>
          <h2 className="text-lg font-bold md:text-xl">Purchases & Material Receiving</h2>
          <p className="text-xs text-gray-500">Create distributor POs, record full or partial GRNs, and post received material into stock.</p>
        </div>
        <span className="purchases-header-badge flex flex-wrap items-center gap-2">
          <Button className="purchases-action-btn" onClick={openCreate}>
            <Plus size={16} /> {hasDraft ? "Continue draft PO" : "New purchase order"}
          </Button>
          <Button
            variant="outline"
            className="purchases-action-btn purchases-action-btn--outline"
            disabled={openPurchaseOrders.length === 0}
            title={openPurchaseOrders.length ? undefined : "No open purchase orders to receive"}
            onClick={() => openReceive()}
            onPointerEnter={prefetchReceive}
          >
            <ClipboardCheck size={16} /> Receive material
            {openPurchaseOrders.length > 0 && <span className="purchases-count-pill">{openPurchaseOrders.length}</span>}
          </Button>
        </span>
      </div>

      {message && (
        <div className={`purchases-message ${message.error ? "purchases-message--error" : "purchases-message--success"}`} role={message.error ? "alert" : "status"}>
          {message.error ? <AlertTriangle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0" />}
          <span className="flex-1">{message.text}</span>
          <button type="button" className="purchases-message__close" aria-label="Dismiss" onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}

      <div className="purchases-stats grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        <button {...statTile("OPEN")} className={cn("purchases-stat-tile purchases-stat-tile--total text-left", statusFilter === "OPEN" && "is-active")}>
          <div className="purchases-stat-icon"><ShoppingCart size={15} /></div>
          <div>
            <p className="purchases-stat-label">Open POs</p>
            <p className="purchases-stat-value">{openPurchaseOrders.length}</p>
            <p className="purchases-stat-caption">{statusCounts.PARTIALLY_RECEIVED} partly received · {rows.length} in total</p>
          </div>
        </button>
        <button {...statTile("OVERDUE")} className={cn("purchases-stat-tile purchases-stat-tile--partial text-left", overdue.length > 0 && "is-alert", statusFilter === "OVERDUE" && "is-active")}>
          <div className="purchases-stat-icon"><CalendarClock size={15} /></div>
          <div className="min-w-0">
            <p className="purchases-stat-label">Overdue deliveries</p>
            <p className="purchases-stat-value">{overdue.length}</p>
            <p className="purchases-stat-caption truncate">{overdue.length ? overdue.slice(0, 2).map((po) => po.poNo).join(", ") + (overdue.length > 2 ? "…" : "") : "Nothing late"}</p>
          </div>
        </button>
        <button {...statTile("OPEN")} className={cn("purchases-stat-tile purchases-stat-tile--received text-left", statusFilter === "OPEN" && "is-active")}>
          <div className="purchases-stat-icon"><PackageCheck size={15} /></div>
          <div>
            <p className="purchases-stat-label">Still to arrive</p>
            <p className="purchases-stat-value">{money(toCome)}</p>
            <p className="purchases-stat-caption">Value not yet received on open POs</p>
          </div>
        </button>
        <button type="button" onClick={() => setRegisterView("challans")} className={cn("purchases-stat-tile purchases-stat-tile--received text-left", registerView === "challans" && "is-active")}>
          <div className="purchases-stat-icon"><ClipboardCheck size={15} /></div>
          <div>
            <p className="purchases-stat-label">Received this month</p>
            <p className="purchases-stat-value">{money(receivedMonth)}</p>
            <p className="purchases-stat-caption">{plural(monthReceipts.length, "goods receipt")} at PO rates</p>
          </div>
        </button>
        <div className="purchases-stat-tile purchases-stat-tile--value">
          <div className="purchases-stat-icon"><IndianRupee size={15} /></div>
          <div>
            <p className="purchases-stat-label">Ordered value</p>
            <p className="purchases-stat-value">{money(totalValue)}</p>
            <p className="purchases-stat-caption">{liveRows.length} PO{liveRows.length === 1 ? "" : "s"} · excludes cancelled</p>
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <section className="dashboard-attention" aria-label="Needs attention">
          <ul>
            {attention.map((item) => {
              const { icon: KindIcon, label } = ATTENTION_KINDS[item.kind];
              const ToneIcon = item.tone === "danger" ? AlertTriangle : item.tone === "warning" ? CircleDot : Info;
              return (
                <li key={item.filter}>
                  <button type="button" aria-pressed={registerView === "orders" && statusFilter === item.filter} onClick={() => showOrders(item.filter)} className={cn("dashboard-attention__item sales-attention w-full text-left", `is-${item.tone}`)}>
                    <span className={cn("attn-icon", `is-${item.kind}`, item.tone === "danger" && "is-urgent")}><KindIcon size={15} /></span>
                    <span className="dashboard-attention__text flex-1">
                      <span className={cn("attn-kind-chip", `is-${item.kind}`)}>{label}</span>
                      {item.text}
                    </span>
                    <ToneIcon size={14} className="shrink-0" aria-hidden />
                    <ArrowRight size={14} className="shrink-0 opacity-60" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(suppliersOpen.length > 0 || arriving.length > 0) && (
        <div className="grid gap-2.5 lg:grid-cols-2">
          <Card className="purchases-card">
            <CardHeader>
              <div className="purchases-card-heading">
                <span className="purchases-step-badge purchases-step-badge--1"><Users size={14} /></span>
                <div><h3 className="font-bold">Open orders by distributor</h3><p className="text-xs text-gray-500">Still to come from each; open one to see its POs.</p></div>
              </div>
            </CardHeader>
            <CardContent>
              {suppliersOpen.length === 0 ? (
                <p className="text-sm text-gray-500">No open purchase orders.</p>
              ) : (
                <ul className="space-y-2">
                  {suppliersOpen.map((row) => (
                    <li key={row.id}>
                      <button type="button" className="sales-owe w-full text-left transition hover:border-[#c9d8d1] hover:bg-[#fafcfb]" onClick={() => showOrders("OPEN", row.name)}>
                        <span className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0">
                            <b className="block truncate text-gray-800">{row.name}</b>
                            <span className="text-[11px] text-gray-400">
                              {row.code} · {plural(row.open, "open PO")}
                              {row.late > 0 ? <b className="text-rose-600"> · {row.late} late</b> : row.next ? ` · next ${formatDate(row.next)}` : ""}
                            </span>
                          </span>
                          <b className={cn("shrink-0 tabular-nums", row.late ? "text-rose-700" : "text-gray-800")}>{money(row.toCome)}</b>
                        </span>
                        <span className={cn("sales-owe__bar", row.late > 0 && "is-late")}><span style={{ width: `${supplierMax ? (row.toCome / supplierMax) * 100 : 0}%` }} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="purchases-card">
            <CardHeader>
              <div className="purchases-card-heading">
                <span className="purchases-step-badge purchases-step-badge--2"><CalendarClock size={14} /></span>
                <div><h3 className="font-bold">Arriving next 7 days</h3><p className="text-xs text-gray-500">Late deliveries first, then by expected date.</p></div>
              </div>
            </CardHeader>
            <CardContent>
              {arriving.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing expected in the next 7 days.</p>
              ) : (
                <ul className="space-y-2">
                  {arriving.map((po) => {
                    const late = isOverdue(po);
                    return (
                      <li key={po.id} className={cn("purchases-arriving", late && "is-late")}>
                        <span className="min-w-0 flex-1">
                          <Link href={`/purchases/${po.id}`} className="font-semibold text-[#1b3c55] hover:underline" onPointerEnter={() => prefetchApi(poPath(po.id))}>{po.poNo}</Link>
                          <span className="block truncate text-[11px] text-gray-500">{po.supplier.name}{po.warehouse ? ` · to ${po.warehouse.code}` : ""}</span>
                        </span>
                        <span className="shrink-0 text-right text-[11px]">
                          <b className={cn("block", late ? "text-rose-600" : "text-gray-700")}>{dueText(po)}</b>
                          <span className="text-gray-400">{money(pendingValue(po))} to come</span>
                        </span>
                        <Button size="sm" variant="outline" disabled={busy} onPointerEnter={prefetchReceive} onClick={() => openReceive(po.id)}>Receive</Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog.Root open={creating} onOpenChange={(open) => !busy && setCreating(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="users-dialog__overlay" />
          <Dialog.Content className="users-dialog purchases-dialog purchases-dialog--wide" aria-describedby="create-po-help">
            <div className="users-dialog__head">
              <div className="purchases-card-heading">
                <span className="purchases-step-badge purchases-step-badge--1"><ShoppingCart size={14} /></span>
                <div>
                  <Dialog.Title className="font-bold">Create Purchase Order</Dialog.Title>
                  <Dialog.Description id="create-po-help" className="text-xs text-gray-500">
                    No item codes to type: each item gets its own code (01SS26…) when it is received. Pick an item ordered before to fill its material, unit and last rate.
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
            </div>
            <form
              noValidate
              className="users-dialog__body"
              onSubmit={(event) => {
                event.preventDefault();
                void createPurchaseOrder();
              }}
            >
              {createError && <div className="purchases-message purchases-message--error" role="alert"><AlertTriangle size={15} className="shrink-0" />{createError}</div>}
              {suppliers.length === 0 && (
                <div className="purchases-message purchases-message--error" role="alert">
                  <AlertTriangle size={15} className="shrink-0" /> Add an active distributor in Masters before creating a purchase order.
                </div>
              )}
              <div className="grid gap-2.5 md:grid-cols-3">
                <label>
                  <span className="erp-label">Distributor *</span>
                  <select className="erp-input" value={purchase.supplierId} onChange={(event) => setPurchase({ ...purchase, supplierId: event.target.value })}>
                    <option value="">Select active distributor</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.materialCategory ? ` (${s.materialCategory})` : ""}</option>)}
                  </select>
                  {supplier && <span className="mt-1 block text-[11px] text-gray-500">New lines default to <strong>{humanize(supplierMaterial)}</strong>.</span>}
                </label>
                <label>
                  <span className="erp-label">Deliver to warehouse *</span>
                  <select className="erp-input" value={purchase.warehouseId} onChange={(event) => setPurchase({ ...purchase, warehouseId: event.target.value })}>
                    <option value="">Select warehouse</option>
                    {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
                  </select>
                  <span className="mt-1 block text-[11px] text-gray-500">Its Warehouses page shows this PO as waiting to be received.</span>
                </label>
                <label>
                  <span className="erp-label">Expected delivery</span>
                  <Input type="date" min={todayInput()} value={purchase.expectedDate} onChange={(event) => setPurchase({ ...purchase, expectedDate: event.target.value })} />
                </label>
              </div>

              <datalist id="purchase-item-names">{knownItems.map((item) => <option key={item.itemName} value={item.itemName} />)}</datalist>
              <div className="purchases-line-table overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr>
                      <th className="w-8 px-3 py-2.5">#</th>
                      <th className="px-3 py-2.5">Item name *</th>
                      <th className="px-3 py-2.5" title="The stock it becomes when received">Material *</th>
                      <th className="px-3 py-2.5">Quantity *</th>
                      <th className="px-3 py-2.5">Unit</th>
                      <th className="px-3 py-2.5">Rate (₹) *</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => {
                      const e = draftErrors.get(line.key) ?? {};
                      const group = groupOf(line);
                      const byBags = group === "yarn" ? bagsKg(line.specs) : null;
                      return [
                        <tr key={line.key} className="purchases-line-row">
                          <td className="px-3 text-xs text-gray-400">{index + 1}</td>
                          <td className="p-1.5 align-top">
                            <Input value={line.itemName} list="purchase-item-names" autoComplete="off" maxLength={120} onChange={(event) => updateLine(line.key, "itemName", event.target.value)} placeholder={suggestedName(groupOf(line), line.specs) || "36'S VL yarn"} aria-label={`Item name, line ${index + 1}`} aria-invalid={Boolean(e.itemName)} />
                            {e.itemName && <p className="purchases-line-error">{e.itemName}</p>}
                          </td>
                          <td className="p-1.5 align-top">
                            <select className="erp-input" value={line.category || supplierMaterial} onChange={(event) => updateLine(line.key, "category", event.target.value)} aria-label={`Material, line ${index + 1}`}>
                              {STOCK_CATEGORIES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
                            </select>
                          </td>
                          <td className="p-1.5 align-top">
                            {line.unit === "KG" ? (
                              <WeightInput compact value={line.quantity} onValueChange={(quantity) => updateLine(line.key, "quantity", quantity)} placeholder="0.000" aria-label={`Quantity, line ${index + 1}`} aria-invalid={Boolean(e.quantity)} />
                            ) : (
                              <Input min={line.unit === "G" ? "1" : "0.001"} step={line.unit === "G" ? "1" : "0.001"} type="number" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, "quantity", event.target.value)} placeholder={line.unit === "G" ? "grams" : "0.000"} aria-label={`Quantity, line ${index + 1}`} aria-invalid={Boolean(e.quantity)} />
                            )}
                            {e.quantity && <p className="purchases-line-error">{e.quantity}</p>}
                          </td>
                          <td className="p-1.5 align-top">
                            <select className="erp-input" value={line.unit} onChange={(event) => updateLine(line.key, "unit", event.target.value)} aria-label={`Unit, line ${index + 1}`}>
                              {(UNITS.includes(line.unit) ? UNITS : [line.unit, ...UNITS]).map((unit) => <option key={unit}>{unit}</option>)}
                            </select>
                          </td>
                          <td className="p-1.5 align-top">
                            <Input min="0" step="0.01" type="number" inputMode="decimal" value={line.rate} onChange={(event) => updateLine(line.key, "rate", event.target.value)} placeholder="0.00" aria-label={`Rate, line ${index + 1}`} aria-invalid={Boolean(e.rate)} />
                            {e.rate && <p className="purchases-line-error">{e.rate}</p>}
                          </td>
                          <td className="whitespace-nowrap p-2 text-right font-semibold">{money(Number(line.quantity || 0) * Number(line.rate || 0))}</td>
                          <td className="pr-1.5">
                            <button type="button" aria-label={`Remove line ${index + 1}`} title={lines.length === 1 ? "Clear line" : "Remove line"} className="purchases-row-action purchases-row-action--delete" disabled={lines.length === 1 && isBlank(line)} onClick={() => removeLine(line.key)}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>,
                        <tr key={`${line.key}-details`} className="purchases-specs-row">
                          <td />
                          <td colSpan={7} className="px-1.5 pb-3 pt-0">
                            <div className="purchases-specs">
                              <p className="purchases-specs__title">
                                {SPEC_GROUP_LABEL[group]}
                                {byBags && <span className="ml-2 font-normal normal-case tracking-normal text-gray-600">= {byBags.count} bags × {line.specs["KG per bag"]} KG = <b>{byBags.kg.toLocaleString("en-IN")} KG</b>{line.autoQuantity ? " (quantity)" : ""}</span>}
                              </p>
                              <div className="purchases-specs__grid">
                                {SPEC_FIELDS[group].map((field) => (
                                  <label key={field.label}>
                                    <span>{field.label}</span>
                                    <Input
                                      className="h-8 text-xs"
                                      maxLength={120}
                                      placeholder={field.placeholder}
                                      value={line.specs[field.label] ?? ""}
                                      onChange={(event) => updateSpec(line.key, field.label, field.label === "Bags" ? event.target.value.replace(/[^\d+\s]/g, "") : event.target.value)}
                                      aria-label={`${field.label}, line ${index + 1}`}
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" className="purchases-action-btn purchases-action-btn--outline" onClick={() => setLines((current) => [...current, blankLine()])}><Plus size={16} />Add item</Button>
                {hasDraft && <Button variant="ghost" className="text-gray-500" disabled={busy} onClick={clearDraft}>Clear form</Button>}
              </div>
              <div className="users-dialog__foot items-center">
                <p className="mr-auto text-sm">
                  {filledLines.length} item{filledLines.length === 1 ? "" : "s"} · Order total <strong>{money(draftTotal)}</strong>
                </p>
                <Button variant="outline" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" className="purchases-action-btn" disabled={busy || suppliers.length === 0}><ShoppingCart size={16} />{busy ? "Saving..." : "Create Purchase Order"}</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {receiving && (
        <ReceiveDialog
          purchaseOrders={openPurchaseOrders}
          initialPurchaseOrderId={receiving.purchaseOrderId}
          warehouses={warehouses}
          warehouseSummary={warehouseSummary}
          onClose={() => setReceiving(null)}
          onReceived={(result, po) => void received(result, po)}
        />
      )}

      {challanId && <ReceivedChallanDialog receiptId={challanId} onClose={() => setChallanId(null)} />}

      <Card className="purchases-card purchases-card--register purchases-register-card">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="purchases-card-heading">
            <span className="purchases-step-badge purchases-step-badge--3"><PackageCheck size={14} /></span>
            <div>
              <h3 className="font-bold">{registerView === "orders" ? "Purchase Register" : registerView === "yarn" ? "Yarn Purchases" : "Received Challans"}</h3>
              <p className="text-xs text-gray-500">
                {registerView === "orders"
                  ? "Every PO with its receipts. Open one to see all its goods receipts."
                  : registerView === "yarn"
                  ? "Every yarn line ordered: its details, ordered against received, each receipt with the distributor's DC and checks, and where the yarn is now. Open a line for all of it."
                  : "Every material receipt, newest first, with the distributor's challan and vehicle. Print any challan for the office file."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="challan-copy-picker !mr-0" role="group" aria-label="Register">
              <button type="button" aria-pressed={registerView === "orders"} onClick={() => setRegisterView("orders")}>Purchase orders {rows.length}</button>
              <button type="button" aria-pressed={registerView === "yarn"} onClick={() => setRegisterView("yarn")}>Yarn {yarnLineCount}</button>
              <button type="button" aria-pressed={registerView === "challans"} onClick={() => setRegisterView("challans")}>Received challans {challans.length}</button>
            </div>
            {registerView === "yarn" ? null : registerView === "orders" ? (
              <Button size="sm" variant="outline" disabled={visibleRows.length === 0} onClick={() => exportPurchaseOrders(visibleRows)} title="Download the POs shown under this filter">
                <Download size={14} /> Export CSV
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={challans.length === 0} onClick={() => exportChallans(challans)} title="Download every received challan">
                <Download size={14} /> Export CSV
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {registerView === "yarn" ? (
            <YarnPurchases showPrices={(rows ?? []).every((po) => po.items.every((item) => item.rate !== null))} onChallan={setChallanId} />
          ) : registerView === "challans" ? (
            <DataTable
              data={challans}
              columns={challanColumns}
              minWidth={1080}
              searchPlaceholder="Search GRN, PO, distributor, their challan, vehicle, item..."
              getRowId={(row) => row.receipt.id}
              emptyTitle="No material received yet"
              emptyDescription="A received challan is made every time material is received against a PO."
            />
          ) : (
          <>
          <div className="purchases-filters mb-3" role="tablist" aria-label="Filter by status">
            {filters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={statusFilter === f.value}
                className={cn(statusFilter === f.value && "is-active", f.value === "OVERDUE" && statusCounts.OVERDUE > 0 && "is-alert")}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label} <span>{statusCounts[f.value]}</span>
              </button>
            ))}
          </div>
          {attentionFilterLabel && (
            <p className="mb-2 flex items-center gap-2 text-xs text-gray-600">
              Showing: <b>{attentionFilterLabel}</b>
              <button type="button" className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold hover:bg-gray-50" onClick={() => setStatusFilter("ALL")}><X size={11} /> Show all</button>
            </p>
          )}
          <DataTable
            data={visibleRows}
            columns={columns}
            minWidth={1080}
            filter={search}
            onFilterChange={setSearch}
            searchPlaceholder="Search PO, distributor, item, GRN, status..."
            getRowId={(row) => row.id}
            emptyTitle={statusFilter === "ALL" ? "No purchase orders yet" : "No purchase orders with this status"}
            emptyDescription={statusFilter === "ALL" ? "Click New purchase order to create the first one." : "Try another status filter."}
          />
          {rows.length >= LIST_LIMIT && <p className="mt-2 text-[11px] text-gray-400">The register lists the latest {LIST_LIMIT} purchase orders; older ones are in Reports.</p>}
          </>
          )}
        </CardContent>
      </Card>

      {closing && <ClosePurchaseOrderDialog po={closing} busy={busy} onClose={() => setClosing(null)} onConfirm={(reason) => void closePurchaseOrder(closing, reason)} />}
    </div>
  );
}
