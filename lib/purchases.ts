import type { StockCategory } from "@/lib/types";
import { todayInput, unitQty } from "@/lib/utils";

/** Purchase orders as `/procurement/purchase-orders` and `/procurement/incoming` return them. */
export type PurchaseStatus = "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED" | "CLOSED";
export type PurchaseSupplier = { id: string; code: string; name: string; materialCategory?: string | null; millId?: string | null; partyType?: "DISTRIBUTOR" | "MILL" };
export type PurchaseContext = { suppliers: PurchaseSupplier[]; mills?: PurchaseSupplier[]; warehouses: PurchaseWarehouse[] };
export type PurchaseWarehouse = { id: string; code: string; name: string };
export type PurchaseItem = {
  id: string;
  /** Given on the line's first receipt (01SS26…); null until then. */
  itemCode: string | null;
  itemName: string;
  /** The stock the line becomes when received; null on lines ordered before it was asked. */
  category?: StockCategory | null;
  quantity: string;
  unit: string;
  /** Null for warehouse staff and managers: they see what to receive, not prices. */
  rate: string | null;
  /** Defaults to zero for orders made before per-item GST was introduced. */
  gstRate?: string | null;
  subtotal?: string | null;
  gstAmount?: string | null;
  totalAmount?: string | null;
  /** Its details as ordered (yarn count, quality, blend, mill, bags…; fabric type, dia, GSM, colour…). */
  specs?: ItemSpec[] | null;
  receiptItems: Array<{ quantity: string }>;
};

/** One detail of a purchased item, e.g. { label: "Count", value: "36'S" }. */
export type ItemSpec = { label: string; value: string };
export type SpecGroup = "yarn" | "fabric" | "other";
export type SpecField = { label: string; placeholder: string };

/** Which details a material is ordered with. */
export const specGroup = (category?: StockCategory | null): SpecGroup => (category === "YARN" ? "yarn" : category?.endsWith("_FABRIC") ? "fabric" : "other");

export const SPEC_FIELDS: Record<SpecGroup, SpecField[]> = {
  yarn: [
    { label: "Count", placeholder: "36'S" },
    { label: "Quality", placeholder: "VL, G-M, C-M, Combed" },
    { label: "Blend", placeholder: "100% Cotton, PC 65/35" },
    { label: "Mill / brand", placeholder: "Cheran Mill" },
    { label: "Shade", placeholder: "Raw white" },
    { label: "Bags", placeholder: "30+9" },
    { label: "KG per bag", placeholder: "60" },
  ],
  fabric: [
    { label: "Fabric", placeholder: "Single jersey, Rib" },
    { label: "Dia", placeholder: "30" },
    { label: "GSM", placeholder: "180" },
    { label: "GG", placeholder: "24" },
    { label: "LL", placeholder: "2.8" },
    { label: "Colour", placeholder: "Navy" },
    { label: "Rolls", placeholder: "25" },
  ],
  other: [
    { label: "Brand", placeholder: "Make" },
    { label: "Grade / spec", placeholder: "Type, grade, strength" },
    { label: "Pack size", placeholder: "25 KG drum" },
    { label: "Packs", placeholder: "4" },
  ],
};

export const SPEC_GROUP_LABEL: Record<SpecGroup, string> = { yarn: "Yarn details", fabric: "Fabric details", other: "Material details" };

/** "Count 36'S · Quality VL · Bags 30+9" */
export const specsText = (specs?: ItemSpec[] | null) => (specs ?? []).map((s) => `${s.label} ${s.value}`).join(" · ");

/** The name an item gets from its details when none is typed: "36'S VL", "Single jersey 30 DIA 180 GSM Navy". */
export function suggestedName(group: SpecGroup, specs: Record<string, string>) {
  const v = (label: string) => specs[label]?.trim() ?? "";
  const parts =
    group === "yarn" ? [v("Count"), v("Quality"), v("Blend")] :
    group === "fabric" ? [v("Fabric"), v("Dia") && `${v("Dia")} DIA`, v("GSM") && `${v("GSM")} GSM`, v("Colour")] :
    [v("Brand"), v("Grade / spec")];
  return parts.filter(Boolean).join(" ");
}

