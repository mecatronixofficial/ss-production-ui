import type { BadgeTone } from "@/components/ui/badge";
import type { StockCategory } from "@/lib/types";

/** Sales as `/sales` returns them. Prices are null for warehouse staff. */
export type SaleStatus = "PENDING" | "REJECTED" | "DISPATCHED" | "CANCELLED";
export type SalePartyType = "DISTRIBUTOR" | "TEXTILE";
export type SaleItem = {
  id: string;
  category: StockCategory;
  itemCode: string;
  itemName: string;
  lotNo: string | null;
  unit: string;
  quantity: string;
  dispatchedQty: string | null;
  rate: string | null;
  amount: string | null;
  /** The item's full details (fabric type, dia, GSM, GG, LL, colour…), on a sale's own page. */
  specs?: Array<{ label: string; value: string }>;
};
export type Sale = {
  id: string;
  saleNo: string;
  /** Delivery challan number (DC-2026-000001), given on dispatch. */
  challanNo: string | null;
  saleDate: string;
  status: SaleStatus;
  partyType: SalePartyType;
  supplierId: string | null;
  supplier: { id: string; code: string; name: string } | null;
  /** Set when sold to a textile from the Textiles list. */
  textileId: string | null;
  textile: { id: string; code: string; name: string } | null;
  partyName: string;
  partyGst: string | null;
  partyPhone: string | null;
  partyAddress: string | null;
  warehouseId: string;
  warehouse: { id: string; code: string; name: string };
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporter: string | null;
  lrNo: string | null;
  gstRate: string;
  subtotal: string | null;
  gstAmount: string | null;
  totalAmount: string | null;
  notes: string | null;
  dispatchedAt: string | null;
  dispatchNotes: string | null;
  rejectReason: string | null;
  createdAt: string;
  items: SaleItem[];
  /** Money received on the bill (admins only; null when cancelled). `pending` is in cheques not yet cleared. */
  payment: { received: number; pending: number; due: number; status: "PAID" | "PART_PAID" | "UNPAID" | "CHEQUE_PENDING" } | null;
  /** Only on a single sale. */
  createdBy?: string | null;
  verifiedBy?: string | null;
};

/** A dispatched sale as its printable delivery challan (`/sales/:id/delivery-challan`). Prices are null for non-admins. */
export type DeliveryChallan = {
  id: string;
  challanNo: string;
  saleNo: string;
  saleDate: string;
  dispatchedAt: string | null;
  partyType: SalePartyType;
  party: { code: string | null; name: string; gst: string | null; phone: string | null; address: string | null };
  warehouse: { id: string; code: string; name: string; location: string | null };
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporter: string | null;
  lrNo: string | null;
  dispatchNotes: string | null;
  verifiedBy: string | null;
  lines: Array<{ id: string; category: StockCategory; itemCode: string; itemName: string; lotNo: string | null; unit: string; sold: number; quantity: number; rate: number | null; amount: number | null; specs: Array<{ label: string; value: string }> }>;
  gstRate: number;
  subtotal: number | null;
  gstAmount: number | null;
  total: number | null;
  pricesShown: boolean;
  company: Record<string, string | undefined>;
};

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  PENDING: "Waiting for warehouse",
  REJECTED: "Sent back",
  DISPATCHED: "Dispatched",
  CANCELLED: "Cancelled",
};
export const saleTone = (status: SaleStatus): BadgeTone =>
  status === "DISPATCHED" ? "success" : status === "REJECTED" ? "danger" : status === "CANCELLED" ? "default" : "warning";
export const PARTY_LABEL: Record<SalePartyType, string> = { DISTRIBUTOR: "Distributor", TEXTILE: "Textile" };
export const GST_RATES = [0, 5, 12, 18] as const;

/** What the bill is for: the loaded quantity once dispatched, the sold quantity before. */
export const billQty = (item: SaleItem) => Number(item.dispatchedQty ?? item.quantity);

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoDigits = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", twoDigits(n % 100)].filter(Boolean).join(" ");

/** 123456.5 → "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only" (Indian grouping). */
export function amountInWords(amount: number) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  let rest = rupees;
  for (const [size, name] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1_000, "Thousand"]] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${count >= 100 ? threeDigits(count) : twoDigits(count)} ${name}`);
    rest %= size;
  }
  if (rest) parts.push(threeDigits(rest));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}
