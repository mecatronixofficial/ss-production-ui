"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  IndianRupee,
  PackageCheck,
  Plus,
  Printer,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { downloadCsv } from "@/lib/csv";
import {
  categoryFor,
  dueText,
  isOpen,
  isOverdue,
  orderValue,
  pendingValue,
  qty,
  receiptValue,
  receivedQuantity,
  STATUS_LABEL,
  statusTone,
  STOCK_CATEGORIES,
  type PurchaseOrder,
  type PurchaseReceipt,
  type PurchaseStatus,
  type PurchaseSupplier,
  type PurchaseWarehouse,
} from "@/lib/purchases";
import { toast } from "@/lib/toast-store";
import type { StockCategory } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { cn, formatDate, humanize, money, todayInput } from "@/lib/utils";
import { type WarehouseSummary } from "@/lib/warehouses";
import { DataTable } from "@/components/data-table";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { ClosePurchaseOrderDialog } from "@/components/close-purchase-order-dialog";
import { ReceiveDialog, receiptSummary, type ReceiveResult } from "@/components/receive-dialog";
import { ReceivedChallanDialog } from "@/components/received-challan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";

/**
 * A line being ordered. No item code: each line gets its own (SS-2026-001…) when first received.
 * `category` "" follows the distributor's usual material until the line picks its own.
 */
type PurchaseLineDraft = { key: number; itemName: string; category: StockCategory | ""; quantity: string; unit: string; rate: string };
type LineErrors = Partial<Record<"itemName" | "quantity" | "rate", string>>;
type StatusFilter = "ALL" | "OPEN" | "OVERDUE" | PurchaseStatus;
type RegisterView = "orders" | "challans";
/** One goods receipt with its PO, as a row of the received-challan register. */
type ChallanRow = { receipt: PurchaseReceipt; po: PurchaseOrder; value: number; itemsText: string };

/** G = grams (dyes, chemicals): received grams go into stock as KG. */
const UNITS = ["KG", "G", "CONE", "BAG", "LTR", "PCS", "ROLL"];

let lineSeq = 0;
const blankLine = (): PurchaseLineDraft => ({ key: ++lineSeq, itemName: "", category: "", quantity: "", unit: "KG", rate: "" });
const isBlank = (line: PurchaseLineDraft) => !line.itemName.trim() && !line.quantity && !line.rate;
const decimals = (value: string) => (value.split(".")[1] ?? "").length;

