import type { StockCategory } from "@/lib/types";
import { todayInput, unitQty } from "@/lib/utils";

/** Purchase orders as `/procurement/purchase-orders` and `/procurement/incoming` return them. */
export type PurchaseStatus = "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED" | "CLOSED";
export type PurchaseSupplier = { id: string; code: string; name: string; materialCategory?: string | null };
export type PurchaseWarehouse = { id: string; code: string; name: string };
export type PurchaseItem = {
  id: string;
  /** Given on the line's first receipt (SS-2026-001…); null until then. */
  itemCode: string | null;
  itemName: string;
  /** The stock the line becomes when received; null on lines ordered before it was asked. */
  category?: StockCategory | null;
  quantity: string;
  unit: string;
  /** Null for warehouse staff and managers: they see what to receive, not prices. */
  rate: string | null;
  receiptItems: Array<{ quantity: string }>;
};
export type PurchaseReceipt = {
  id: string;
  receiptNo: string;
  receivedAt: string;
  category: StockCategory;
  lotNo?: string | null;
  /** The distributor's delivery challan / invoice number that came with the material. */
  challanNo?: string | null;
  vehicleNo?: string | null;
  notes?: string | null;
  /** Name of who posted it. */
  receivedBy?: string | null;
  warehouse: PurchaseWarehouse;
  items: Array<{ purchaseOrderItemId: string; quantity: string }>;
};

/** One goods receipt as its printable received challan (`/procurement/receipts/:id`). */
export type ReceivedChallan = {
  id: string;
  receiptNo: string;
  receivedAt: string;
  category: StockCategory;
  lotNo: string | null;
  challanNo: string | null;
  vehicleNo: string | null;
  notes: string | null;
  receivedBy: string | null;
  warehouse: { id: string; code: string; name: string; location: string | null };
  purchaseOrder: { id: string; poNo: string; orderDate: string; expectedDate: string | null; status: PurchaseStatus; warehouse: PurchaseWarehouse | null };
  supplier: { id: string; code: string; name: string; company: string | null; contactPerson: string | null; mobile: string | null; gst: string | null; address: string | null };
  lines: Array<{
    id: string;
    itemName: string;
    itemCode: string | null;
    category: StockCategory;
    unit: string;
    ordered: number;
    receivedBefore: number;
    quantity: number;
    /** Still to come on the line after this receipt. */
    balance: number;
    rate: number | null;
    amount: number | null;
    /** The item's full details: this receipt's lot, distributor, PO, and for fabric its construction. */
    specs: Array<{ label: string; value: string }>;
  }>;
  /** Null when prices are hidden from the viewer. */
  total: number | null;
  pricesShown: boolean;
  company: Record<string, string | undefined>;
};
export type PurchaseOrder = {
  id: string;
  poNo: string;
  status: PurchaseStatus;
  orderDate: string;
  expectedDate?: string | null;
  supplier: PurchaseSupplier;
  /** Where the material is delivered; null on POs made before destinations existed. */
  warehouseId?: string | null;
  warehouse?: PurchaseWarehouse | null;
  items: PurchaseItem[];
  receipts: PurchaseReceipt[];
};

/** Purchase orders that can still receive material. */
export const OPEN_STATUSES: PurchaseStatus[] = ["ORDERED", "PARTIALLY_RECEIVED"];
export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
  CLOSED: "Closed short",
};
export const STOCK_CATEGORIES: StockCategory[] = ["YARN", "RAW_MATERIAL", "GREY_FABRIC", "DYED_FABRIC", "FINISHED_FABRIC", "CHEMICAL", "PACKING"];
/** Stock pages count these in KG. */
export const KG_CATEGORIES: StockCategory[] = ["YARN", "GREY_FABRIC", "DYED_FABRIC", "FINISHED_FABRIC"];

export const receivedQuantity = (item: PurchaseItem) => item.receiptItems.reduce((sum, receipt) => sum + Number(receipt.quantity), 0);
export const remainingQuantity = (item: PurchaseItem) => Math.max(0, Number(item.quantity) - receivedQuantity(item));
export const orderValue = (po: PurchaseOrder) => po.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate ?? 0), 0);
/** What one goods receipt is worth at the PO's rates. */
export const receiptValue = (po: PurchaseOrder, receipt: PurchaseReceipt) =>
  receipt.items.reduce((sum, line) => sum + Number(line.quantity) * Number(po.items.find((item) => item.id === line.purchaseOrderItemId)?.rate ?? 0), 0);
export const isOpen = (po: PurchaseOrder) => OPEN_STATUSES.includes(po.status);
/** Value still to arrive; nothing on a finished, cancelled or closed PO. */
export const pendingValue = (po: PurchaseOrder) =>
  isOpen(po) ? po.items.reduce((sum, item) => sum + remainingQuantity(item) * Number(item.rate ?? 0), 0) : 0;
export const isOverdue = (po: PurchaseOrder) => isOpen(po) && !!po.expectedDate && po.expectedDate.slice(0, 10) < todayInput();
/** Whole days from today to the expected date: negative when late, null when no date is set. */
export const daysToExpected = (po: Pick<PurchaseOrder, "expectedDate">) =>
  po.expectedDate ? Math.round((Date.parse(po.expectedDate.slice(0, 10)) - Date.parse(todayInput())) / 86_400_000) : null;
/** "3 days late", "due today", "in 5 days" for an open PO; "" when there is no date or the PO is finished. */
export const dueText = (po: PurchaseOrder) => {
  const days = daysToExpected(po);
  if (days === null || !isOpen(po)) return "";
  if (days === 0) return "Due today";
  const n = Math.abs(days);
  return days < 0 ? `${n} day${n === 1 ? "" : "s"} late` : `In ${n} day${n === 1 ? "" : "s"}`;
};
/** "12kg 345g", "500g", "40.000 CONE". */
export const qty = (value: number, unit: string) => unitQty(value, unit);
export const statusTone = (status: PurchaseStatus) =>
  status === "RECEIVED" ? "success" : status === "CANCELLED" ? "danger" : status === "PARTIALLY_RECEIVED" ? "info" : status === "CLOSED" ? "default" : "warning";
/** A line's item code, or a note that it gets one on receipt. */
export const codeLabel = (item: Pick<PurchaseItem, "itemCode">) => item.itemCode ?? "Code on receipt";

/** "12.000 KG Cotton yarn, 40.000 CONE Polyester" — what is still to come on a PO. */
export const remainingText = (po: PurchaseOrder) =>
  po.items
    .filter((item) => remainingQuantity(item) > 0)
    .map((item) => `${qty(remainingQuantity(item), item.unit)} ${item.itemName}`)
    .join(", ");

/** A sensible stock category for a distributor's material, e.g. "Yarn / Cotton" → YARN. The user can still change it. */
export const categoryFor = (material?: string | null): StockCategory => {
  const m = (material ?? "").toLowerCase();
  if (m.includes("yarn")) return "YARN";
  if (m.includes("chem") || m.includes("dye")) return "CHEMICAL";
  if (m.includes("pack")) return "PACKING";
  if (m.includes("grey")) return "GREY_FABRIC";
  if (m.includes("fabric")) return "FINISHED_FABRIC";
  return "RAW_MATERIAL";
};
