"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, CircleDot, ClipboardCheck, Download, Eye, Factory, FileText, Info, IndianRupee, Scale, Truck, Users, Warehouse as WarehouseIcon, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { qty } from "@/lib/purchases";
import { PARTY_LABEL, type SalePartyType } from "@/lib/sales";
import { prefetchApi, useApiQuery } from "@/lib/use-api-query";
import { ATTENTION_KINDS, type AttentionKind } from "@/lib/attention";
import { cn, formatDate, formatDateTime, money, todayInput, unitQty } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { toast } from "@/lib/toast-store";
import { confirmDialog } from "@/lib/confirm-store";
import { DataTable } from "@/components/data-table";
import { DeliveryChallanDialog } from "@/components/delivery-challan";
import { ProcessChallanDialog } from "@/components/process-challan";
import { ReceivedChallanDialog } from "@/components/received-challan";
import { BILL_SHORT, StockBillDialog, type StockBillKind } from "@/components/stock-bill";
import { ShareMenu } from "@/components/share-menu";
import { deliveryShare, receivedShare, warehouseShare } from "@/lib/challan-share";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "delivery" | "received" | "warehouse" | "process";

/** A row of `/production/challans`: fabric of a batch leaving a process (or a warehouse) for the next place. */
type ProcessRow = {
  id: string;
  challanNo: string;
  process: string;
  date: string;
  material: string;
  fromName: string;
  toKind: "PROCESS" | "WAREHOUSE" | "PARTY";
  toName: string;
  weightKg: number;
  packages: number | null;
  packageUnit: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  cancelledAt: string | null;
  flow: { flowNo: string; fabricType: string | null; color: string | null };
};
const TO_LABEL: Record<ProcessRow["toKind"], string> = { PROCESS: "Mill", WAREHOUSE: "Warehouse", PARTY: "Party" };

/** A row of `/inventory/bills`: a warehouse's received / export challan, made automatically with every movement. */
type WarehouseRow = {
  id: string;
  billNo: string;
  kind: StockBillKind;
  createdAt: string;
  partyName: string | null;
  vehicleNo: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: number;
  items: string[];
  totals: Record<string, number>;
  warehouse: { id: string; code: string; name: string };
  source: { label: string };
};
const totalsText = (totals: Record<string, number>) => Object.entries(totals).map(([unit, value]) => unitQty(value, unit)).join(" · ");
type Line = { itemName: string; itemCode: string | null; unit: string; quantity: number };

/** A row of `/sales/delivery-challans`. */
type DeliveryRow = {
  id: string;
  challanNo: string;
  saleNo: string;
  dispatchedAt: string;
  partyType: SalePartyType;
  partyName: string;
  warehouse: { code: string; name: string };
  vehicleNo: string | null;
  driverName: string | null;
  transporter: string | null;
  lrNo: string | null;
  verifiedBy: string | null;
  items: Line[];
  total: number;
};

/** A row of `/procurement/receipts`. */
type ReceivedRow = {
  id: string;
  receiptNo: string;
  receivedAt: string;
  challanNo: string | null;
  vehicleNo: string | null;
  lotNo: string | null;
  notes: string | null;
  receivedBy: string | null;
  warehouse: { code: string; name: string };
  purchaseOrder: { id: string; poNo: string };
  supplier: { code: string; name: string };
  items: Line[];
  value: number;
};

/** The most rows each register returns (the server's limit); more than that needs a date range. */
const LIMIT: Record<Tab, number> = { delivery: 2000, received: 2000, process: 2000, warehouse: 1000 };