/** Yarn ordered by bags: bags (30+9) × KG per bag, when both are numbers. */
export function bagsKg(specs: Record<string, string>) {
  const bags = specs["Bags"]?.trim() ?? "";
  const perBag = Number(specs["KG per bag"]);
  if (!/^\d+(\s*\+\s*\d+)*$/.test(bags) || !(perBag > 0)) return null;
  const count = bags.split("+").reduce((sum, part) => sum + Number(part.trim()), 0);
  return { count, kg: Math.round(count * perBag * 1000) / 1000 };
}
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
  supplier: { id: string; code: string; name: string; company: string | null; contactPerson: string | null; mobile: string | null; gst: string | null; address: string | null; millId?: string | null; partyType?: "DISTRIBUTOR" | "MILL" };
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
    /** Taxable value: quantity × rate. */
    amount: number | null;
    gstRate?: number | null;
    gstAmount?: number | null;
    /** Amount with GST, as on the purchase entry. */
    totalAmount?: number | null;
    /** The item's full details: this receipt's lot, distributor, PO, and for fabric its construction. */
    specs: Array<{ label: string; value: string }>;
    /** Bags / rolls as written at receipt ("30+9") and their total. */
    packages?: string | null;
    packageCount?: number | null;
    details?: string | null;
  }>;
  /** Taxable value and GST of what was received; null when prices are hidden from the viewer. */
  subtotal?: number | null;
  gstAmount?: number | null;
  /** With GST, the same as the purchase entry's total for what was received. Null when prices are hidden. */
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
  subtotal?: string | null;
  gstAmount?: string | null;
  totalAmount?: string | null;
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
/** Round each line's taxable value and GST to paise, as the backend does. */
export function purchaseLineTotals(item: { quantity: string | number; rate: string | number | null; gstRate?: string | number | null }) {
  const quantity = Math.round(Number(item.quantity || 0) * 1000);
  const rate = Math.round(Number(item.rate || 0) * 100);
  const gstRate = Math.round(Number(item.gstRate || 0) * 100);
  const subtotal = Math.round(quantity * rate / 1000);
  const gstAmount = Math.round(subtotal * gstRate / 10000);
  return { subtotal: subtotal / 100, gstAmount: gstAmount / 100, totalAmount: (subtotal + gstAmount) / 100 };
}

export function purchaseTotals(items: Parameters<typeof purchaseLineTotals>[0][]) {
  const totals = items.reduce((sum, item) => {
    const line = purchaseLineTotals(item);
    return { subtotal: sum.subtotal + Math.round(line.subtotal * 100), gstAmount: sum.gstAmount + Math.round(line.gstAmount * 100) };
  }, { subtotal: 0, gstAmount: 0 });
  return { subtotal: totals.subtotal / 100, gstAmount: totals.gstAmount / 100, totalAmount: (totals.subtotal + totals.gstAmount) / 100 };
}

export const orderValue = (po: PurchaseOrder) => purchaseTotals(po.items).totalAmount;
/** Value received against the order, including its item GST. Receipt challans keep their material value before GST. */
export const receivedOrderValue = (po: PurchaseOrder) => purchaseTotals(po.items.map((item) => ({ ...item, quantity: receivedQuantity(item) }))).totalAmount;
/** What one goods receipt is worth at the PO's rates. */
export const receiptValue = (po: PurchaseOrder, receipt: PurchaseReceipt) =>
  receipt.items.reduce((sum, line) => sum + Number(line.quantity) * Number(po.items.find((item) => item.id === line.purchaseOrderItemId)?.rate ?? 0), 0);
export const isOpen = (po: PurchaseOrder) => OPEN_STATUSES.includes(po.status);
/** Value still to arrive; nothing on a finished, cancelled or closed PO. */
export const pendingValue = (po: PurchaseOrder) =>
  isOpen(po) ? Math.max(0, Math.round((orderValue(po) - receivedOrderValue(po)) * 100) / 100) : 0;
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
