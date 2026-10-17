"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Clock3, Download, IndianRupee, Plus, ReceiptIndianRupee, Truck } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { SALE_PAYMENT_LABEL, salePaymentTone } from "@/lib/money";
import { PARTY_LABEL, SALE_STATUS_LABEL, saleTone, type Sale, type SalePartyType, type SaleStatus } from "@/lib/sales";
import { useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { cn, formatDate, money, todayInput, toNumber } from "@/lib/utils";
import { DataTable } from "@/components/data-table";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Filter = "ALL" | SaleStatus;

const columns: ColumnDef<Sale>[] = [
  {
    header: "Bill",
    id: "bill",
    accessorFn: (r) => `${r.saleNo} ${r.challanNo ?? ""} ${r.saleDate}`,
    cell: ({ row }) => (
      <div>
        <Link href={`/sales/${row.original.id}`} className="customers-code" onClick={(e) => e.stopPropagation()}>{row.original.saleNo}</Link>
        <span className="mt-0.5 block text-xs text-gray-400">{formatDate(row.original.saleDate)}</span>
      </div>
    ),
  },
  {
    header: "Sold to",
    id: "party",
    accessorFn: (r) => `${r.partyName} ${r.partyGst ?? ""} ${PARTY_LABEL[r.partyType]}`,
    cell: ({ row }) => (
      <div className="max-w-[16rem]">
        <p className="truncate font-medium">{row.original.partyName}</p>
        <p className="text-xs text-gray-400">{PARTY_LABEL[row.original.partyType]}{row.original.supplier ? ` · ${row.original.supplier.code}` : row.original.textile ? ` · ${row.original.textile.code}` : ""}</p>
      </div>
    ),
  },
  {
    header: "From / vehicle",
    id: "from",
    accessorFn: (r) => `${r.warehouse.code} ${r.vehicleNo ?? ""} ${r.driverName ?? ""}`,
    cell: ({ row }) => (
      <div>
        <p className="font-semibold">{row.original.warehouse.code}</p>
        <p className="text-xs text-gray-400">{row.original.vehicleNo || "No vehicle yet"}</p>
      </div>
    ),
  },
  {
    header: "Items",
    id: "items",
    enableSorting: false,
    accessorFn: (r) => r.items.map((i) => `${i.itemCode} ${i.itemName}`).join(" "),
    cell: ({ row }) => {
      const items = row.original.items;
      return (
        <span className="block max-w-[16rem] truncate text-xs text-gray-600" title={items.map((i) => `${i.itemCode} ${i.itemName}`).join(", ")}>
          {items.slice(0, 2).map((i) => i.itemName).join(", ")}{items.length > 2 ? ` +${items.length - 2} more` : ""}
        </span>
      );
    },
  },
  { header: "Total", id: "total", meta: { align: "right" }, accessorFn: (r) => toNumber(r.totalAmount), cell: ({ getValue }) => <b>{money(getValue<number>())}</b> },
  {
    header: "Payment",
    id: "payment",
    accessorFn: (r) => (r.payment ? `${SALE_PAYMENT_LABEL[r.payment.status]} ${r.payment.due}` : ""),
    cell: ({ row }) => {
      const p = row.original.payment;
      if (!p) return <span className="text-gray-300">—</span>;
      return (
        <div>
          <Badge tone={salePaymentTone(p.status)}>{SALE_PAYMENT_LABEL[p.status]}</Badge>
          {p.due > 0.005 && <span className="mt-0.5 block text-[11px] text-gray-500">{money(p.due)} due{p.pending > 0 ? ` · ${money(p.pending)} cheque` : ""}</span>}
        </div>
      );
    },
  },
  {
    header: "Status",
    id: "status",
    accessorFn: (r) => SALE_STATUS_LABEL[r.status],
    cell: ({ row }) => (
      <div>
        <Badge tone={saleTone(row.original.status)}>{SALE_STATUS_LABEL[row.original.status]}</Badge>
        {row.original.status === "REJECTED" && row.original.rejectReason && <span className="mt-0.5 block max-w-[12rem] truncate text-[11px] text-red-600" title={row.original.rejectReason}>{row.original.rejectReason}</span>}
        {row.original.dispatchedAt && (
          <span className="mt-0.5 block text-[11px] text-gray-400">
            {row.original.challanNo ? <b className="font-mono text-gray-600">{row.original.challanNo}</b> : null}
            {row.original.challanNo ? " · " : ""}
            {formatDate(row.original.dispatchedAt)}
          </span>
        )}
      </div>
    ),
  },
];

/** `/sales`: sales to distributors and textiles, from entry through the warehouse's dispatch, with their bills. */
export default function SalesPage() {
  const router = useRouter();
  const { data, error, reload } = useApiQuery<Sale[]>("/sales");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [party, setParty] = useState<"ALL" | SalePartyType>("ALL");
  useNewParam(() => router.push("/sales/new"));

  const rows = useMemo(() => data ?? [], [data]);
  if (!data) return error ? <ErrorState message={error} onRetry={() => void reload()} /> : <Loading />;

  const month = todayInput().slice(0, 7);
  const live = rows.filter((r) => r.status !== "CANCELLED");
  const dispatched = live.filter((r) => r.status === "DISPATCHED");
  const thisMonth = live.filter((r) => r.status === "DISPATCHED" && (r.dispatchedAt ?? r.saleDate).slice(0, 7) === month);
  const count = (status: SaleStatus) => rows.filter((r) => r.status === status).length;
  const visible = rows.filter((r) => (filter === "ALL" || r.status === filter) && (party === "ALL" || r.partyType === party));
  const filters: Array<{ value: Filter; label: string }> = [
    { value: "ALL", label: "All" },
    { value: "PENDING", label: "Waiting for warehouse" },
    { value: "REJECTED", label: "Sent back" },
    { value: "DISPATCHED", label: "Dispatched" },
    { value: "CANCELLED", label: "Cancelled" },
  ];

  const exportSales = () =>
    downloadCsv(
      `sales-${todayInput()}.csv`,
      ["Bill no", "Bill date", "Party type", "Party", "GSTIN", "Warehouse", "Vehicle", "Driver", "Items", "Taxable", "GST %", "GST", "Total", "Status", "Dispatched", "Delivery challan", "Received", "Cheques to clear", "Due", "Payment"],
      visible.map((r) => [
        r.saleNo,
        r.saleDate.slice(0, 10),
        PARTY_LABEL[r.partyType],
        r.partyName,
        r.partyGst,
        r.warehouse.code,
        r.vehicleNo,
        r.driverName,
        r.items.map((i) => `${i.itemCode} ${i.dispatchedQty ?? i.quantity} ${i.unit}`).join("; "),
        toNumber(r.subtotal).toFixed(2),
        toNumber(r.gstRate),
        toNumber(r.gstAmount).toFixed(2),
        toNumber(r.totalAmount).toFixed(2),
        SALE_STATUS_LABEL[r.status],
        r.dispatchedAt?.slice(0, 10),
        r.challanNo,
        r.payment?.received.toFixed(2),
        r.payment?.pending.toFixed(2),
        r.payment?.due.toFixed(2),
        r.payment ? SALE_PAYMENT_LABEL[r.payment.status] : "",
      ]),
    );

  return (
    <div className="purchases-page">
      <div className="purchases-page-header">
        <span className="purchases-page-icon"><ReceiptIndianRupee size={18} /></span>
        <div>
          <h2 className="text-lg font-bold md:text-xl">Sales</h2>
          <p className="text-xs text-gray-500">Sell to distributors or textiles: enter the sale and vehicle, the warehouse verifies and dispatches it, and the bill is ready to print.</p>
        </div>
        <span className="purchases-header-badge flex flex-wrap items-center gap-2">
          <Button className="purchases-action-btn" asChild><Link href="/sales/new"><Plus size={16} /> New sale</Link></Button>
        </span>
      </div>

      <div className="purchases-stats grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => setFilter("PENDING")} className={cn("purchases-stat-tile purchases-stat-tile--partial text-left", filter === "PENDING" && "is-active")}>
          <div className="purchases-stat-icon"><Clock3 size={15} /></div>
          <div><p className="purchases-stat-label">Waiting for warehouse</p><p className="purchases-stat-value">{count("PENDING")}</p><p className="purchases-stat-caption">To verify and dispatch</p></div>
        </button>
        <button type="button" onClick={() => setFilter("REJECTED")} className={cn("purchases-stat-tile purchases-stat-tile--partial text-left", count("REJECTED") > 0 && "is-alert", filter === "REJECTED" && "is-active")}>
          <div className="purchases-stat-icon"><AlertTriangle size={15} /></div>
          <div><p className="purchases-stat-label">Sent back</p><p className="purchases-stat-value">{count("REJECTED")}</p><p className="purchases-stat-caption">Correct or cancel</p></div>
        </button>
        <div className="purchases-stat-tile purchases-stat-tile--received">
          <div className="purchases-stat-icon"><Truck size={15} /></div>
          <div><p className="purchases-stat-label">Dispatched this month</p><p className="purchases-stat-value">{thisMonth.length}</p><p className="purchases-stat-caption">{money(thisMonth.reduce((sum, r) => sum + toNumber(r.totalAmount), 0))} billed</p></div>
        </div>
        <Link href="/money?tab=parties" className="purchases-stat-tile purchases-stat-tile--value">
          <div className="purchases-stat-icon"><IndianRupee size={15} /></div>
          <div>
            <p className="purchases-stat-label">To collect on bills</p>
            <p className="purchases-stat-value">{money(dispatched.reduce((sum, r) => sum + (r.payment?.due ?? 0), 0))}</p>
            <p className="purchases-stat-caption">{dispatched.filter((r) => (r.payment?.due ?? 0) > 0.005).length} of {count("DISPATCHED")} bills · {money(dispatched.reduce((sum, r) => sum + toNumber(r.totalAmount), 0))} billed</p>
          </div>
        </Link>
      </div>

      <Card className="purchases-card purchases-card--register purchases-register-card">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="purchases-card-heading">
            <span className="purchases-step-badge purchases-step-badge--3"><ReceiptIndianRupee size={14} /></span>
            <div><h3 className="font-bold">Sales register</h3><p className="text-xs text-gray-500">Open a sale for its bill, vehicle and the warehouse&apos;s verification.</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="erp-input w-auto" value={party} onChange={(e) => setParty(e.target.value as typeof party)} aria-label="Sold to">
              <option value="ALL">Distributors & textiles</option>
              <option value="DISTRIBUTOR">Distributors</option>
              <option value="TEXTILE">Textiles</option>
            </select>
            <Button size="sm" variant="outline" disabled={visible.length === 0} onClick={exportSales}><Download size={14} /> Export CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="purchases-filters mb-3" role="tablist" aria-label="Filter by status">
            {filters.map((f) => (
              <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} className={cn(filter === f.value && "is-active", f.value === "REJECTED" && count("REJECTED") > 0 && "is-alert")} onClick={() => setFilter(f.value)}>
                {f.label} <span>{f.value === "ALL" ? rows.length : count(f.value)}</span>
              </button>
            ))}
          </div>
          <DataTable
            data={visible}
            columns={columns}
            minWidth={1080}
            getRowId={(row) => row.id}
            searchPlaceholder="Search bill, party, vehicle, item..."
            emptyTitle={rows.length ? "No sales with this filter" : "No sales yet"}
            emptyDescription={rows.length ? "Try another filter." : "Use “New sale” to enter the first one."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
