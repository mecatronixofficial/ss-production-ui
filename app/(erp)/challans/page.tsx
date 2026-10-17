"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownLeft, ArrowUpRight, ClipboardCheck, Download, Eye, FileText, Truck, Warehouse as WarehouseIcon, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { qty } from "@/lib/purchases";
import { PARTY_LABEL, type SalePartyType } from "@/lib/sales";
import { useApiQuery } from "@/lib/use-api-query";
import { formatDate, formatDateTime, money, todayInput, unitQty } from "@/lib/utils";
import { toast } from "@/lib/toast-store";
import { confirmDialog } from "@/lib/confirm-store";
import { DataTable } from "@/components/data-table";
import { DeliveryChallanDialog } from "@/components/delivery-challan";
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

type Tab = "delivery" | "received" | "warehouse";

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
  const tab: Tab = tabParam === "received" || tabParam === "warehouse" ? tabParam : "delivery";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // A shared link (?open=<id>) opens that challan straight away.
  const linked = params.get("open");
  const [openDelivery, setOpenDelivery] = useState<string | null>(tab === "delivery" ? linked : null);
  const [openReceived, setOpenReceived] = useState<string | null>(tab === "received" ? linked : null);
  const [openWarehouse, setOpenWarehouse] = useState<string | null>(tab === "warehouse" ? linked : null);
  /** Closing a challan opened from a link also drops `open` from the address. */
  const closed = () => {
    if (linked) router.replace(`${pathname}${tab === "delivery" ? "" : `?tab=${tab}`}`, { scroll: false });
  };
  const [kind, setKind] = useState<"" | StockBillKind>("");
  const range = qs({ from: dayStart(from), to: dayEnd(to) });
  const delivery = useApiQuery<DeliveryRow[]>(tab === "delivery" ? `/sales/delivery-challans${range}` : null);
  const received = useApiQuery<ReceivedRow[]>(tab === "received" ? `/procurement/receipts${range}` : null);
  const warehouse = useApiQuery<{ unbilled: number; bills: WarehouseRow[] }>(
    tab === "warehouse" ? `/inventory/bills${qs({ from: dayStart(from), to: dayEnd(to), kind: kind || undefined })}` : null,
  );

  const setTab = (value: Tab) => router.replace(`${pathname}${value === "delivery" ? "" : `?tab=${value}`}`, { scroll: false });

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

  const active = tab === "delivery" ? delivery : tab === "received" ? received : warehouse;
  const period = from || to ? `${from ? formatDate(from) : "start"} to ${to ? formatDate(to) : "today"}` : "all dates";
  const warehouseRows = warehouse.data?.bills ?? [];
  const count = tab === "warehouse" ? warehouseRows.length : ((active.data as unknown[] | undefined)?.length ?? 0);
  const value = tab === "delivery" ? (delivery.data ?? []).reduce((s, r) => s + r.total, 0) : (received.data ?? []).reduce((s, r) => s + r.value, 0);
  const live = warehouseRows.filter((r) => !r.cancelledAt);

  const exportCsv = () => {
    const suffix = `${from || "start"}-to-${to || todayInput()}`;
    if (tab === "delivery") {
      downloadCsv(
        `delivery-challans-${suffix}.csv`,
        ["Delivery challan", "Dispatched", "Bill no", "Party type", "Consignee", "Warehouse", "Vehicle", "Driver", "Transporter", "LR no", "Items", "Bill value", "Dispatched by"],
        (delivery.data ?? []).map((r) => [r.challanNo, r.dispatchedAt.slice(0, 10), r.saleNo, PARTY_LABEL[r.partyType], r.partyName, r.warehouse.code, r.vehicleNo, r.driverName, r.transporter, r.lrNo, linesText(r.items), r.total.toFixed(2), r.verifiedBy]),
      );
    } else if (tab === "warehouse") {
      downloadCsv(
        `warehouse-challans-${suffix}.csv`,
        ["Challan", "Date", "Type", "Warehouse", "Party", "Source", "Vehicle", "Items", "Lines", "Quantity", "Status", "Cancel reason"],
        warehouseRows.map((r) => [r.billNo, r.createdAt.slice(0, 10), BILL_SHORT[r.kind], r.warehouse.code, r.partyName, r.source.label, r.vehicleNo, r.items.join("; "), r.lines, totalsText(r.totals), r.cancelledAt ? "Cancelled" : "Issued", r.cancelReason]),
      );
    } else {
      downloadCsv(
        `received-challans-${suffix}.csv`,
        ["Received challan", "Received", "PO no", "Distributor code", "Distributor", "Their challan no", "Vehicle", "Lot", "Warehouse", "Items", "Value", "Received by", "Remarks"],
        (received.data ?? []).map((r) => [r.receiptNo, r.receivedAt.slice(0, 10), r.purchaseOrder.poNo, r.supplier.code, r.supplier.name, r.challanNo, r.vehicleNo, r.lotNo, r.warehouse.code, linesText(r.items), r.value.toFixed(2), r.receivedBy, r.notes]),
      );
    }
  };

  return (
    <div className="purchases-page">
      <div className="purchases-page-header">
        <span className="purchases-page-icon"><FileText size={18} /></span>
        <div>
          <h2 className="text-lg font-bold md:text-xl">Challans</h2>
          <p className="text-xs text-gray-500">Office copies of every delivery, received and warehouse in / out challan, all made automatically. Open, print, download or share any of them (WhatsApp, Telegram, email, SMS, link or PDF), anytime.</p>
        </div>
      </div>

      <Card className="purchases-card purchases-card--register">
        <CardHeader className="flex flex-wrap items-end justify-between gap-3">
          <div className="challan-copy-picker !mr-0" role="group" aria-label="Challan type">
            <button type="button" aria-pressed={tab === "delivery"} onClick={() => setTab("delivery")}><Truck size={13} className="mr-1 inline" />Delivery challans</button>
            <button type="button" aria-pressed={tab === "received"} onClick={() => setTab("received")}><ClipboardCheck size={13} className="mr-1 inline" />Received challans</button>
            <button type="button" aria-pressed={tab === "warehouse"} onClick={() => setTab("warehouse")}><WarehouseIcon size={13} className="mr-1 inline" />Warehouse in / out</button>
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
          {!active.data ? (
            active.error ? <ErrorState message={active.error} onRetry={() => void active.reload()} /> : <Loading />
          ) : tab === "delivery" ? (
            <DataTable
              data={delivery.data ?? []}
              columns={deliveryColumns}
              minWidth={1120}
              searchPlaceholder="Search DC no, bill, consignee, vehicle, driver, LR, item..."
              getRowId={(row) => row.id}
              emptyTitle="No delivery challans"
              emptyDescription={from || to ? "Nothing dispatched in these dates." : "A delivery challan is made each time a warehouse dispatches a sale."}
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
              data={received.data ?? []}
              columns={receivedColumns}
              minWidth={1120}
              searchPlaceholder="Search GRN, PO, distributor, their challan, vehicle, item..."
              getRowId={(row) => row.id}
              emptyTitle="No received challans"
              emptyDescription={from || to ? "Nothing received in these dates." : "A received challan is made each time material is received against a PO."}
            />
          )}
        </CardContent>
      </Card>

      {openDelivery && <DeliveryChallanDialog saleId={openDelivery} onClose={() => { setOpenDelivery(null); closed(); }} />}
      {openReceived && <ReceivedChallanDialog receiptId={openReceived} onClose={() => { setOpenReceived(null); closed(); }} />}
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
