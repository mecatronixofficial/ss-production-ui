"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ArrowRight, CircleDot, Clock3, Download, IndianRupee, Info, Plus, ReceiptIndianRupee, Timer, Truck, Users, X } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { SALE_PAYMENT_LABEL, salePaymentTone } from "@/lib/money";
import { PARTY_LABEL, SALE_STATUS_LABEL, saleTone, type Sale, type SalePartyType, type SaleStatus, type SalesSummary } from "@/lib/sales";
import { prefetchApi, useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { ATTENTION_KINDS, type AttentionKind } from "@/lib/attention";
import { cn, formatDate, kg, money, todayInput, toNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Filter = "ALL" | SaleStatus;
type Period = "ALL" | "MONTH" | "LAST_MONTH" | "90D";
type PayFilter = "ALL" | "DUE" | "OVERDUE" | "CHEQUE" | "PAID";

/** The register lists the latest this many sales (the figures above it cover every sale). */
const LIST_LIMIT = 500;
/** A dispatched bill unpaid longer than this is overdue (the server says the same in the summary). */
const OVERDUE_DAYS = 30;

/** A date or timestamp as a day on this computer's calendar (IST), not UTC's. */
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
/** How long a dispatched bill has had money due (from when it left); null when nothing is due or it hasn't left. */
const dueDays = (r: Sale) => (r.status === "DISPATCHED" && r.payment && r.payment.due > 0.005 ? daysSince(r.dispatchedAt ?? r.saleDate) : null);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Whether a sale's bill date falls in the period picked. */
function inPeriod(r: Sale, period: Period) {
  if (period === "ALL") return true;
  const day = dayOf(r.saleDate);
  const today = todayInput();
  if (period === "MONTH") return day.slice(0, 7) === today.slice(0, 7);
  if (period === "LAST_MONTH") {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return day.slice(0, 7) === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const from = new Date();
  from.setDate(from.getDate() - 89);
  return day >= dayOf(from.toISOString());
}

function inPayment(r: Sale, pay: PayFilter) {
  if (pay === "ALL") return true;
  const p = r.payment;
  if (!p) return false;
  if (pay === "DUE") return r.status === "DISPATCHED" && p.due > 0.005;
  if (pay === "OVERDUE") return (dueDays(r) ?? 0) > OVERDUE_DAYS;
  if (pay === "CHEQUE") return p.pending > 0.005;
  return p.status === "PAID" && r.status === "DISPATCHED";
}

const columns: ColumnDef<Sale>[] = [
  {
    header: "Bill",
    id: "bill",
    accessorFn: (r) => `${r.saleNo} ${r.challanNo ?? ""} ${r.saleDate}`,
    cell: ({ row }) => (
      <div>
        <Link
          href={`/sales/${row.original.id}`}
          className="customers-code"
          onClick={(e) => e.stopPropagation()}
          // Start loading the sale while the pointer is on it, so it opens at once.
          onPointerEnter={() => prefetchApi(`/sales/${row.original.id}`)}
          onFocus={() => prefetchApi(`/sales/${row.original.id}`)}
        >
          {row.original.saleNo}
        </Link>
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
      // KG on the bill: what was loaded once dispatched, what was sold before.
      const kgTotal = items.filter((i) => i.unit.toUpperCase() === "KG").reduce((sum, i) => sum + toNumber(i.dispatchedQty ?? i.quantity), 0);
      return (
        <div className="max-w-[16rem]">
          <span className="block truncate text-xs text-gray-600" title={items.map((i) => `${i.itemCode} ${i.itemName}`).join(", ")}>
            {items.slice(0, 2).map((i) => i.itemName).join(", ")}{items.length > 2 ? ` +${items.length - 2} more` : ""}
          </span>
          {kgTotal > 0 && <span className="text-[11px] text-gray-400">{kg(kgTotal)}</span>}
        </div>
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
      const days = dueDays(row.original);
      const late = days !== null && days > OVERDUE_DAYS;
      return (
        <div>
          <Badge tone={late ? "danger" : salePaymentTone(p.status)}>{late ? "Overdue" : SALE_PAYMENT_LABEL[p.status]}</Badge>
          {p.due > 0.005 && <span className="mt-0.5 block text-[11px] text-gray-500">{money(p.due)} due{p.pending > 0 ? ` · ${money(p.pending)} cheque` : ""}</span>}
          {days !== null && (
            <span className={cn("sales-age", late && "is-late")} title={`Due since ${formatDate(row.original.dispatchedAt ?? row.original.saleDate)}`}>
              <Timer size={10} aria-hidden /> {days === 0 ? "since today" : `${days} day${days === 1 ? "" : "s"}`}
            </span>
          )}
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

/** The page's shape while the sales load for the first time in this tab. */
function SalesSkeleton() {
  return (
    <div className="purchases-page" role="status" aria-label="Loading sales">
      <div className="h-16 animate-pulse rounded-2xl bg-gray-200/60" />
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200/60" />)}
      </div>
      <div className="h-[420px] animate-pulse rounded-2xl bg-gray-200/60" />
    </div>
  );
}

/** `/sales`: sales to distributors and textiles, from entry through the warehouse's dispatch, with their bills. */
export default function SalesPage() {
  const router = useRouter();
  const { user } = useAuth();
  // Both kept for the tab, so coming back (or reloading) shows them at once while they refresh.
  const { data, error, reload } = useApiQuery<Sale[]>("/sales", { persist: user?.id });
  const { data: summary } = useApiQuery<SalesSummary>("/sales/summary", { persist: user?.id });
  const [filter, setFilter] = useState<Filter>("ALL");
  const [party, setParty] = useState<"ALL" | SalePartyType>("ALL");
  const [period, setPeriod] = useState<Period>("ALL");
  const [pay, setPay] = useState<PayFilter>("ALL");
  useNewParam(() => router.push("/sales/new"));

  const rows = useMemo(() => data ?? [], [data]);
  const visible = useMemo(
    () => rows.filter((r) => (filter === "ALL" || r.status === filter) && (party === "ALL" || r.partyType === party) && inPeriod(r, period) && inPayment(r, pay)),
    [rows, filter, party, period, pay],
  );
  if (!data) return error ? <ErrorState message={error} onRetry={() => void reload()} /> : <SalesSkeleton />;

  const count = (status: SaleStatus) => rows.filter((r) => r.status === status).length;
  const filtered = filter !== "ALL" || party !== "ALL" || period !== "ALL" || pay !== "ALL";
  /** Shows one slice of the register: a status, or a payment state across all statuses. */
  const show = (next: { status?: Filter; pay?: PayFilter }) => {
    setFilter(next.status ?? "ALL");
    setPay(next.pay ?? "ALL");
    setParty("ALL");
    setPeriod("ALL");
  };
  const clear = () => show({});

  const filters: Array<{ value: Filter; label: string }> = [
    { value: "ALL", label: "All" },
    { value: "PENDING", label: "Waiting for warehouse" },
    { value: "REJECTED", label: "Sent back" },
    { value: "DISPATCHED", label: "Dispatched" },
    { value: "CANCELLED", label: "Cancelled" },
  ];

  // What needs someone, most urgent first, each with what it is about (as on the Dashboard).
  const attention: Array<{ tone: "danger" | "warning" | "info"; kind: AttentionKind; text: string; active: boolean; onClick: () => void }> = [];
  if (summary) {
    const { counts, overdue, toCollect } = summary;
    if (counts.REJECTED > 0) attention.push({ tone: "danger", kind: "sales", text: `${plural(counts.REJECTED, "sale was", "sales were")} sent back by the warehouse: correct or cancel`, active: filter === "REJECTED", onClick: () => show({ status: "REJECTED" }) });
    if (overdue.count > 0) attention.push({ tone: "danger", kind: "money", text: `${plural(overdue.count, "bill")} unpaid over ${overdue.days} days · ${money(overdue.amount)} due`, active: pay === "OVERDUE", onClick: () => show({ pay: "OVERDUE" }) });
    if (counts.PENDING > 0) attention.push({ tone: "warning", kind: "warehouse", text: `${plural(counts.PENDING, "sale")} waiting for the warehouse to verify and dispatch`, active: filter === "PENDING", onClick: () => show({ status: "PENDING" }) });
    if (toCollect.cheques > 0.005) attention.push({ tone: "info", kind: "money", text: `${money(toCollect.cheques)} on bills is in cheques not cleared yet`, active: pay === "CHEQUE", onClick: () => show({ pay: "CHEQUE" }) });
  }

  const exportSales = () =>
    downloadCsv(
      `sales-${todayInput()}.csv`,
      ["Bill no", "Bill date", "Party type", "Party", "GSTIN", "Warehouse", "Vehicle", "Driver", "Items", "Taxable", "GST %", "GST", "Total", "Status", "Dispatched", "Delivery challan", "Received", "Cheques to clear", "Due", "Days due", "Payment"],
      visible.map((r) => [
        r.saleNo,
        dayOf(r.saleDate),
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
        r.dispatchedAt ? dayOf(r.dispatchedAt) : "",
        r.challanNo,
        r.payment?.received.toFixed(2),
        r.payment?.pending.toFixed(2),
        r.payment?.due.toFixed(2),
        dueDays(r) ?? "",
        r.payment ? SALE_PAYMENT_LABEL[r.payment.status] : "",
      ]),
    );

  const s = summary;
  const mixTotal = s ? s.billedMonth.distributor + s.billedMonth.textile : 0;
  const topDueMax = s?.topDue[0]?.due ?? 0;

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

      {/* Figures over every sale, from the server (the register below lists the latest 500). */}
      <div className="purchases-stats grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        <button type="button" onClick={() => show({ status: "PENDING" })} className={cn("purchases-stat-tile purchases-stat-tile--partial text-left", filter === "PENDING" && "is-active")}>
          <div className="purchases-stat-icon"><Clock3 size={15} /></div>
          <div><p className="purchases-stat-label">Waiting for warehouse</p><p className="purchases-stat-value">{s ? s.counts.PENDING : "—"}</p><p className="purchases-stat-caption">To verify and dispatch</p></div>
        </button>
        <button type="button" onClick={() => show({ status: "REJECTED" })} className={cn("purchases-stat-tile purchases-stat-tile--partial text-left", !!s?.counts.REJECTED && "is-alert", filter === "REJECTED" && "is-active")}>
          <div className="purchases-stat-icon"><AlertTriangle size={15} /></div>
          <div><p className="purchases-stat-label">Sent back</p><p className="purchases-stat-value">{s ? s.counts.REJECTED : "—"}</p><p className="purchases-stat-caption">Correct or cancel</p></div>
        </button>
        <button type="button" onClick={() => { show({ status: "DISPATCHED" }); setPeriod("MONTH"); }} className={cn("purchases-stat-tile purchases-stat-tile--received text-left", filter === "DISPATCHED" && period === "MONTH" && "is-active")}>
          <div className="purchases-stat-icon"><Truck size={15} /></div>
          <div>
            <p className="purchases-stat-label">Billed this month</p>
            <p className="purchases-stat-value">{s ? money(s.billedMonth.amount) : "—"}</p>
            <p className="purchases-stat-caption">{s ? `${plural(s.billedMonth.count, "dispatched bill")}${s.billedMonth.kg > 0 ? ` · ${kg(s.billedMonth.kg)}` : ""} · with GST` : "Dispatched bills by bill date"}</p>
          </div>
        </button>
        <button type="button" onClick={() => show({ pay: "DUE" })} className={cn("purchases-stat-tile purchases-stat-tile--value text-left", pay === "DUE" && "is-active")}>
          <div className="purchases-stat-icon"><IndianRupee size={15} /></div>
          <div>
            <p className="purchases-stat-label">To collect on bills</p>
            <p className="purchases-stat-value">{s ? money(s.toCollect.amount) : "—"}</p>
            <p className="purchases-stat-caption">{s ? `${s.toCollect.bills} of ${s.counts.DISPATCHED} bills · ${money(s.billedTotal)} billed` : ""}</p>
          </div>
        </button>
        <button type="button" onClick={() => show({ pay: "OVERDUE" })} className={cn("purchases-stat-tile purchases-stat-tile--partial text-left", !!s?.overdue.count && "is-alert", pay === "OVERDUE" && "is-active")}>
          <div className="purchases-stat-icon"><Timer size={15} /></div>
          <div>
            <p className="purchases-stat-label">Unpaid over {s?.overdue.days ?? OVERDUE_DAYS} days</p>
            <p className="purchases-stat-value">{s ? money(s.overdue.amount) : "—"}</p>
            <p className="purchases-stat-caption">{s ? (s.overdue.count ? plural(s.overdue.count, "bill") : "Nothing overdue") : ""}</p>
          </div>
        </button>
      </div>

      {attention.length > 0 && (
        <section className="dashboard-attention" aria-label="Needs attention">
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
                    <ArrowRight size={14} className="shrink-0 opacity-60" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {s && (s.topDue.length > 0 || s.billedMonth.count > 0) && (
        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="purchases-card">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <div className="purchases-card-heading">
                <span className="purchases-step-badge purchases-step-badge--3"><Users size={14} /></span>
                <div><h3 className="font-bold">Who owes the most</h3><p className="text-xs text-gray-500">Due on dispatched bills, by party.</p></div>
              </div>
              <Link href="/money?tab=parties" className="text-xs font-bold text-[#266956] hover:underline">Party balances <ArrowRight className="ml-0.5 inline" size={13} /></Link>
            </CardHeader>
            <CardContent>
              {s.topDue.length === 0 ? (
                <p className="text-sm text-gray-500">Every dispatched bill is paid.</p>
              ) : (
                <ul className="space-y-2">
                  {s.topDue.map((p) => {
                    const late = p.oldestDays > s.overdue.days;
                    return (
                      <li key={`${p.type}-${p.name}`} className="sales-owe">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0">
                            <b className="block truncate text-gray-800">{p.name}</b>
                            <span className="text-[11px] text-gray-400">{PARTY_LABEL[p.type]} · {plural(p.bills, "bill")} · oldest <span className={cn(late && "font-bold text-rose-600")}>{p.oldestDays} days</span></span>
                          </span>
                          <b className={cn("shrink-0 tabular-nums", late ? "text-rose-700" : "text-gray-800")}>{money(p.due)}</b>
                        </div>
                        <span className={cn("sales-owe__bar", late && "is-late")}><span style={{ width: `${topDueMax ? (p.due / topDueMax) * 100 : 0}%` }} /></span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="purchases-card">
            <CardHeader>
              <div className="purchases-card-heading">
                <span className="purchases-step-badge purchases-step-badge--3"><ReceiptIndianRupee size={14} /></span>
                <div><h3 className="font-bold">Billed this month</h3><p className="text-xs text-gray-500">Dispatched bills by bill date, with GST (as on Finance).</p></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <b className="text-2xl font-bold tracking-tight text-gray-800">{money(s.billedMonth.amount)}</b>
                <span className="text-xs text-gray-500">{plural(s.billedMonth.count, "bill")}{s.billedMonth.kg > 0 ? ` · ${kg(s.billedMonth.kg)}` : ""}</span>
              </div>
              <div className="dashboard-segments" role="img" aria-label="Billed this month by party type">
                {mixTotal > 0 ? (
                  <>
                    {s.billedMonth.distributor > 0 && <span style={{ width: `${(s.billedMonth.distributor / mixTotal) * 100}%`, background: "#1b3c55" }} />}
                    {s.billedMonth.textile > 0 && <span style={{ width: `${(s.billedMonth.textile / mixTotal) * 100}%`, background: "#d3a64c" }} />}
                  </>
                ) : <span className="is-empty" />}
              </div>
              <ul className="grid grid-cols-2 gap-2 text-xs">
                {([["Distributors", s.billedMonth.distributor, "#1b3c55", "DISTRIBUTOR"], ["Textiles", s.billedMonth.textile, "#d3a64c", "TEXTILE"]] as const).map(([label, value, color, type]) => (
                  <li key={label}>
                    <button type="button" className="sales-mix" onClick={() => { show({ status: "DISPATCHED" }); setPeriod("MONTH"); setParty(type); }}>
                      <span className="flex items-center gap-1.5 text-gray-500"><i className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
                      <b className="text-gray-800">{money(value)}</b>
                      <span className="text-[10px] text-gray-400">{mixTotal ? `${Math.round((value / mixTotal) * 100)}%` : "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="purchases-card purchases-card--register purchases-register-card">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="purchases-card-heading">
            <span className="purchases-step-badge purchases-step-badge--3"><ReceiptIndianRupee size={14} /></span>
            <div><h3 className="font-bold">Sales register</h3><p className="text-xs text-gray-500">Open a sale for its bill, vehicle and the warehouse&apos;s verification.</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="erp-input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Bill date">
              <option value="ALL">All dates</option>
              <option value="MONTH">This month</option>
              <option value="LAST_MONTH">Last month</option>
              <option value="90D">Last 90 days</option>
            </select>
            <select className="erp-input w-auto" value={party} onChange={(e) => setParty(e.target.value as typeof party)} aria-label="Sold to">
              <option value="ALL">Distributors & textiles</option>
              <option value="DISTRIBUTOR">Distributors</option>
              <option value="TEXTILE">Textiles</option>
            </select>
            <select className="erp-input w-auto" value={pay} onChange={(e) => setPay(e.target.value as PayFilter)} aria-label="Payment">
              <option value="ALL">Any payment</option>
              <option value="DUE">Money due</option>
              <option value="OVERDUE">Overdue (over {OVERDUE_DAYS} days)</option>
              <option value="CHEQUE">Cheque to clear</option>
              <option value="PAID">Paid</option>
            </select>
            {filtered && <Button size="sm" variant="ghost" onClick={clear}><X size={14} /> Clear</Button>}
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
          {visible.length > 0 && (
            <p className="mb-2 text-xs text-gray-500">
              {plural(visible.length, "sale")} · {money(visible.reduce((sum, r) => sum + (r.status === "CANCELLED" ? 0 : toNumber(r.totalAmount)), 0))} billed
              {visible.some((r) => (r.payment?.due ?? 0) > 0.005 && r.status === "DISPATCHED") && ` · ${money(visible.reduce((sum, r) => sum + (r.status === "DISPATCHED" ? r.payment?.due ?? 0 : 0), 0))} due`}
            </p>
          )}
          <DataTable
            data={visible}
            columns={columns}
            minWidth={1080}
            getRowId={(row) => row.id}
            searchPlaceholder="Search bill, party, vehicle, item..."
            emptyTitle={rows.length ? "No sales with these filters" : "No sales yet"}
            emptyDescription={rows.length ? "Try another filter, or clear them." : "Use “New sale” to enter the first one."}
          />
          {rows.length >= LIST_LIMIT && (
            <p className="mt-2 text-[11px] text-gray-400">The register lists the latest {LIST_LIMIT} sales; the figures at the top cover every sale. Reports has the full history.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