/** Mirrors the backend DTO (quantity ≥ 0.001 with 3 decimals, rate ≥ 0 with 2) so the problem shows on the line. */
function lineErrors(line: PurchaseLineDraft): LineErrors {
  const e: LineErrors = {};
  if (!line.itemName.trim()) e.itemName = "Enter the item name.";
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
      po.items.map((item) => `${item.itemName} ${receivedQuantity(item)}/${Number(item.quantity)} ${item.unit}`).join("; "),
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
      receipt.receivedAt.slice(0, 10),
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

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseOrder[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [suppliers, setSuppliers] = useState<PurchaseSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<PurchaseWarehouse[]>([]);
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
  /** The goods-receipt window, with the PO chosen from the register ("" to pick one inside). */
  const [receiving, setReceiving] = useState<{ purchaseOrderId: string } | null>(null);
  /** The goods receipt whose received challan is open (just posted, or from the register). */
  const [challanId, setChallanId] = useState<string | null>(null);
  const [registerView, setRegisterView] = useState<RegisterView>("orders");
  // Stock held per warehouse, shown in the receipt window. Warehouses are managed on the Warehouses page.
  const { data: warehouseSummary, reload: reloadWarehouseSummary } = useApiQuery<WarehouseSummary[]>("/masters/warehouses/summary");

  const load = async () => {
    const [purchaseOrders, context] = await Promise.all([
      api<PurchaseOrder[]>("/procurement/purchase-orders"),
      api<{ suppliers: PurchaseSupplier[]; warehouses: PurchaseWarehouse[] }>("/procurement/context"),
    ]);
    setRows(purchaseOrders);
    setLoadError("");
    setSuppliers(context.suppliers);
    setWarehouses(context.warehouses);
    // Deliver to the yarn warehouse by default; keep a choice unless it was deactivated or deleted meanwhile.
    setPurchase((current) => ({
      ...current,
      supplierId: context.suppliers.some((supplier) => supplier.id === current.supplierId) ? current.supplierId : "",
      warehouseId: context.warehouses.some((warehouse) => warehouse.id === current.warehouseId)
        ? current.warehouseId
        : context.warehouses.find((warehouse) => warehouse.code.includes("YARN"))?.id || context.warehouses[0]?.id || "",
    }));
  };
  const retry = () => load().catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load purchases"));

  useEffect(() => {
    void retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on open
  }, []);

  const openPurchaseOrders = useMemo(() => (rows ?? []).filter(isOpen), [rows]);

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
    const byName = new Map<string, { itemName: string; category?: StockCategory | null; unit: string; rate: string | null }>();
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

  const updateLine = (key: number, field: keyof Omit<PurchaseLineDraft, "key">, value: string) => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, [field]: value };
        // Picking an item ordered before fills in the rest of the line (without overwriting what was typed).
        const known = field === "itemName" ? knownItems.find((item) => item.itemName.toLowerCase() === value.trim().toLowerCase()) : undefined;
        if (known) {
          if (line.unit === "KG" && !line.quantity) next.unit = known.unit;
          if (!next.rate && known.rate !== null) next.rate = String(Number(known.rate));
          if (!next.category && known.category) next.category = known.category;
        }
        return next;
      }),
    );
  };
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
    if (filled.some((line) => Object.keys(lineErrors(line)).length > 0)) {
      setShowLineErrors(true);
      return setCreateError("Fix the highlighted item lines.");
    }
    const items = filled.map((line) => ({
      itemName: line.itemName.trim(),
      category: line.category || supplierMaterial,
      quantity: Math.round(Number(line.quantity) * 1000) / 1000,
      unit: line.unit,
      rate: Math.round(Number(line.rate) * 100) / 100,
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
          <Link href={`/purchases/${row.original.id}`} className="font-semibold text-[#1b3c55] hover:underline">{row.original.poNo}</Link>
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
      accessorFn: (row) => row.items.map((item) => `${item.itemCode ?? ""} ${item.itemName}`).join(" "),
      cell: ({ row }) => (
        <div className="w-64 max-w-64 space-y-1.5">
          {row.original.items.map((item) => {
            const ordered = Number(item.quantity);
            const pct = ordered > 0 ? Math.min(100, (receivedQuantity(item) / ordered) * 100) : 0;
            return (
              <div key={item.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-gray-700" title={item.itemName}>{item.itemCode ? `${item.itemCode} · ` : ""}{item.itemName}</span>
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
      cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{STATUS_LABEL[row.original.status]}</Badge>,
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
            {isOpen(po) && <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.current.receive(po)}>Receive</Button>}
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

  if (!rows && loadError) return <ErrorState message={loadError} onRetry={() => void retry()} />;
  if (!rows) return <Loading />;

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
  };
  const visibleRows =
    statusFilter === "ALL" ? rows : statusFilter === "OPEN" ? openPurchaseOrders : statusFilter === "OVERDUE" ? overdue : byStatus(statusFilter);
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

  const filledLines = lines.filter((line) => !isBlank(line));
  const draftTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.rate || 0), 0);
  const draftErrors = new Map(lines.map((line) => [line.key, showLineErrors && !isBlank(line) ? lineErrors(line) : {}]));

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

      <div className="purchases-stats grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
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
        <div className="purchases-stat-tile purchases-stat-tile--received">
          <div className="purchases-stat-icon"><PackageCheck size={15} /></div>
          <div>
            <p className="purchases-stat-label">Still to arrive</p>
            <p className="purchases-stat-value">{money(toCome)}</p>
            <p className="purchases-stat-caption">Value not yet received on open POs</p>
          </div>
        </div>
        <div className="purchases-stat-tile purchases-stat-tile--value">
          <div className="purchases-stat-icon"><IndianRupee size={15} /></div>
          <div>
            <p className="purchases-stat-label">Ordered value</p>
            <p className="purchases-stat-value">{money(totalValue)}</p>
            <p className="purchases-stat-caption">{liveRows.length} PO{liveRows.length === 1 ? "" : "s"} · excludes cancelled</p>
          </div>
        </div>
      </div>

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
                    No item codes to type: each item gets its own code (SS-2026-001…) when it is received. Pick an item ordered before to fill its material, unit and last rate.
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
                      return (
                        <tr key={line.key}>
                          <td className="px-3 text-xs text-gray-400">{index + 1}</td>
                          <td className="p-1.5 align-top">
                            <Input value={line.itemName} list="purchase-item-names" autoComplete="off" maxLength={120} onChange={(event) => updateLine(line.key, "itemName", event.target.value)} placeholder="30s Combed Yarn" aria-label={`Item name, line ${index + 1}`} aria-invalid={Boolean(e.itemName)} />
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
                        </tr>
                      );
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
              <h3 className="font-bold">{registerView === "orders" ? "Purchase Register" : "Received Challans"}</h3>
              <p className="text-xs text-gray-500">
                {registerView === "orders"
                  ? "Every PO with its receipts. Open one to see all its goods receipts."
                  : "Every material receipt, newest first, with the distributor's challan and vehicle. Print any challan for the office file."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="challan-copy-picker !mr-0" role="group" aria-label="Register">
              <button type="button" aria-pressed={registerView === "orders"} onClick={() => setRegisterView("orders")}>Purchase orders {rows.length}</button>
              <button type="button" aria-pressed={registerView === "challans"} onClick={() => setRegisterView("challans")}>Received challans {challans.length}</button>
            </div>
            {registerView === "orders" ? (
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
          {registerView === "challans" ? (
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
          <DataTable
            data={visibleRows}
            columns={columns}
            minWidth={1080}
            searchPlaceholder="Search PO, distributor, item, GRN, status..."
            getRowId={(row) => row.id}
            emptyTitle={statusFilter === "ALL" ? "No purchase orders yet" : "No purchase orders with this status"}
            emptyDescription={statusFilter === "ALL" ? "Click New purchase order to create the first one." : "Try another status filter."}
          />
          </>
          )}
        </CardContent>
      </Card>

      {closing && <ClosePurchaseOrderDialog po={closing} busy={busy} onClose={() => setClosing(null)} onConfirm={(reason) => void closePurchaseOrder(closing, reason)} />}
    </div>
  );
}
