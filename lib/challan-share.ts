import { appLink, challanSummary, type ShareTarget } from "@/components/share-menu";
import { BRAND } from "@/lib/brand";
import { formatDateTime, money, unitQty } from "@/lib/utils";

type Line = { itemName: string; itemCode?: string | null; unit: string; quantity: number };

const lineText = (line: Line) => `${line.itemName}${line.itemCode ? ` (${line.itemCode})` : ""} — ${unitQty(line.quantity, line.unit)}`;
/** "286kg 50g · 12.000 PCS". */
export function totalsOf(lines: Line[]) {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.unit, (totals.get(line.unit) ?? 0) + line.quantity);
  return [...totals.entries()].map(([unit, quantity]) => unitQty(quantity, unit)).join(" · ");
}
const companyOf = (company?: Record<string, string | undefined>) => company?.name || BRAND.name;

/** A dispatched sale's delivery challan. */
export function deliveryShare(c: {
  id: string;
  challanNo: string;
  dispatchedAt: string | null;
  partyName: string;
  warehouse: { code: string; name: string };
  vehicleNo: string | null;
  lines: Line[];
  value?: number | null;
  company?: Record<string, string | undefined>;
}): ShareTarget {
  const title = `Delivery challan ${c.challanNo}`;
  return {
    title,
    pdfPath: `/sales/${c.id}/delivery-challan/pdf`,
    fileName: `${c.challanNo}.pdf`,
    link: appLink(`/challans?tab=delivery&open=${c.id}`),
    text: challanSummary({
      title,
      date: formatDateTime(c.dispatchedAt),
      party: ["Deliver to", c.partyName],
      place: ["From", `${c.warehouse.code} · ${c.warehouse.name}`],
      vehicle: c.vehicleNo,
      lines: c.lines.map(lineText),
      total: totalsOf(c.lines),
      value: c.value ? money(c.value) : null,
      company: companyOf(c.company),
    }),
  };
}

/** A goods receipt's received challan. */
export function receivedShare(c: {
  id: string;
  receiptNo: string;
  receivedAt: string;
  supplierName: string;
  warehouse: { code: string; name: string };
  vehicleNo: string | null;
  poNo: string;
  lines: Line[];
  value?: number | null;
  company?: Record<string, string | undefined>;
}): ShareTarget {
  const title = `Received challan ${c.receiptNo} · ${c.poNo}`;
  return {
    title,
    pdfPath: `/procurement/receipts/${c.id}/pdf`,
    fileName: `${c.receiptNo}.pdf`,
    link: appLink(`/challans?tab=received&open=${c.id}`),
    text: challanSummary({
      title,
      date: formatDateTime(c.receivedAt),
      party: ["Received from", c.supplierName],
      place: ["Into", `${c.warehouse.code} · ${c.warehouse.name}`],
      vehicle: c.vehicleNo,
      lines: c.lines.map(lineText),
      total: totalsOf(c.lines),
      value: c.value ? money(c.value) : null,
      company: companyOf(c.company),
    }),
  };
}

/** A warehouse's received / export challan. */
export function warehouseShare(c: {
  id: string;
  billNo: string;
  kind: "RECEIVED" | "EXPORT";
  createdAt: string;
  partyName: string | null;
  warehouse: { code: string; name: string };
  vehicleNo: string | null;
  cancelled: boolean;
  /** Full lines when the challan is open; just item names and totals from a list row. */
  lines?: Line[];
  items?: string[];
  totals?: string;
  company?: Record<string, string | undefined>;
}): ShareTarget {
  const received = c.kind === "RECEIVED";
  const title = `${received ? "Received" : "Export"} challan ${c.billNo}${c.cancelled ? " (CANCELLED)" : ""}`;
  return {
    title,
    pdfPath: `/inventory/bills/${c.id}/pdf`,
    fileName: `${c.billNo}.pdf`,
    link: appLink(`/challans?tab=warehouse&open=${c.id}`),
    text: challanSummary({
      title,
      date: formatDateTime(c.createdAt),
      party: [received ? "Received from" : "Sent to", c.partyName],
      place: [received ? "Into" : "From", `${c.warehouse.code} · ${c.warehouse.name}`],
      vehicle: c.vehicleNo,
      lines: c.lines ? c.lines.map(lineText) : c.items,
      total: c.lines ? totalsOf(c.lines) : c.totals,
      company: companyOf(c.company),
    }),
  };
}
