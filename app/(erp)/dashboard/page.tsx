"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  BellRing,
  Boxes,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Droplets,
  Factory,
  FileCheck2,
  Gauge,
  Inbox,
  Info,
  Landmark,
  Layers,
  PackageCheck,
  ReceiptIndianRupee,
  RefreshCw,
  Scale,
  Shrink,
  Truck,
  Wallet,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { notificationLink } from "@/lib/notification-links";
import { NOTIFICATIONS_ARRIVED_EVENT, refreshUnreadCount } from "@/lib/unread-store";
import { cn, formatDate, humanize, kg, money, todayInput } from "@/lib/utils";
import type { DashboardData } from "@/lib/types";
import { SALE_PAYMENT_LABEL, salePaymentTone } from "@/lib/money";
import { SALE_STATUS_LABEL, saleTone } from "@/lib/sales";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { useAuth } from "@/components/auth-provider";
import { machineHref, runHref, shiftText } from "../masters/machines/types";

// recharts is the heaviest dependency in the app; load it after the dashboard shell renders.
const ProductionChart = dynamic(() => import("@/components/production-chart").then((m) => m.ProductionChart), {
  ssr: false,
  loading: () => <div className="h-[290px] w-full animate-pulse rounded-2xl bg-gray-50" />,
});

const TREND_RANGES = [7, 30, 90] as const;
type TrendRange = (typeof TREND_RANGES)[number];

const TREND_SERIES = [
  { key: "yarnInKg", label: "Yarn received", color: "#236b59" },
  { key: "knittedKg", label: "Fabric knitted", color: "#d3a64c" },
  { key: "deliveredKg", label: "Delivered to parties", color: "#4f7cac" },
  { key: "soldKg", label: "Sold (dispatched)", color: "#8a5cb8" },
] as const;

/** Each batch stage as the Production page names it. */
const STAGES: Record<DashboardData["production"]["stages"][number]["key"], { label: string; note: string; icon: typeof Factory; tone: string }> = {
  PURCHASED: { label: "Not started", note: "Yarn allocated, knitting to start", icon: Boxes, tone: "bg-slate-100 text-slate-700" },
  KNITTING: { label: "Knitting", note: "On machines or at a knitting mill", icon: Layers, tone: "bg-amber-100 text-amber-700" },
  DYEING: { label: "Dyeing", note: "At the dyeing mill", icon: Droplets, tone: "bg-blue-100 text-blue-700" },
  COMPACTING: { label: "Compacting", note: "At the compacting mill", icon: Shrink, tone: "bg-teal-100 text-teal-700" },
  AT_OFFICE: { label: "Ready to deliver", note: "Finished fabric at the office", icon: PackageCheck, tone: "bg-emerald-100 text-emerald-700" },
};
const stageLabel = (status: string) => STAGES[status as keyof typeof STAGES]?.label ?? humanize(status);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const signedMoney = (value: number) => `${value < -0.005 ? "−" : ""}${money(Math.abs(value))}`;

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

function StatTile({ title, value, caption, icon: Icon, tone = "green", href }: { title: string; value: string; caption?: string; icon: typeof Factory; tone?: "green" | "gold" | "blue" | "rose" | "slate"; href?: string }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-700",
    gold: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    rose: "bg-rose-100 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  };
  const body = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-2 truncate text-xl font-bold tracking-[-.03em] text-gray-800">{value}</p>
        {caption && <p className="mt-1 truncate text-[11px] text-gray-400">{caption}</p>}
      </div>
      <div className={cn("dashboard-stat-icon h-10 w-10 shrink-0", tones[tone])}><Icon size={17} /></div>
    </div>
  );
  return href ? <Link href={href} className="dashboard-stat-tile block p-4 transition hover:border-[#c9d8d1]">{body}</Link> : <div className="dashboard-stat-tile p-4">{body}</div>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#a77a24]">{eyebrow}</p>
        <h3 className="mt-1 text-lg font-bold tracking-tight text-[#183b32]">{title}</h3>
      </div>
      {action}
    </div>
  );
}

const MoreLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="text-xs font-bold text-[#266956] hover:underline">
    {children} <ArrowRight className="ml-0.5 inline" size={13} />
  </Link>
);

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [trendDays, setTrendDays] = useState<TrendRange>(7);
  const { user } = useAuth();
  /** Only the newest request may update the page, so switching ranges quickly never shows an older answer. */
  const latest = useRef(0);

  const load = useCallback(async (manual = false) => {
    const request = ++latest.current;
    if (manual) setRefreshing(true);
    setError("");
    try {
      const response = await api<{ data: DashboardData }>(`/dashboard?days=${trendDays}`, { silent: !manual });
      if (request === latest.current) setData(response.data);
    } catch (requestError) {
      if (request === latest.current) setError(requestError instanceof Error ? requestError.message : "Dashboard could not be loaded");
    } finally {
      if (request === latest.current) setRefreshing(false);
    }
  }, [trendDays]);

  useEffect(() => {
    void load();
    // Keep the command centre fresh while it's open and visible.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 120_000);
    // A process completed somewhere: show it here straight away.
    const onArrived = () => void load();
    window.addEventListener(NOTIFICATIONS_ARRIVED_EVENT, onArrived);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_ARRIVED_EVENT, onArrived);
    };
  }, [load]);

  /** Opening an update marks it read, here and on the bell. */
  const markUpdateRead = (id: string) => {
    setData((current) => (current ? { ...current, processUpdates: current.processUpdates.map((u) => (u.id === id ? { ...u, isRead: true } : u)) } : current));
    void api(`/notifications/${id}/read`, { method: "PATCH", silent: true })
      .then(() => refreshUnreadCount())
      .catch(() => undefined);
  };

  if (!data && !error) return <Loading />;
  if (!data) {
    return (
      <Card className="mx-auto mt-16 max-w-lg p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle size={22} />
        </div>
        <h2 className="mt-4 text-lg font-bold">Dashboard unavailable</h2>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
        <Button className="mt-5" onClick={() => void load(true)}>
          <RefreshCw size={15} /> Retry
        </Button>
      </Card>
    );
  }

  const d = data;
  const { production: p, machines: m, money: cash, sales } = d;
  const down = (m.byStatus.MAINTENANCE ?? 0) + (m.byStatus.BREAKDOWN ?? 0);
  const utilization = m.total ? Math.round((m.knitting / m.total) * 100) : 0;
  const trendTotals = Object.fromEntries(TREND_SERIES.map((s) => [s.key, d.trend.reduce((sum, day) => sum + day[s.key], 0)])) as Record<(typeof TREND_SERIES)[number]["key"], number>;
  const trendLoading = d.trend.length !== trendDays;
  const trendEmpty = TREND_SERIES.every((s) => trendTotals[s.key] === 0);
  const inProcess = p.stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="dashboard-page mx-auto max-w-[1800px] space-y-6 pb-8">
      <section className="dashboard-hero overflow-hidden rounded-[20px] p-3.5 text-white md:p-4">
        <div className="relative z-10 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <div className="dashboard-hero__monogram"><Gauge size={19} /></div>
            <div>
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-white/55">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Mill command centre
              </div>
              <h2 className="mt-1 text-xl font-black tracking-[-.03em] md:text-2xl">
                {greeting()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
              </h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 backdrop-blur">
              <p className="text-[8px] font-bold uppercase tracking-[.14em] text-white/40">Last updated</p>
              <p className="mt-0.5 text-[11px] font-semibold text-white/85">
                {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d.generatedAt))}
              </p>
            </div>
            <Button size="sm" className="border border-white/15 bg-white/10 text-white hover:bg-white/15" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>
        <div className="dashboard-hero__meta relative z-10 mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ["Batches in production", String(inProcess), Factory, "text-amber-200"],
            ["Machines knitting", `${m.knitting} / ${m.total}`, Gauge, "text-emerald-300"],
            ["Tasks waiting for a machine", String(m.knittingTasks), ClipboardList, m.knittingTasks ? "text-amber-200" : "text-emerald-300"],
            ["Machines down", String(down), Wrench, down ? "text-rose-300" : "text-emerald-300"],
          ] as const).map(([label, value, Icon, tone]) => (
            <div key={label}>
              <div className="dashboard-hero-chip-icon"><Icon size={16} className={tone} /></div>
              <div className="min-w-0">
                <p className="truncate text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</p>
                <p className="mt-0.5 text-base font-bold">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>{error}. Showing the last loaded figures.</span>
          <button className="font-bold" onClick={() => void load(true)}>Retry</button>
        </div>
      )}

      <section className="dashboard-attention" aria-label="Needs attention">
        {d.attention.length === 0 ? (
          <p className="dashboard-attention__clear"><CheckCircle2 size={16} /> All clear: nothing overdue, stuck or waiting.</p>
        ) : (
          <ul>
            {d.attention.map((item) => {
              const Icon = item.tone === "danger" ? AlertTriangle : item.tone === "warning" ? CircleDot : Info;
              return (
                <li key={item.text}>
                  <Link href={item.href} className={cn("dashboard-attention__item", `is-${item.tone}`)}>
                    <Icon size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1">{item.text}</span>
                    <ArrowRight size={14} className="shrink-0 opacity-60" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {d.processUpdates.length > 0 && (
        <section className="dashboard-updates" aria-label="Production updates">
          <SectionTitle
            eyebrow="Notifications"
            title="Production updates"
            action={<MoreLink href="/notifications">All notifications</MoreLink>}
          />
          <ul className="dashboard-updates__list">
            {d.processUpdates.map((u) => {
              const process = u.title.startsWith("Dyeing") ? "dyeing" : u.title.startsWith("Compacting") ? "compacting" : "knitting";
              const Icon = process === "dyeing" ? Droplets : process === "compacting" ? Shrink : u.title.startsWith("Knitting run") ? Gauge : Layers;
              const link = notificationLink(u, d.isAdmin);
              const urgent = u.priority === "HIGH" || u.priority === "CRITICAL";
              return (
                <li key={u.id} className={cn("dashboard-update", `is-${process}`, !u.isRead && "is-unread", urgent && "is-urgent")}>
                  <span className="dashboard-update__icon"><Icon size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="dashboard-update__title">
                      {!u.isRead && <span className="dashboard-update__dot" aria-label="New" />}
                      {u.title}
                    </p>
                    <p className="dashboard-update__message" title={u.message}>{u.message}</p>
                    <p className="dashboard-update__time">
                      {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(u.createdAt))}
                    </p>
                  </div>
                  {link && (
                    <Link href={link.href} className="dashboard-update__open" onClick={() => markUpdateRead(u.id)} aria-label={`${link.label}: ${u.title}`}>
                      <ArrowRight size={15} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle eyebrow="Today" title="Production at a glance" />
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <StatTile title="Knitted today" value={kg(m.finishedToday.kg)} caption={`${m.finishedToday.count} run${m.finishedToday.count === 1 ? "" : "s"} finished · ${kg(m.yarnOnMachinesKg)} on machines`} icon={Layers} tone="gold" href="/masters/machines" />
          <StatTile title="Ready to deliver" value={kg(p.readyKg)} caption={`${p.stages.find((s) => s.key === "AT_OFFICE")?.count ?? 0} batches at the office`} icon={PackageCheck} href="/production" />
          <StatTile
            title="Delivered this month"
            value={kg(p.deliveredThisMonth.kg)}
            caption={`${plural(p.deliveredThisMonth.count, "delivery", "deliveries")} to parties${p.deliveredThisMonth.amount !== null ? ` · ${money(p.deliveredThisMonth.amount)} collected` : ""}`}
            icon={Truck}
            tone="blue"
            href="/production"
          />
          <StatTile
            title="Sold this month"
            value={kg(sales.thisMonth.kg)}
            caption={`${plural(sales.thisMonth.count, "bill")} dispatched${sales.waiting ? ` · ${sales.waiting} waiting` : ""}`}
            icon={ReceiptIndianRupee}
            tone="gold"
            href={d.isAdmin ? "/sales" : "/warehouses"}
          />
          <StatTile
            title="Waiting to receive"
            value={kg(d.awaitingFabric.kg)}
            caption={`${d.awaitingFabric.count} fabric deliver${d.awaitingFabric.count === 1 ? "y" : "ies"} · ${d.purchases.open} open PO${d.purchases.open === 1 ? "" : "s"}`}
            icon={Inbox}
            tone={d.purchases.overdue ? "rose" : "slate"}
            href="/warehouses"
          />
        </div>
        {cash && (
          <>
            <div className="mt-5">
              <SectionTitle eyebrow="Money" title="Where the business stands" action={<MoreLink href="/money">Money</MoreLink>} />
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                title="Sales billed this month"
                value={money(sales.thisMonth.amount ?? 0)}
                caption={`${plural(sales.thisMonth.count, "dispatched bill")} · with GST`}
                icon={ReceiptIndianRupee}
                tone="gold"
                href="/sales"
              />
              <StatTile
                title="To collect"
                value={money(cash.receivable)}
                caption={cash.partiesDue ? `${plural(cash.partiesDue, "party", "parties")} owe us${cash.advanceReceived ? ` · ${money(cash.advanceReceived)} advances` : ""}` : "Nothing due on bills"}
                icon={ArrowDownCircle}
                tone="blue"
                href="/money?tab=parties"
              />
              <StatTile
                title="To pay distributors"
                value={money(cash.payable)}
                caption={cash.distributorsOwed ? `${plural(cash.distributorsOwed, "distributor")} owed${d.purchases.toArriveValue ? ` · ${money(d.purchases.toArriveValue)} more on open POs` : ""}` : "All distributors settled"}
                icon={Truck}
                tone="slate"
                href="/money?tab=parties"
              />
              <StatTile
                title="Cash, bank & UPI"
                value={signedMoney(cash.balances.total)}
                caption={`Cash ${money(cash.balances.cash)} · bank ${money(cash.balances.bank)} · UPI ${money(cash.balances.upi)}`}
                icon={Wallet}
                tone={cash.balances.total < 0 ? "rose" : "green"}
                href="/money?tab=accounts"
              />
            </div>
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile title="Money in this month" value={money(cash.month.moneyIn)} caption={`Received ${money(cash.month.receivedTotal)} · deliveries ${money(cash.month.collected)}`} icon={ArrowDownCircle} href="/money?tab=entries" />
              <StatTile title="Money out this month" value={money(cash.month.moneyOut)} caption={`Paid ${money(cash.month.paidTotal)} · expenses ${money(cash.month.expenses)}`} icon={ArrowUpCircle} tone="rose" href="/money?tab=entries" />
              <StatTile
                title="Net this month"
                value={signedMoney(cash.month.net)}
                caption="Money in minus money out"
                icon={Landmark}
                tone={cash.month.net < 0 ? "rose" : "green"}
                href="/finance"
              />
              <StatTile
                title="Cheques to clear"
                value={money(cash.chequesIn.amount)}
                caption={
                  cash.chequesIn.count || cash.chequesOut.count
                    ? `${plural(cash.chequesIn.count, "received cheque")} · ${money(cash.chequesOut.amount)} issued`
                    : "No cheques waiting"
                }
                icon={FileCheck2}
                tone={cash.chequesIn.count ? "gold" : "slate"}
                href="/money?tab=cheques"
              />
            </div>
          </>
        )}
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,.5fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
            <SectionTitle eyebrow="Material flow" title={`Last ${trendDays} days`} />
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap gap-4 text-[11px] font-semibold text-gray-500">
                {TREND_SERIES.map((series) => (
                  <span key={series.key} className="flex items-center gap-1.5">
                    <i className="h-2 w-2 rounded-full" style={{ background: series.color }} />
                    {series.label}
                    <strong className="text-gray-800">{kg(trendTotals[series.key])}</strong>
                  </span>
                ))}
              </div>
              <div className="flex rounded-xl bg-gray-100 p-0.5 text-[11px] font-bold" role="group" aria-label="Trend range">
                {TREND_RANGES.map((range) => (
                  <button
                    key={range}
                    type="button"
                    aria-pressed={trendDays === range}
                    onClick={() => setTrendDays(range)}
                    className={cn("rounded-[10px] px-2.5 py-1 transition", trendDays === range ? "bg-white text-[#183b32] shadow-sm" : "text-gray-500 hover:text-gray-700")}
                  >
                    {range}D
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative pt-4">
            <div className={cn("transition-opacity", (trendLoading || trendEmpty) && "opacity-40")}>
              <ProductionChart data={d.trend} series={TREND_SERIES} />
            </div>
            {!trendLoading && trendEmpty && (
              <div className="absolute inset-0 grid place-items-center p-6">
                <div className="max-w-sm rounded-2xl border border-gray-100 bg-white/95 px-5 py-4 text-center shadow-sm">
                  <p className="text-sm font-bold text-gray-800">No yarn received, fabric knitted, delivered or sold in the last {trendDays} days</p>
                  <p className="mt-1 text-xs text-gray-500">{p.lastDeliveryAt ? `Last delivery was on ${formatDate(p.lastDeliveryAt)}.` : "Nothing has been delivered yet."}</p>
                  {trendDays !== 90 && (
                    <button type="button" className="mt-3 text-xs font-bold text-[#266956] hover:underline" onClick={() => setTrendDays(trendDays === 7 ? 30 : 90)}>
                      Show last {trendDays === 7 ? 30 : 90} days
                    </button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Batches" title="Production pipeline" action={<MoreLink href="/production">Production</MoreLink>} />
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center justify-between rounded-2xl bg-[#1b3c55] p-4 text-white">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.18em] text-white/45">Batches in production</p>
                <div className="mt-1 flex items-end gap-2">
                  <strong className="text-3xl font-bold tracking-[-.05em]">{inProcess}</strong>
                  <span className="pb-1 text-[11px] text-white/45">{p.deliveredThisMonth.count} delivered this month</span>
                </div>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/10 text-[#f0ce79]"><Factory size={20} /></div>
            </div>
            {p.stages.map((stage, index) => {
              const meta = STAGES[stage.key];
              const StageIcon = meta.icon;
              return (
                <div key={stage.key} className="flex gap-3">
                  <div className="flex w-10 shrink-0 flex-col items-center">
                    <div className={cn("dashboard-stat-icon relative z-10 h-10 w-10 ring-4 ring-white", meta.tone)}><StageIcon size={17} /></div>
                    {index < p.stages.length - 1 && <div className="-my-1 min-h-3 flex-1 border-l-2 border-dashed border-gray-200" />}
                  </div>
                  <div className="mb-2.5 flex min-w-0 flex-1 items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-800">{meta.label}</p>
                      <p className="truncate text-[10px] text-gray-500">{meta.note}</p>
                    </div>
                    <div className="ml-3 grid h-10 min-w-10 place-items-center rounded-xl bg-white px-2 text-lg font-bold text-[#1b3c55] shadow-sm">{stage.count}</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,.5fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Shop floor" title="Batches in progress" action={<MoreLink href="/production">All batches</MoreLink>} />
          </CardHeader>
          <CardContent className="p-0">
            {p.batches.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 size={22} /></div>
                <p className="mt-3 font-bold">No batches in production</p>
                <p className="mt-1 text-sm text-gray-500">Start a batch on the Production page from yarn in stock.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-[#f7f9f8] text-left text-[10px] font-bold uppercase tracking-[.1em] text-gray-400">
                    <tr>
                      <th className="px-5 py-3">Batch</th>
                      <th className="px-5 py-3">Stage / where</th>
                      <th className="px-5 py-3">Weight</th>
                      <th className="px-5 py-3">In this stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {p.batches.map((b) => {
                      const late = !!b.dueDate && b.dueDate.slice(0, 10) < todayInput();
                      return (
                        <tr key={b.id} className="transition hover:bg-[#fafcfb]">
                          <td className="px-5 py-3.5">
                            <Link href={`/production?batch=${encodeURIComponent(b.flowNo)}`} className="customers-code">{b.flowNo}</Link>
                            <p className="mt-1 text-[11px] text-gray-500">{b.fabric}{b.color ? ` · ${b.color}` : ""}</p>
                          </td>
                          <td className="px-5 py-3.5">
                            <Badge tone={b.status === "AT_OFFICE" ? "success" : b.status === "PURCHASED" ? "default" : "info"}>{stageLabel(b.status)}</Badge>
                            <p className="mt-1 max-w-[16rem] truncate text-[11px] text-gray-500" title={b.place}>{b.place}</p>
                          </td>
                          <td className="px-5 py-3.5">
                            <p className="font-semibold text-gray-700">{kg(b.currentKg)}</p>
                            <p className="mt-0.5 text-[11px] text-gray-400">from {kg(b.startedKg)}{b.lossPct > 0.05 ? ` · ${b.lossPct.toFixed(1)}% loss` : ""}</p>
                          </td>
                          <td className="px-5 py-3.5">
                            <p className={cn("font-semibold", b.daysInStage > 10 ? "text-rose-600" : "text-gray-700")}>{b.daysInStage === 0 ? "Today" : `${b.daysInStage} day${b.daysInStage === 1 ? "" : "s"}`}</p>
                            {b.dueDate && <p className={cn("mt-0.5 text-[11px]", late ? "font-semibold text-rose-600" : "text-gray-400")}>Knitting due {formatDate(b.dueDate)}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Knitting" title="Machines" action={<MoreLink href="/masters/machines">Machines</MoreLink>} />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-5 rounded-2xl bg-[#1b3c55] p-4 text-white">
              <div className="dashboard-ring h-20 w-20 shrink-0" style={{ background: `conic-gradient(#d3a64c ${utilization * 3.6}deg, rgba(255,255,255,.14) 0deg)` }}>
                <span className="text-xl font-bold">{utilization}%</span>
              </div>
              <div>
                <p className="text-xs text-white/50">Machines knitting</p>
                <p className="mt-1 text-xl font-bold">{m.knitting} of {m.total}</p>
                <p className="mt-1 text-[11px] text-white/45">{kg(m.yarnOnMachinesKg)} of yarn loaded</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {([
                ["Idle", m.total - m.knitting - down, "text-gray-700"],
                ["Maintenance", m.byStatus.MAINTENANCE ?? 0, "text-amber-700"],
                ["Breakdown", m.byStatus.BREAKDOWN ?? 0, "text-rose-700"],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className="rounded-xl bg-gray-50 px-2 py-2.5">
                  <p className={cn("text-lg font-bold", tone)}>{Math.max(0, value)}</p>
                  <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                </div>
              ))}
            </div>
            {m.running.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {m.running.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 text-xs">
                    <span className="min-w-0">
                      <Link href={machineHref(r.machineId)} className="font-bold text-[#1b3c55] hover:underline">{r.machine}</Link>
                      <Link href={runHref(r.runNo)} className="ml-2 font-mono text-gray-600 hover:underline">{r.runNo}</Link>
                      <span className="block text-[11px] text-gray-400">Since {shiftText(r.startedAt, r.startShift)}</span>
                    </span>
                    <b className="shrink-0">{kg(r.yarnKg)}</b>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className={cn("grid gap-5 lg:grid-cols-2", d.isAdmin ? "2xl:grid-cols-4" : "2xl:grid-cols-3")}>
        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Warehouses" title="Stock on hand" action={<MoreLink href="/warehouses">Warehouses</MoreLink>} />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2.5">
            {([
              ["Yarn", d.stockKg.YARN, Boxes, "bg-emerald-50 text-emerald-700", "YARN"],
              ["Grey fabric", d.stockKg.GREY_FABRIC, Layers, "bg-slate-100 text-slate-700", "GREY_FABRIC"],
              ["Dyed fabric", d.stockKg.DYED_FABRIC, Droplets, "bg-blue-50 text-blue-700", "DYED_FABRIC"],
              ["Finished fabric", d.stockKg.FINISHED_FABRIC, PackageCheck, "bg-amber-50 text-amber-700", "FINISHED_FABRIC"],
            ] as const).map(([label, value, Icon, tone, category]) => (
              <Link key={label} href={`/warehouses?category=${category}`} className="dashboard-stat-tile flex items-center gap-3 p-3 transition hover:border-[#c9d8d1]">
                <div className={cn("dashboard-stat-icon h-9 w-9 shrink-0", tone)}><Icon size={16} /></div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                  <p className={cn("mt-0.5 truncate text-base font-bold", value < -0.0005 ? "text-rose-600" : "text-gray-800")}>{kg(value)}</p>
                </div>
              </Link>
            ))}
            <p className="col-span-2 text-[11px] text-gray-400"><Scale size={11} className="mr-1 inline" />KG only; cones, bags and other units are on the Warehouses page.</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Purchases" title="Material on the way" action={d.isAdmin ? <MoreLink href="/purchases">Purchases</MoreLink> : undefined} />
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-gray-50 px-2 py-2.5">
                <p className="text-lg font-bold text-gray-800">{d.purchases.open}</p>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">Open POs</p>
              </div>
              <div className={cn("rounded-xl px-2 py-2.5", d.purchases.overdue ? "bg-rose-50" : "bg-gray-50")}>
                <p className={cn("text-lg font-bold", d.purchases.overdue ? "text-rose-700" : "text-gray-800")}>{d.purchases.overdue}</p>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">Past expected date</p>
              </div>
            </div>
            {d.purchases.next.length === 0 ? (
              <p className="text-sm text-gray-500">No purchase orders waiting.</p>
            ) : (
              <ul className="space-y-1.5">
                {d.purchases.next.map((po) => {
                  const late = !!po.expectedDate && po.expectedDate.slice(0, 10) < todayInput();
                  return (
                    <li key={po.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 text-xs">
                      <span className="min-w-0">
                        {d.isAdmin ? <Link href={`/purchases/${po.id}`} className="font-bold text-[#1b3c55] hover:underline">{po.poNo}</Link> : <b>{po.poNo}</b>}
                        <span className="block truncate text-[11px] text-gray-500">{po.supplier}</span>
                      </span>
                      <span className={cn("shrink-0 text-[11px]", late ? "font-semibold text-rose-600" : "text-gray-500")}>{po.expectedDate ? `${late ? "Was due" : "Due"} ${formatDate(po.expectedDate)}` : "No date"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {d.isAdmin && (
          <Card className="overflow-hidden">
            <CardHeader>
              <SectionTitle eyebrow="Sales" title="Latest bills" action={<MoreLink href="/sales">Sales</MoreLink>} />
            </CardHeader>
            <CardContent className="space-y-1.5">
              {sales.recent.length === 0 ? (
                <p className="text-sm text-gray-500">No sales yet.</p>
              ) : (
                sales.recent.map((sale) => (
                  <Link key={sale.id} href={`/sales/${sale.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 text-xs transition hover:border-[#c9d8d1] hover:bg-[#fafcfb]">
                    <span className="min-w-0">
                      <b className="text-[#1b3c55]">{sale.saleNo}</b>
                      <span className="block truncate text-[11px] text-gray-500">{sale.party} · {formatDate(sale.saleDate)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <b>{money(sale.total)}</b>
                      {sale.status === "DISPATCHED" ? (
                        <Badge tone={salePaymentTone(sale.payment)}>{SALE_PAYMENT_LABEL[sale.payment]}</Badge>
                      ) : (
                        <Badge tone={saleTone(sale.status)}>{SALE_STATUS_LABEL[sale.status]}</Badge>
                      )}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        )}

        <Card className={cn("overflow-hidden", !d.isAdmin && "lg:col-span-2 2xl:col-span-1")}>
          <CardHeader>
            <SectionTitle
              eyebrow="Notifications"
              title="Latest alerts"
              action={
                <Link href="/notifications" className="relative text-gray-500" aria-label={`${d.unreadNotifications} unread notifications`}>
                  <BellRing size={17} />
                  {d.unreadNotifications > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />}
                </Link>
              }
            />
          </CardHeader>
          <CardContent className="space-y-2.5">
            {d.alerts.length === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto text-emerald-600" size={26} />
                <p className="mt-2 text-sm font-bold">No unread alerts</p>
              </div>
            ) : (
              d.alerts.map((alert) => {
                const urgent = alert.priority === "CRITICAL" || alert.priority === "HIGH";
                return (
                  <div key={alert.id} className="flex gap-3 rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
                    <div className={cn("dashboard-stat-icon mt-0.5 h-8 w-8 shrink-0", urgent ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}>
                      {urgent ? <AlertTriangle size={15} /> : <CircleDot size={15} />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-gray-800">{alert.title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">{alert.message}</p>
                      <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                        {alert.priority} · {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(alert.createdAt))}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            {d.unreadNotifications > d.alerts.length && <MoreLink href="/notifications">{d.unreadNotifications - d.alerts.length} more unread</MoreLink>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