/** A timestamp as a day on this computer's calendar (IST), not UTC's. */
const dayOf = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayText = (d: Date) => dayOf(d.toISOString());
/** Quick date ranges: [label, from, to] ("" = open). */
function presets(): Array<[string, string, string]> {
  const today = todayInput();
  const now = new Date();
  const monthStart = dayText(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastStart = dayText(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastEnd = dayText(new Date(now.getFullYear(), now.getMonth(), 0));
  const ninety = new Date(now);
  ninety.setDate(ninety.getDate() - 89);
  return [["All dates", "", ""], ["Today", today, today], ["This month", monthStart, today], ["Last month", lastStart, lastEnd], ["Last 90 days", dayText(ninety), today]];
}
const kgOf = (items: Line[]) => items.filter((i) => i.unit.toUpperCase() === "KG").reduce((sum, i) => sum + i.quantity, 0);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A figure above the register. */
function Figure({ label, value, caption, icon: Icon, tone, alert }: { label: string; value: string; caption?: string; icon: typeof Truck; tone: "total" | "received" | "value" | "partial"; alert?: boolean }) {
  return (
    <div className={cn("purchases-stat-tile", `purchases-stat-tile--${tone}`, alert && "is-alert")}>
      <div className="purchases-stat-icon"><Icon size={15} /></div>
      <div className="min-w-0">
        <p className="purchases-stat-label">{label}</p>
        <p className="purchases-stat-value">{value}</p>
        {caption && <p className="purchases-stat-caption truncate" title={caption}>{caption}</p>}
      </div>
    </div>
  );
}

const dayStart = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const dayEnd = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);
const linesText = (items: Line[]) => items.map((i) => `${i.itemName} ${qty(i.quantity, i.unit)}`).join("; ");

function ItemsCell({ items }: { items: Line[] }) {
  const text = linesText(items);
  return <p className="line-clamp-2 max-w-64 text-xs text-gray-700" title={text}>{text || "—"}</p>;
}

/**
 * `/challans`: the office's register of every delivery challan (sales dispatched from a warehouse) and received
 * challan (material received against a PO). Office (admins) only: search, filter by date, and print any of them, anytime.
 */
function Challans() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "received" || tabParam === "warehouse" || tabParam === "process" ? tabParam : "delivery";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // A shared link (?open=<id>) opens that challan straight away.
  const linked = params.get("open");
  const [openDelivery, setOpenDelivery] = useState<string | null>(tab === "delivery" ? linked : null);
  const [openReceived, setOpenReceived] = useState<string | null>(tab === "received" ? linked : null);
  const [openWarehouse, setOpenWarehouse] = useState<string | null>(tab === "warehouse" ? linked : null);
  const [openProcess, setOpenProcess] = useState<string | null>(tab === "process" ? linked : null);
  /** Closing a challan opened from a link also drops `open` from the address. */
  const closed = () => {
    if (linked) router.replace(`${pathname}${tab === "delivery" ? "" : `?tab=${tab}`}`, { scroll: false });
  };
  const [kind, setKind] = useState<"" | StockBillKind>("");
  /** Only the challans with a paperwork gap (no vehicle, no distributor challan no), from "needs attention". */
  const [gapsOnly, setGapsOnly] = useState(false);
  const { user } = useAuth();
  const range = qs({ from: dayStart(from), to: dayEnd(to) });
  const pathOf = (t: Tab) =>
    t === "delivery" ? `/sales/delivery-challans${range}`
      : t === "received" ? `/procurement/receipts${range}`
        : t === "process" ? `/production/challans${range}`
          : `/inventory/bills${qs({ from: dayStart(from), to: dayEnd(to), kind: kind || undefined })}`;
  // The whole register (no dates picked) is kept for the browser tab, so coming back shows it at once.
  const keep = { persist: from || to || kind ? undefined : user?.id };
  const delivery = useApiQuery<DeliveryRow[]>(tab === "delivery" ? pathOf("delivery") : null, keep);
  const received = useApiQuery<ReceivedRow[]>(tab === "received" ? pathOf("received") : null, keep);
  const process = useApiQuery<ProcessRow[]>(tab === "process" ? pathOf("process") : null, keep);
  const warehouse = useApiQuery<{ unbilled: number; bills: WarehouseRow[] }>(tab === "warehouse" ? pathOf("warehouse") : null, keep);

  const setTab = (value: Tab) => {
    setGapsOnly(false);
    router.replace(`${pathname}${value === "delivery" ? "" : `?tab=${value}`}`, { scroll: false });
  };

  /** Every movement still without a challan (older ones, or freed by a cancelled challan) gets one. */
  const issueAll = async () => {
    const waiting = warehouse.data?.unbilled ?? 0;
    const ok = await confirmDialog({
      title: `Issue challans for ${waiting} movement${waiting === 1 ? "" : "s"}?`,
      description: "Each source (a goods receipt, a sale, a batch, a godown entry…) gets one received or export challan per warehouse.",
      confirmLabel: "Issue challans",
    });
    if (!ok) return;
    try {
      const result = await api<{ issued: number }>("/inventory/bills/issue-all", { method: "POST", body: JSON.stringify({}) });
      toast.success(`${result.issued} challan${result.issued === 1 ? "" : "s"} issued.`);
      await warehouse.reload();
    } catch {
      // api() already showed the error.
    }
  };

  const deliveryColumns = useMemo<ColumnDef<DeliveryRow>[]>(
    () => [
      {
        header: "Delivery challan",
        id: "dc",
        accessorFn: (r) => `${r.challanNo} ${r.dispatchedAt}`,
        cell: ({ row }) => (
          <div>
            <button type="button" className="font-mono font-semibold text-[#1b3c55] hover:underline" onClick={() => setOpenDelivery(row.original.id)}>{row.original.challanNo}</button>
            <p className="text-xs text-gray-400">{formatDateTime(row.original.dispatchedAt)}</p>
          </div>
        ),
      },
      {
        header: "Bill / consignee",
        id: "party",
        accessorFn: (r) => `${r.saleNo} ${r.partyName} ${PARTY_LABEL[r.partyType]}`,
        cell: ({ row }) => (
          <div className="max-w-48">
            <Link href={`/sales/${row.original.id}`} className="customers-code">{row.original.saleNo}</Link>
            <p className="truncate text-sm font-medium" title={row.original.partyName}>{row.original.partyName}</p>
            <p className="text-xs text-gray-400">{PARTY_LABEL[row.original.partyType]}</p>
          </div>
        ),
      },
      { header: "From", id: "warehouse", accessorFn: (r) => r.warehouse.code, cell: ({ row }) => <span className="whitespace-nowrap font-semibold">{row.original.warehouse.code}</span> },
      {
        header: "Vehicle / transport",
        id: "vehicle",
        accessorFn: (r) => `${r.vehicleNo ?? ""} ${r.driverName ?? ""} ${r.transporter ?? ""} ${r.lrNo ?? ""}`,
        cell: ({ row }) => (
          <div className="text-xs">
            <p className="font-mono font-semibold text-gray-700">{row.original.vehicleNo || "—"}</p>
            <p className="text-gray-500">{[row.original.driverName, row.original.transporter, row.original.lrNo && `LR ${row.original.lrNo}`].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        ),
      },
      { header: "Items dispatched", id: "items", enableSorting: false, accessorFn: (r) => linesText(r.items), cell: ({ row }) => <ItemsCell items={row.original.items} /> },
      { header: "Bill value", id: "total", meta: { align: "right" }, accessorFn: (r) => r.total, cell: ({ row }) => <span className="font-semibold">{money(row.original.total)}</span> },
      { header: "Dispatched by", id: "by", accessorFn: (r) => r.verifiedBy ?? "", cell: ({ row }) => <span className="text-xs text-gray-600">{row.original.verifiedBy || "—"}</span> },
      {
        header: "",
        id: "print",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => setOpenDelivery(r.id)}><Eye size={14} /> Open</Button>
              <ShareMenu
                target={deliveryShare({
                  id: r.id,
                  challanNo: r.challanNo,
                  dispatchedAt: r.dispatchedAt,
                  partyName: r.partyName,
                  warehouse: r.warehouse,
                  vehicleNo: r.vehicleNo,
                  lines: r.items,
                  value: r.total,
                })}
              />
            </div>
          );
        },
      },
    ],
    [],
  );

  const receivedColumns = useMemo<ColumnDef<ReceivedRow>[]>(
    () => [
      {
        header: "Received challan",
        id: "grn",
        accessorFn: (r) => `${r.receiptNo} ${r.receivedAt}`,
        cell: ({ row }) => (
          <div>
            <button type="button" className="font-mono font-semibold text-[#1b3c55] hover:underline" onClick={() => setOpenReceived(row.original.id)}>{row.original.receiptNo}</button>
            <p className="text-xs text-gray-400">{formatDateTime(row.original.receivedAt)}</p>
          </div>
        ),
      },
      {
        header: "PO / distributor",
        id: "po",
        accessorFn: (r) => `${r.purchaseOrder.poNo} ${r.supplier.name} ${r.supplier.code}`,
        cell: ({ row }) => (
          <div className="max-w-48">
            <Link href={`/purchases/${row.original.purchaseOrder.id}`} className="customers-code">{row.original.purchaseOrder.poNo}</Link>
            <p className="truncate text-sm font-medium" title={row.original.supplier.name}>{row.original.supplier.name}</p>
            <p className="text-xs text-gray-400">{row.original.supplier.code}</p>
          </div>
        ),
      },
      { header: "Into", id: "warehouse", accessorFn: (r) => r.warehouse.code, cell: ({ row }) => <span className="whitespace-nowrap font-semibold">{row.original.warehouse.code}</span> },
      {
        header: "Their challan / vehicle",
        id: "challan",
        accessorFn: (r) => `${r.challanNo ?? ""} ${r.vehicleNo ?? ""} ${r.lotNo ?? ""}`,
        cell: ({ row }) => (
          <div className="text-xs">
            <p className="font-semibold text-gray-700">{row.original.challanNo || "—"}</p>
            <p className="font-mono text-gray-500">{row.original.vehicleNo || "No vehicle"}{row.original.lotNo ? ` · lot ${row.original.lotNo}` : ""}</p>
          </div>
        ),
      },
      { header: "Items received", id: "items", enableSorting: false, accessorFn: (r) => linesText(r.items), cell: ({ row }) => <ItemsCell items={row.original.items} /> },
      { header: "Value", id: "value", meta: { align: "right" }, accessorFn: (r) => r.value, cell: ({ row }) => <span className="font-semibold">{money(row.original.value)}</span> },
      { header: "Received by", id: "by", accessorFn: (r) => r.receivedBy ?? "", cell: ({ row }) => <span className="text-xs text-gray-600">{row.original.receivedBy || "—"}</span> },
      {
        header: "",
        id: "print",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => setOpenReceived(r.id)}><Eye size={14} /> Open</Button>
              <ShareMenu
                target={receivedShare({
                  id: r.id,
                  receiptNo: r.receiptNo,
                  receivedAt: r.receivedAt,
                  supplierName: r.supplier.name,
                  warehouse: r.warehouse,
                  vehicleNo: r.vehicleNo,
                  poNo: r.purchaseOrder.poNo,
                  lines: r.items,
                  value: r.value,
                })}
              />
            </div>
          );
        },
      },
    ],
    [],
  );

  const warehouseColumns = useMemo<ColumnDef<WarehouseRow>[]>(
    () => [
      {
        header: "Challan",
        id: "challan",
        accessorFn: (r) => `${r.billNo} ${r.createdAt}`,
        cell: ({ row }) => (
          <div>
            <button type="button" className="font-mono font-semibold text-[#1b3c55] hover:underline" onClick={() => setOpenWarehouse(row.original.id)}>{row.original.billNo}</button>
            <p className="text-xs text-gray-400">{formatDateTime(row.original.createdAt)}</p>
          </div>
        ),
      },
      {
        header: "Type",
        id: "kind",
        accessorFn: (r) => BILL_SHORT[r.kind],
        cell: ({ row }) => (
          <Badge tone={row.original.kind === "RECEIVED" ? "success" : "info"}>
            {row.original.kind === "RECEIVED" ? <ArrowDownLeft size={11} className="mr-0.5 inline" /> : <ArrowUpRight size={11} className="mr-0.5 inline" />}
            {row.original.kind === "RECEIVED" ? "In" : "Out"}
          </Badge>
        ),
      },
      { header: "Warehouse", id: "warehouse", accessorFn: (r) => `${r.warehouse.code} ${r.warehouse.name}`, cell: ({ row }) => <span className="whitespace-nowrap font-semibold" title={row.original.warehouse.name}>{row.original.warehouse.code}</span> },
      {
        header: "Party / source",
        id: "party",
        accessorFn: (r) => `${r.partyName ?? ""} ${r.source.label} ${r.vehicleNo ?? ""}`,
        cell: ({ row }) => (
          <div className="max-w-60">
            <p className="truncate text-sm font-medium" title={row.original.partyName ?? undefined}>{row.original.partyName || "—"}</p>
            <p className="truncate text-xs text-gray-500" title={row.original.source.label}>{row.original.source.label}</p>
            {row.original.vehicleNo && <p className="font-mono text-xs text-gray-400">{row.original.vehicleNo}</p>}
          </div>
        ),
      },
      {
        header: "Items",
        id: "items",
        enableSorting: false,
        accessorFn: (r) => r.items.join(" "),
        cell: ({ row }) => <p className="line-clamp-2 max-w-64 text-xs text-gray-700" title={row.original.items.join(", ")}>{row.original.items.join(", ") || "—"}</p>,
      },
      {
        header: "Quantity",
        id: "quantity",
        meta: { align: "right" },
        accessorFn: (r) => Object.values(r.totals).reduce((sum, value) => sum + value, 0),
        cell: ({ row }) => <span className="whitespace-nowrap font-semibold">{totalsText(row.original.totals) || "—"}</span>,
      },
      {
        header: "Status",
        id: "status",
        accessorFn: (r) => (r.cancelledAt ? "Cancelled" : "Issued"),
        cell: ({ row }) => (
          <span title={row.original.cancelReason ?? undefined}>
            <Badge tone={row.original.cancelledAt ? "default" : "success"}>{row.original.cancelledAt ? "Cancelled" : "Issued"}</Badge>
          </span>
        ),
      },
      {
        header: "",
        id: "print",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setOpenWarehouse(row.original.id)}><Eye size={14} /> Open</Button>
            <ShareMenu
              target={warehouseShare({
                ...row.original,
                cancelled: !!row.original.cancelledAt,
                // A list row has only item names and totals (its `lines` is a count).
                lines: undefined,
                items: row.original.items,
                totals: totalsText(row.original.totals),
              })}
            />
          </div>
        ),
      },
    ],
    [],
  );

  const processColumns = useMemo<ColumnDef<ProcessRow>[]>(() => [
    {
      header: "Delivery challan",
      id: "pdc",
      accessorFn: (r) => `${r.challanNo} ${r.date}`,
      cell: ({ row }) => (
        <div>
          <button type="button" className="font-mono font-semibold text-[#1b3c55] hover:underline" onClick={() => setOpenProcess(row.original.id)}>{row.original.challanNo}</button>
          <p className="text-xs text-gray-400">{formatDate(row.original.date)}</p>
          {row.original.cancelledAt && <Badge tone="default">Cancelled</Badge>}
        </div>
      ),
    },
    {
      header: "Batch / process",
      id: "batch",
      accessorFn: (r) => `${r.flow.flowNo} ${r.process} ${r.material}`,
      cell: ({ row }) => (
        <div className="max-w-48">
          <Link href={`/production?batch=${encodeURIComponent(row.original.flow.flowNo)}`} className="customers-code">{row.original.flow.flowNo}</Link>
          <p className="text-sm font-medium">{row.original.process}</p>
          <p className="truncate text-xs text-gray-400">{[row.original.material, row.original.flow.fabricType, row.original.flow.color].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { header: "From", id: "from", accessorFn: (r) => r.fromName, cell: ({ row }) => <span className="block max-w-40 truncate text-sm" title={row.original.fromName}>{row.original.fromName}</span> },
    {
      header: "To",
      id: "to",
      accessorFn: (r) => `${r.toName} ${TO_LABEL[r.toKind]}`,
      cell: ({ row }) => (
        <div className="max-w-44">
          <p className="truncate text-sm font-semibold" title={row.original.toName}>{row.original.toName}</p>
          <p className="text-xs text-gray-400">{TO_LABEL[row.original.toKind]}</p>
        </div>
      ),
    },
    { header: "Vehicle", id: "vehicle", accessorFn: (r) => `${r.vehicleNo ?? ""} ${r.driverName ?? ""}`, cell: ({ row }) => <div className="text-xs"><p className="font-mono font-semibold text-gray-700">{row.original.vehicleNo || "—"}</p><p className="text-gray-500">{row.original.driverName || ""}</p></div> },
    { header: "Packages", id: "packages", meta: { align: "right" }, accessorFn: (r) => r.packages ?? 0, cell: ({ row }) => (row.original.packages ? `${row.original.packages} ${row.original.packageUnit ?? ""}` : "—") },
    { header: "Weight", id: "weight", meta: { align: "right" }, accessorFn: (r) => r.weightKg, cell: ({ row }) => <span className="font-semibold">{unitQty(row.original.weightKg, "KG")}</span> },
    {
      header: "",
      id: "open",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setOpenProcess(row.original.id)}><Eye size={14} /> Open</Button>
        </div>
      ),
    },
  ], []);

  const active = tab === "delivery" ? delivery : tab === "received" ? received : tab === "process" ? process : warehouse;
  const period = from || to ? `${from ? formatDate(from) : "start"} to ${to ? formatDate(to) : "today"}` : "all dates";
  const warehouseRows = warehouse.data?.bills ?? [];
  const count = tab === "warehouse" ? warehouseRows.length : ((active.data as unknown[] | undefined)?.length ?? 0);
  const value = tab === "delivery" ? (delivery.data ?? []).reduce((s, r) => s + r.total, 0) : (received.data ?? []).reduce((s, r) => s + r.value, 0);
  const live = warehouseRows.filter((r) => !r.cancelledAt);

  // Paperwork gaps: a dispatch or a process hand-off without its vehicle, a receipt without the distributor's challan.
  const deliveryRows = delivery.data ?? [];
  const receivedRows = received.data ?? [];
  const processRows = process.data ?? [];
  const deliveryGaps = deliveryRows.filter((r) => !r.vehicleNo?.trim());
  const receivedGaps = receivedRows.filter((r) => !r.challanNo?.trim());
  const processGaps = processRows.filter((r) => !r.cancelledAt && !r.vehicleNo?.trim());
  const processLive = processRows.filter((r) => !r.cancelledAt);
  const processKg = (toKind?: ProcessRow["toKind"]) => processLive.filter((r) => !toKind || r.toKind === toKind).reduce((sum, r) => sum + r.weightKg, 0);

  const attention: Array<{ tone: "danger" | "warning" | "info"; kind: AttentionKind; text: string; action: string; onClick: () => void; active: boolean }> = [];
  if (tab === "delivery" && deliveryGaps.length)
    attention.push({ tone: "warning", kind: "delivery", text: `${plural(deliveryGaps.length, "delivery challan")} without a vehicle number`, action: gapsOnly ? "Show all" : "Show them", onClick: () => setGapsOnly(!gapsOnly), active: gapsOnly });
  if (tab === "received" && receivedGaps.length)
    attention.push({ tone: "info", kind: "purchases", text: `${plural(receivedGaps.length, "receipt")} without the distributor's challan number`, action: gapsOnly ? "Show all" : "Show them", onClick: () => setGapsOnly(!gapsOnly), active: gapsOnly });
  if (tab === "process" && processGaps.length)
    attention.push({ tone: "info", kind: "production", text: `${plural(processGaps.length, "production challan")} without a vehicle number`, action: gapsOnly ? "Show all" : "Show them", onClick: () => setGapsOnly(!gapsOnly), active: gapsOnly });
  if (tab === "warehouse" && warehouse.data?.unbilled)
    attention.push({ tone: "warning", kind: "warehouse", text: `${plural(warehouse.data.unbilled, "stock movement")} still without a warehouse challan`, action: "Issue them", onClick: () => void issueAll(), active: false });
  const shownDelivery = gapsOnly ? deliveryGaps : deliveryRows;
  const shownReceived = gapsOnly ? receivedGaps : receivedRows;
  const shownProcess = gapsOnly ? processGaps : processRows;
  const atLimit = !!active.data && count >= LIMIT[tab];
  const pickRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
  };

  const exportCsv = () => {
    const suffix = `${from || "start"}-to-${to || todayInput()}`;
    if (tab === "delivery") {
      downloadCsv(
        `delivery-challans-${suffix}.csv`,
        ["Delivery challan", "Dispatched", "Bill no", "Party type", "Consignee", "Warehouse", "Vehicle", "Driver", "Transporter", "LR no", "Items", "Bill value", "Dispatched by"],
        shownDelivery.map((r) => [r.challanNo, dayOf(r.dispatchedAt), r.saleNo, PARTY_LABEL[r.partyType], r.partyName, r.warehouse.code, r.vehicleNo, r.driverName, r.transporter, r.lrNo, linesText(r.items), r.total.toFixed(2), r.verifiedBy]),
      );
    } else if (tab === "process") {
      downloadCsv(
        `process-challans-${suffix}.csv`,
        ["Delivery challan", "Date", "Batch", "Process", "Material", "From", "To", "To type", "Vehicle", "Driver", "Packages", "Weight KG", "Status"],
        shownProcess.map((r) => [r.challanNo, dayOf(r.date), r.flow.flowNo, r.process, r.material, r.fromName, r.toName, TO_LABEL[r.toKind], r.vehicleNo, r.driverName, r.packages ? `${r.packages} ${r.packageUnit ?? ""}` : "", r.weightKg.toFixed(3), r.cancelledAt ? "Cancelled" : "Issued"]),
      );
    } else if (tab === "warehouse") {
      downloadCsv(
        `warehouse-challans-${suffix}.csv`,
        ["Challan", "Date", "Type", "Warehouse", "Party", "Source", "Vehicle", "Items", "Lines", "Quantity", "Status", "Cancel reason"],
        warehouseRows.map((r) => [r.billNo, dayOf(r.createdAt), BILL_SHORT[r.kind], r.warehouse.code, r.partyName, r.source.label, r.vehicleNo, r.items.join("; "), r.lines, totalsText(r.totals), r.cancelledAt ? "Cancelled" : "Issued", r.cancelReason]),
      );
    } else {
      downloadCsv(
        `received-challans-${suffix}.csv`,
        ["Received challan", "Received", "PO no", "Distributor code", "Distributor", "Their challan no", "Vehicle", "Lot", "Warehouse", "Items", "Value", "Received by", "Remarks"],
        shownReceived.map((r) => [r.receiptNo, dayOf(r.receivedAt), r.purchaseOrder.poNo, r.supplier.code, r.supplier.name, r.challanNo, r.vehicleNo, r.lotNo, r.warehouse.code, linesText(r.items), r.value.toFixed(2), r.receivedBy, r.notes]),
      );
    }
  };

  return (
    <div className="purchases-page">
      <div className="purchases-page-header">
        <span className="purchases-page-icon"><FileText size={18} /></span>
        <div>
          <h2 className="text-lg font-bold md:text-xl">Challans</h2>
          <p className="text-xs text-gray-500">Office copies of every delivery, received, warehouse in / out and production challan, all made automatically. Open, print, download or share any of them (WhatsApp, Telegram, email, SMS, link or PDF), anytime.</p>
        </div>
      </div>

      <Card className="purchases-card purchases-card--register">
        <CardHeader className="flex flex-wrap items-end justify-between gap-3">
          <div className="challan-copy-picker !mr-0" role="group" aria-label="Challan type">
            <button type="button" aria-pressed={tab === "delivery"} onClick={() => setTab("delivery")} onPointerEnter={() => prefetchApi(pathOf("delivery"))}><Truck size={13} className="mr-1 inline" />Delivery challans</button>
            <button type="button" aria-pressed={tab === "received"} onClick={() => setTab("received")} onPointerEnter={() => prefetchApi(pathOf("received"))}><ClipboardCheck size={13} className="mr-1 inline" />Received challans</button>
            <button type="button" aria-pressed={tab === "warehouse"} onClick={() => setTab("warehouse")} onPointerEnter={() => prefetchApi(pathOf("warehouse"))}><WarehouseIcon size={13} className="mr-1 inline" />Warehouse in / out</button>
            <button type="button" aria-pressed={tab === "process"} onClick={() => setTab("process")} onPointerEnter={() => prefetchApi(pathOf("process"))}><Factory size={13} className="mr-1 inline" />Production</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {tab === "warehouse" && (
              <label>
                <span className="erp-label">Type</span>
                <select className="erp-input" value={kind} onChange={(e) => setKind(e.target.value as "" | StockBillKind)}>
                  <option value="">In and out</option>
                  <option value="RECEIVED">Received (in)</option>
                  <option value="EXPORT">Export (out)</option>
                </select>
              </label>
            )}
            <label>
              <span className="erp-label">From</span>
              <Input type="date" value={from} max={to || todayInput()} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              <span className="erp-label">To</span>
              <Input type="date" value={to} min={from || undefined} max={todayInput()} onChange={(e) => setTo(e.target.value)} />
            </label>
            {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}><X size={14} /> Clear dates</Button>}
            <Button variant="outline" disabled={count === 0} onClick={exportCsv}><Download size={14} /> Export CSV</Button>
          </div>
          <div className="challans-presets w-full" role="group" aria-label="Quick dates">
            {presets().map(([label, presetFrom, presetTo]) => (
              <button key={label} type="button" aria-pressed={from === presetFrom && to === presetTo} onClick={() => pickRange(presetFrom, presetTo)}>{label}</button>
            ))}
          </div>
          <p className="w-full text-xs text-gray-500">
            {active.data && tab === "warehouse" ? (
              <>
                <b className="text-gray-700">{count}</b> warehouse challan{count === 1 ? "" : "s"} · {period} · <b className="text-gray-700">{live.filter((r) => r.kind === "RECEIVED").length}</b> in · <b className="text-gray-700">{live.filter((r) => r.kind === "EXPORT").length}</b> out
                {count - live.length > 0 && <> · {count - live.length} cancelled</>}
                {!!warehouse.data?.unbilled && (
                  <>
                    {" · "}
                    <span className="font-semibold text-amber-700">{warehouse.data.unbilled} movement{warehouse.data.unbilled === 1 ? "" : "s"} still without a challan</span>{" "}
                    <button type="button" className="font-bold text-[#1b3c55] underline" onClick={() => void issueAll()}>Issue them</button>
                  </>
                )}
              </>
            ) : active.data && tab === "process" ? (
              <>
                <b className="text-gray-700">{count}</b> production delivery challan{count === 1 ? "" : "s"} · {period} · <b className="text-gray-700">{unitQty((process.data ?? []).filter((r) => !r.cancelledAt).reduce((sum, r) => sum + r.weightKg, 0), "KG")}</b> of fabric sent
              </>
            ) : active.data ? (
              <>
                <b className="text-gray-700">{count}</b> {tab === "delivery" ? "delivery" : "received"} challan{count === 1 ? "" : "s"} · {period} · value <b className="text-gray-700">{money(value)}</b>
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </CardHeader>
        <CardContent>
          {active.data && (
            <div className="mb-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {tab === "delivery" ? (
                <>
                  <Figure label="Delivery challans" value={String(deliveryRows.length)} caption={period} icon={Truck} tone="total" />
                  <Figure label="Bill value" value={money(value)} caption="Dispatched bills, with GST" icon={IndianRupee} tone="value" />
                  <Figure label="KG dispatched" value={unitQty(deliveryRows.reduce((sum, r) => sum + kgOf(r.items), 0), "KG")} caption="Other units are on each challan" icon={Scale} tone="received" />
                  <Figure label="Consignees" value={String(new Set(deliveryRows.map((r) => r.partyName.trim().toUpperCase())).size)} caption={`${new Set(deliveryRows.map((r) => r.vehicleNo).filter(Boolean)).size} vehicles used`} icon={Users} tone="partial" />
                </>
              ) : tab === "received" ? (
                <>
                  <Figure label="Received challans" value={String(receivedRows.length)} caption={period} icon={ClipboardCheck} tone="total" />
                  <Figure label="Value received" value={money(value)} caption="At the POs' rates" icon={IndianRupee} tone="value" />
                  <Figure label="KG received" value={unitQty(receivedRows.reduce((sum, r) => sum + kgOf(r.items), 0), "KG")} caption="Other units are on each challan" icon={Scale} tone="received" />
                  <Figure label="Distributors" value={String(new Set(receivedRows.map((r) => r.supplier.code)).size)} caption={`${new Set(receivedRows.map((r) => r.purchaseOrder.id)).size} purchase orders`} icon={Users} tone="partial" />
                </>
              ) : tab === "process" ? (
                <>
                  <Figure label="Production challans" value={String(processLive.length)} caption={processRows.length > processLive.length ? `${processRows.length - processLive.length} cancelled · ${period}` : period} icon={Factory} tone="total" />
                  <Figure label="Fabric sent" value={unitQty(processKg(), "KG")} caption="Every hand-off, not cancelled" icon={Scale} tone="value" />
                  <Figure label="To mills" value={unitQty(processKg("PROCESS"), "KG")} caption="Knitting, dyeing, compacting" icon={Factory} tone="received" />
                  <Figure label="To warehouses & parties" value={unitQty(processKg("WAREHOUSE") + processKg("PARTY"), "KG")} caption={`${unitQty(processKg("PARTY"), "KG")} straight to parties`} icon={Truck} tone="partial" />
                </>
              ) : (
                <>
                  <Figure label="Warehouse challans" value={String(live.length)} caption={warehouseRows.length > live.length ? `${warehouseRows.length - live.length} cancelled · ${period}` : period} icon={WarehouseIcon} tone="total" />
                  <Figure label="Received (in)" value={String(live.filter((r) => r.kind === "RECEIVED").length)} caption="Material into a warehouse" icon={ArrowDownLeft} tone="received" />
                  <Figure label="Export (out)" value={String(live.filter((r) => r.kind === "EXPORT").length)} caption="Material out of a warehouse" icon={ArrowUpRight} tone="value" />
                  <Figure label="Without a challan" value={String(warehouse.data?.unbilled ?? 0)} caption={warehouse.data?.unbilled ? "Stock movements to issue for" : "Every movement has one"} icon={AlertTriangle} tone="partial" alert={!!warehouse.data?.unbilled} />
                </>
              )}
            </div>
          )}
          {attention.length > 0 && (
            <section className="dashboard-attention mb-3" aria-label="Needs attention">
              <ul>
                {attention.map((item) => {
                  const { icon: KindIcon, label } = ATTENTION_KINDS[item.kind];
                  const ToneIcon = item.tone === "danger" ? AlertTriangle : item.tone === "warning" ? CircleDot : Info;
                  return (
                    <li key={item.text}>
                      <button type="button" aria-pressed={item.active} onClick={item.onClick} className={cn("dashboard-attention__item sales-attention w-full text-left", `is-${item.tone}`)}>
                        <span className={cn("attn-icon", `is-${item.kind}`, item.tone === "danger" && "is-urgent")}><KindIcon size={15} /></span>
                        <span className="dashboard-attention__text flex-1">
                          <span className={cn("attn-kind-chip", `is-${item.kind}`)}>{label}</span>
                          {item.text}
                        </span>
                        <ToneIcon size={14} className="shrink-0" aria-hidden />
                        <span className="shrink-0 text-xs font-bold underline">{item.action}</span>
                        <ArrowRight size={14} className="shrink-0 opacity-60" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {!active.data ? (
            active.error ? <ErrorState message={active.error} onRetry={() => void active.reload()} /> : <Loading />
          ) : tab === "delivery" ? (
            <DataTable
              data={shownDelivery}
              columns={deliveryColumns}
              minWidth={1120}
              searchPlaceholder="Search DC no, bill, consignee, vehicle, driver, LR, item..."
              getRowId={(row) => row.id}
              emptyTitle="No delivery challans"
              emptyDescription={from || to ? "Nothing dispatched in these dates." : "A delivery challan is made each time a warehouse dispatches a sale."}
            />
          ) : tab === "process" ? (
            <DataTable
              data={shownProcess}
              columns={processColumns}
              minWidth={1120}
              searchPlaceholder="Search challan, batch, process, mill, warehouse, party, vehicle..."
              getRowId={(row) => row.id}
              emptyTitle="No production delivery challans"
              emptyDescription={from || to ? "No fabric sent on in these dates." : "A delivery challan is made each time a batch's fabric leaves knitting, dyeing or compacting, or is sent from a warehouse to a process."}
            />
          ) : tab === "warehouse" ? (
            <DataTable
              data={warehouseRows}
              columns={warehouseColumns}
              minWidth={1120}
              searchPlaceholder="Search challan, warehouse, party, source, vehicle, item..."
              getRowId={(row) => row.id}
              emptyTitle="No warehouse challans"
              emptyDescription={from || to || kind ? "Nothing in these dates or of this type." : "A received or export challan is made automatically whenever material comes into or goes out of a warehouse."}
            />
          ) : (
            <DataTable
              data={shownReceived}
              columns={receivedColumns}
              minWidth={1120}
              searchPlaceholder="Search GRN, PO, distributor, their challan, vehicle, item..."
              getRowId={(row) => row.id}
              emptyTitle="No received challans"
              emptyDescription={from || to ? "Nothing received in these dates." : "A received challan is made each time material is received against a PO."}
            />
          )}
          {atLimit && <p className="mt-2 text-[11px] text-gray-400">Showing the latest {LIMIT[tab].toLocaleString("en-IN")} challans; pick dates to see older ones.</p>}
        </CardContent>
      </Card>

      {openDelivery && <DeliveryChallanDialog saleId={openDelivery} onClose={() => { setOpenDelivery(null); closed(); }} />}
      {openReceived && <ReceivedChallanDialog receiptId={openReceived} onClose={() => { setOpenReceived(null); closed(); }} />}
      {openProcess && <ProcessChallanDialog challanId={openProcess} onClose={() => { setOpenProcess(null); closed(); void process.reload(); }} />}
      {openWarehouse && <StockBillDialog billId={openWarehouse} canManage onClose={() => { setOpenWarehouse(null); closed(); }} onChanged={() => void warehouse.reload()} />}
    </div>
  );
}

export default function ChallansPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Challans />
    </Suspense>
  );
}
