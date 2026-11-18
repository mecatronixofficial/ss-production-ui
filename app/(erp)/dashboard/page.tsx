"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpCircle,
  ArrowUpRight,
  BellRing,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
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
  Timer,
  Truck,
  Wallet,
  Warehouse,
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
import { useAuth } from "@/components/auth-provider";
import { readSnapshot, saveSnapshot } from "@/lib/use-api-query";
import { ATTENTION_KINDS, kindOfHref, notificationIcon, notificationKind, type AttentionKind } from "@/lib/attention";
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
type TrendKey = (typeof TREND_SERIES)[number]["key"];

type StageKey = DashboardData["production"]["stages"][number]["key"];
/** Each batch stage as the Production page names it, in production order. */
const STAGE_ORDER: StageKey[] = ["PURCHASED", "KNITTING", "DYEING", "COMPACTING", "AT_OFFICE"];
const STAGES: Record<StageKey, { label: string; note: string; icon: typeof Factory; tone: string; color: string }> = {
  PURCHASED: { label: "Not started", note: "Yarn allocated, knitting to start", icon: Boxes, tone: "bg-slate-100 text-slate-700", color: "#94a3b8" },
  KNITTING: { label: "Knitting", note: "On machines or at a knitting mill", icon: Layers, tone: "bg-amber-100 text-amber-700", color: "#d3a64c" },
  DYEING: { label: "Dyeing", note: "At the dyeing mill", icon: Droplets, tone: "bg-blue-100 text-blue-700", color: "#4f7cac" },
  COMPACTING: { label: "Compacting", note: "At the compacting mill", icon: Shrink, tone: "bg-teal-100 text-teal-700", color: "#2a9d8f" },
  AT_OFFICE: { label: "Ready to deliver", note: "Finished fabric at the office", icon: PackageCheck, tone: "bg-emerald-100 text-emerald-700", color: "#236b59" },
};
const stageLabel = (status: string) => STAGES[status as StageKey]?.label ?? humanize(status);
/** A batch sitting in one stage longer than this is pointed out (same as the backend). */
const STUCK_DAYS = 10;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const signedMoney = (value: number) => `${value < -0.005 ? "−" : ""}${money(Math.abs(value))}`;
const days = (count: number) => (count === 0 ? "Today" : plural(count, "day"));
const share = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);
const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Change against the period before: a percentage, "new" when there was nothing before, or null when both are empty. */
function change(current: number, previous: number): { text: string; up: boolean } | null {
  if (previous <= 0.0005) return current > 0.0005 ? { text: "New", up: true } : null;
  const pct = ((current - previous) / previous) * 100;
  return { text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`, up: pct >= 0 };
}

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

type Tone = "green" | "gold" | "blue" | "rose" | "slate" | "violet";
const TONES: Record<Tone, string> = {
  green: "bg-emerald-100 text-emerald-700",
  gold: "bg-amber-100 text-amber-700",
  blue: "bg-blue-100 text-blue-700",
  rose: "bg-rose-100 text-rose-700",
  slate: "bg-slate-100 text-slate-700",
  violet: "bg-violet-100 text-violet-700",
};

function StatTile({ title, value, caption, icon: Icon, tone = "green", href }: { title: string; value: string; caption?: string; icon: typeof Factory; tone?: Tone; href?: string }) {
  const body = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-2 truncate text-xl font-bold tracking-[-.03em] text-gray-800">{value}</p>
        {caption && <p className="mt-1 truncate text-[11px] text-gray-400" title={caption}>{caption}</p>}
      </div>
      <div className={cn("dashboard-stat-icon h-10 w-10 shrink-0", TONES[tone])}><Icon size={17} /></div>
    </div>
  );
  const className = cn("dashboard-stat-tile p-4", `is-${tone}`);
  return href ? <Link href={href} className={cn(className, "block")}>{body}</Link> : <div className={className}>{body}</div>;
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

const Delta = ({ value }: { value: ReturnType<typeof change> }) =>
  value ? (
    <span className={cn("dashboard-delta", value.up ? "is-up" : "is-down")}>
      {value.up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {value.text}
    </span>
  ) : (
    <span className="dashboard-delta">—</span>
  );

/** One bar split into parts, with a legend underneath. */
function SegmentBar({ parts, label }: { parts: ReadonlyArray<{ label: string; value: number; color: string; display?: string }>; label: string }) {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  return (
    <div>
      <div className="dashboard-segments" role="img" aria-label={label}>
        {total > 0 ? parts.map((p) => p.value > 0 && <span key={p.label} style={{ width: `${share(p.value, total)}%`, background: p.color }} title={`${p.label}: ${p.display ?? p.value}`} />) : <span className="is-empty" />}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        {parts.map((p) => (
          <li key={p.label} className="flex min-w-0 items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-gray-500">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.label}</span>
            </span>
            <b className="shrink-0 tabular-nums text-gray-800">{p.display ?? p.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where a batch is in the five stages, as a row of steps. */
function StageSteps({ status }: { status: string }) {
  const at = STAGE_ORDER.indexOf(status as StageKey);
  return (
    <span className="dashboard-steps" aria-label={`Stage ${at + 1} of ${STAGE_ORDER.length}`}>
      {STAGE_ORDER.map((key, index) => (
        <i key={key} className={cn(index < at && "is-done", index === at && "is-now")} style={index <= at ? { background: STAGES[status as StageKey]?.color } : undefined} title={STAGES[key].label} />
      ))}
    </span>
  );
}

/** The dashboard's shape while it loads for the first time in this tab. */
function DashboardSkeleton() {
  return (
    <div className="dashboard-page mx-auto max-w-[1800px] space-y-6 pb-8" role="status" aria-label="Loading dashboard">
      <div className="dashboard-hero h-[214px] rounded-[22px] md:h-[190px]" />
      <div className="grid gap-2 lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="h-11 animate-pulse rounded-[14px] bg-gray-200/60" />)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-gray-200/60" />)}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-[14px] bg-gray-200/60" />)}
      </div>
      <div className="h-[360px] animate-pulse rounded-2xl bg-gray-200/60" />
    </div>
  );
}

type TrendData = Pick<DashboardData, "trend" | "trendPrevious">;
/** Bump when the dashboard data changes shape, so a figure set saved by an older build is never read. */
const SNAPSHOT = "dashboard:v1";

export default function Dashboard() {
  const { user } = useAuth();
  // The last figures loaded in this tab show at once; the new ones replace them when they arrive.
  const [data, setData] = useState<DashboardData | null>(() => readSnapshot<DashboardData>(SNAPSHOT, user?.id) ?? null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [trendDays, setTrendDays] = useState<TrendRange>(7);
  /** The 30 and 90 day charts, loaded on their own when picked (the dashboard itself carries the 7 days). */
  const [trends, setTrends] = useState<Partial<Record<TrendRange, TrendData>>>({});
  const trendDaysRef = useRef(trendDays);
  trendDaysRef.current = trendDays;
  /** Only the newest request may update the page, so a slow older answer never replaces a newer one. */
  const latest = useRef(0);

  const loadTrend = useCallback(async (days: TrendRange) => {
    if (days === 7) return;
    try {
      const response = await api<{ data: TrendData }>(`/dashboard/trend?days=${days}`, { silent: true });
      setTrends((current) => ({ ...current, [days]: response.data }));
    } catch {
      // The chart keeps what it shows; the next refresh tries again.
    }
  }, []);

  const load = useCallback(async (manual = false) => {
    const request = ++latest.current;
    setRefreshing(true);
    setError("");
    if (trendDaysRef.current !== 7) void loadTrend(trendDaysRef.current);
    try {
      const response = await api<{ data: DashboardData }>("/dashboard", { silent: !manual });
      if (request === latest.current) {
        setData(response.data);
        saveSnapshot(SNAPSHOT, user?.id, response.data);
      }
    } catch (requestError) {
      if (request === latest.current) setError(requestError instanceof Error ? requestError.message : "Dashboard could not be loaded");
    } finally {
      if (request === latest.current) setRefreshing(false);
    }
  }, [loadTrend, user?.id]);

  // Picking 30 or 90 days loads only the chart, not the whole dashboard.
  useEffect(() => {
    void loadTrend(trendDays);
  }, [trendDays, loadTrend]);

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

  if (!data && !error) return <DashboardSkeleton />;
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
  const maintenance = m.byStatus.MAINTENANCE ?? 0;
  const breakdown = m.byStatus.BREAKDOWN ?? 0;
  const down = maintenance + breakdown;
  const idle = Math.max(0, m.total - m.knitting - down);
  const utilization = m.total ? Math.round((m.knitting / m.total) * 100) : 0;

  // A range not loaded yet keeps showing the 7 days, faded, until it arrives.
  const picked = trendDays === 7 ? d : trends[trendDays];
  const trendLoading = !picked;
  const chart = picked ?? d;
  const trendTotals = Object.fromEntries(TREND_SERIES.map((s) => [s.key, chart.trend.reduce((sum, day) => sum + day[s.key], 0)])) as Record<TrendKey, number>;
  const trendEmpty = TREND_SERIES.every((s) => trendTotals[s.key] === 0);
  const today = d.trend.at(-1)?.date === todayInput() ? d.trend.at(-1) : undefined;

  const board = STAGE_ORDER.map((key) => p.board.find((stage) => stage.key === key) ?? { key, count: 0, kg: 0, oldestDays: 0, stuck: 0, places: [] });
  const stuckTotal = board.reduce((sum, stage) => sum + (stage.key === "PURCHASED" ? 0 : stage.stuck), 0);
  const readyCount = board.find((stage) => stage.key === "AT_OFFICE")?.count ?? 0;

  const attentionCounts = (["danger", "warning", "info"] as const).map((tone) => [tone, d.attention.filter((a) => a.tone === tone).length] as const);
  const kindCount = new Map<AttentionKind, number>();
  for (const item of d.attention) {
    const kind = item.kind ?? kindOfHref(item.href);
    kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1);
  }
  const attentionKinds = [...kindCount];
  const stockTotal = Object.values(d.stockKg).reduce((sum, value) => sum + Math.max(0, value), 0);
  const runningShown = 6;

  return (
    <div className="dashboard-page mx-auto max-w-[1800px] space-y-6 pb-8">
      {/* ---------- Hero ---------- */}
      <section className="dashboard-hero overflow-hidden rounded-[22px] p-4 text-white md:p-5">
        <div className="relative z-10 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="flex items-center gap-3.5">
            <div className="dashboard-hero__monogram"><Gauge size={21} /></div>
            <div>
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-white/55">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Mill command centre
              </div>
              <h2 className="mt-1 text-xl font-black tracking-[-.03em] md:text-[1.7rem]">
                {greeting()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
              </h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/55">
                <CalendarDays size={12} />
                {new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(d.generatedAt))}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 backdrop-blur">
              <p className="text-[8px] font-bold uppercase tracking-[.14em] text-white/40">Last updated</p>
              <p className="mt-0.5 text-[11px] font-semibold text-white/85">{dateTime.format(new Date(d.generatedAt))}</p>
            </div>
            <Button size="sm" className="border border-white/15 bg-white/10 text-white hover:bg-white/15" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="dashboard-hero__meta relative z-10 mt-4 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {([
            ["Batches in production", String(p.active), kg(p.inProcessKg), Factory, "text-amber-200", "/production"],
            ["Machines knitting", `${m.knitting} / ${m.total}`, `${utilization}% in use`, Gauge, "text-emerald-300", "/masters/machines"],
            ["Ready to deliver", kg(p.readyKg), plural(readyCount, "batch", "batches"), PackageCheck, "text-emerald-300", "/production"],
            ["Waiting for a machine", String(m.knittingTasks), m.knittingTasks ? "knitting tasks" : "none waiting", ClipboardList, m.knittingTasks ? "text-amber-200" : "text-emerald-300", "/masters/machines"],
            ["Machines down", String(down), down ? `${maintenance} maintenance · ${breakdown} breakdown` : "all working", Wrench, down ? "text-rose-300" : "text-emerald-300", "/masters/machines"],
          ] as const).map(([label, value, sub, Icon, tone, href]) => (
            <Link key={label} href={href}>
              <div className="dashboard-hero-chip-icon"><Icon size={16} className={tone} /></div>
              <div className="min-w-0">
                <p className="truncate text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</p>
                <p className="mt-0.5 text-base font-bold leading-tight">{value}</p>
                <p className="truncate text-[10px] text-white/45">{sub}</p>
              </div>
            </Link>
          ))}
        </div>

        {today && (
          <div className="dashboard-hero__today relative z-10 mt-3">
            <span className="dashboard-hero__today-label"><Timer size={12} /> Today so far</span>
            {TREND_SERIES.map((series) => (
              <span key={series.key} className="dashboard-hero__today-item">
                <i style={{ background: series.color }} />
                {series.label}
                <b>{kg(today[series.key])}</b>
              </span>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>{error}. Showing the last loaded figures.</span>
          <button className="font-bold" onClick={() => void load(true)}>Retry</button>
        </div>
      )}

      {/* ---------- Needs attention ---------- */}
      <section className="dashboard-attention" aria-label="Needs attention">
        {d.attention.length === 0 ? (
          <p className="dashboard-attention__clear"><CheckCircle2 size={16} /> All clear: nothing overdue, stuck or waiting.</p>
        ) : (
          <>
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#a77a24]">Needs attention</p>
              {attentionCounts.map(([tone, count]) => count > 0 && (
                <span key={tone} className={cn("dashboard-attention__count", `is-${tone}`)}>
                  {count} {tone === "danger" ? "urgent" : tone === "warning" ? "to do" : "to note"}
                </span>
              ))}
              {/* Which areas they are in: machines, warehouse, purchases… */}
              <span className="dashboard-attention__kinds">
                {attentionKinds.map(([kind, count]) => {
                  const { icon: KindIcon, label } = ATTENTION_KINDS[kind];
                  return <span key={kind} className={cn("attn-kind-chip", `is-${kind}`)} title={`${count} about ${label.toLowerCase()}`}><KindIcon size={11} /> {label} · {count}</span>;
                })}
              </span>
            </div>
            <ul>
              {d.attention.map((item) => {
                const kind = item.kind ?? kindOfHref(item.href);
                const { icon: KindIcon, label } = ATTENTION_KINDS[kind];
                const ToneIcon = item.tone === "danger" ? AlertTriangle : item.tone === "warning" ? CircleDot : Info;
                return (
                  <li key={item.text}>
                    <Link href={item.href} className={cn("dashboard-attention__item", `is-${item.tone}`)}>
                      <span className={cn("attn-icon", `is-${kind}`, item.tone === "danger" && "is-urgent")}><KindIcon size={15} /></span>
                      <span className="dashboard-attention__text flex-1">
                        <span className={cn("attn-kind-chip", `is-${kind}`)}>{label}</span>
                        {item.text}
                      </span>
                      <ToneIcon size={14} className="shrink-0" aria-label={item.tone === "danger" ? "Urgent" : item.tone === "warning" ? "To do" : "To note"} />
                      <ArrowRight size={14} className="shrink-0 opacity-60" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* ---------- Production flow ---------- */}
      <section aria-label="Production process workboard">
        <SectionTitle eyebrow="Live workflow" title="Where every production batch is now" action={<MoreLink href="/production">Open production</MoreLink>} />

        <div className="dashboard-flow-summary mt-3">
          <span><Factory size={14} /> <b>{plural(p.active, "open batch", "open batches")}</b></span>
          <span><Scale size={14} /> <b>{kg(p.inProcessKg)}</b> in process</span>
          <span className={cn(stuckTotal > 0 && "is-bad")}><Timer size={14} /> <b>{stuckTotal}</b> stuck over {STUCK_DAYS} days</span>
          <span className="dashboard-flow-summary__bar" aria-label="Weight by stage">
            {board.map((stage) => stage.kg > 0 && <i key={stage.key} style={{ width: `${share(stage.kg, p.inProcessKg)}%`, background: STAGES[stage.key].color }} title={`${STAGES[stage.key].label}: ${kg(stage.kg)}`} />)}
          </span>
        </div>

        <div className="dashboard-flow mt-3">
          {board.map((stage, index) => {
            const meta = STAGES[stage.key];
            const Icon = meta.icon;
            const late = stage.key !== "PURCHASED" && stage.oldestDays > STUCK_DAYS;
            return (
              <article key={stage.key} className="dashboard-flow__stage" style={{ "--stage": meta.color } as React.CSSProperties}>
                {index < board.length - 1 && <ChevronRight className="dashboard-flow__arrow" size={16} aria-hidden />}
                <header className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn("dashboard-stat-icon h-9 w-9 shrink-0", meta.tone)}><Icon size={16} /></span>
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-[.14em] text-gray-400">Step {index + 1}</p>
                      <p className="truncate font-bold text-gray-800">{meta.label}</p>
                    </div>
                  </div>
                  <span className="dashboard-flow__count">{stage.count}</span>
                </header>
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <b className="text-lg font-bold tracking-tight text-gray-800">{kg(stage.kg)}</b>
                  <span className="text-[10px] font-semibold text-gray-400">{Math.round(share(stage.kg, p.inProcessKg))}% of weight</span>
                </div>
                <div className="dashboard-flow__bar"><span style={{ width: `${share(stage.kg, p.inProcessKg)}%` }} /></div>
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className="text-gray-400">Oldest waiting</span>
                  <span className={cn("font-bold", late ? "text-rose-600" : "text-gray-700")}>{stage.count ? days(stage.oldestDays) : "—"}</span>
                </div>
                {stage.key !== "PURCHASED" && stage.stuck > 0 && (
                  <p className="mt-1.5 rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">{plural(stage.stuck, "batch", "batches")} over {STUCK_DAYS} days</p>
                )}
                {stage.key === "PURCHASED" ? (
                  <p className="mt-3 text-[11px] leading-4 text-gray-400">{meta.note}.</p>
                ) : stage.places.length ? (
                  <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                    {stage.places.slice(0, 3).map((place) => (
                      <li key={place.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-gray-700" title={place.name}>{place.name}</span>
                          <span className={cn("text-[10px]", place.oldest > STUCK_DAYS ? "font-semibold text-rose-600" : "text-gray-400")}>{plural(place.count, "batch", "batches")} · oldest {place.oldest}d</span>
                        </span>
                        <b className="shrink-0 tabular-nums text-gray-800">{kg(place.kg)}</b>
                      </li>
                    ))}
                    {stage.places.length > 3 && <li className="text-[11px] text-gray-400">+{stage.places.length - 3} more locations</li>}
                  </ul>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-gray-200 px-3 py-3 text-center text-xs text-gray-400">Nothing at this stage.</p>
                )}
              </article>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Split dye colours remain separate batches, so completed colours can move to compacting while pending colours continue to show under their dyeing company.</p>
      </section>

      {d.processUpdates.length > 0 && (
        <section className="dashboard-updates" aria-label="Production updates">
          <SectionTitle eyebrow="Notifications" title="Production updates" action={<MoreLink href="/notifications">All notifications</MoreLink>} />
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
                    <p className="dashboard-update__time">{dateTime.format(new Date(u.createdAt))}</p>
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

      {/* ---------- Production + money at a glance ---------- */}
      <section>
        <SectionTitle eyebrow="Output" title="Production at a glance" />
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <StatTile
            title="Last day knitted"
            value={m.lastDay ? kg(m.lastDay.kg) : "—"}
            caption={m.lastDay ? `${formatDate(m.lastDay.date)} · ${plural(m.lastDay.machines, "machine")} · ${m.lastDay.rolls} rolls` : "No day-end entry yet"}
            icon={Layers}
            tone="gold"
            href="/masters/machines"
          />
          <StatTile
            title="Weight lost in process"
            value={p.processLossPct === null ? "—" : `${p.processLossPct.toFixed(1)}%`}
            caption="Open batches past knitting, by yarn started"
            icon={Scale}
            tone="green"
            href="/production"
          />
          <StatTile
            title="Delivered this month"
            value={kg(p.deliveredThisMonth.kg)}
            caption={`${plural(p.deliveredThisMonth.count, "delivery", "deliveries")} to parties${p.deliveredThisMonth.amount !== null ? ` · ${money(p.deliveredThisMonth.amount)} billed` : ""}`}
            icon={Truck}
            tone="blue"
            href="/production"
          />
          <StatTile
            title="Sold this month"
            value={kg(sales.thisMonth.kg)}
            caption={`${plural(sales.thisMonth.count, "bill")} dispatched${sales.waiting ? ` · ${sales.waiting} waiting` : ""}`}
            icon={ReceiptIndianRupee}
            tone="violet"
            href={d.isAdmin ? "/sales" : "/warehouses"}
          />
          <StatTile
            title="Waiting to receive"
            value={kg(d.awaitingFabric.kg)}
            caption={`${plural(d.awaitingFabric.count, "fabric delivery", "fabric deliveries")} · ${plural(d.purchases.open, "open PO")}`}
            icon={Inbox}
            tone={d.purchases.overdue ? "rose" : "slate"}
            href="/warehouses"
          />
        </div>

        {cash && (
          <>
            <div className="mt-6">
              <SectionTitle eyebrow="Money" title="Where the business stands" action={<MoreLink href="/money">Money</MoreLink>} />
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile title="Sales billed this month" value={money(sales.thisMonth.amount ?? 0)} caption={`${plural(sales.thisMonth.count, "dispatched bill")} · with GST`} icon={ReceiptIndianRupee} tone="gold" href="/sales" />
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
                title="Cheques to clear"
                value={money(cash.chequesIn.amount)}
                caption={cash.chequesIn.count || cash.chequesOut.count ? `${plural(cash.chequesIn.count, "received cheque")} · ${money(cash.chequesOut.amount)} issued` : "No cheques waiting"}
                icon={FileCheck2}
                tone={cash.chequesIn.count ? "gold" : "slate"}
                href="/money?tab=cheques"
              />
            </div>

            <div className="mt-2.5 grid gap-2.5 lg:grid-cols-3">
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Cash flow this month</p>
                    <p className={cn("mt-2 text-xl font-bold tracking-[-.03em]", cash.month.net < 0 ? "text-rose-600" : "text-emerald-700")}>{signedMoney(cash.month.net)}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">Net: money in minus money out</p>
                  </div>
                  <Link href="/finance" className={cn("dashboard-stat-icon h-10 w-10 shrink-0", cash.month.net < 0 ? TONES.rose : TONES.green)} aria-label="Finance"><Landmark size={17} /></Link>
                </div>
                <div className="mt-4 space-y-3">
                  {([
                    ["Money in", cash.month.moneyIn, `Received ${money(cash.month.receivedTotal)} · deliveries ${money(cash.month.collected)}`, "is-in", ArrowDownCircle],
                    ["Money out", cash.month.moneyOut, `Suppliers ${money(cash.month.supplierPaid)} · other ${money(cash.month.otherPaid)} · expenses ${money(cash.month.expenses)}`, "is-out", ArrowUpCircle],
                  ] as const).map(([label, value, note, tone, Icon]) => (
                    <Link key={label} href="/money?tab=entries" className="block">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-gray-600"><Icon size={13} /> {label}</span>
                        <b className="tabular-nums text-gray-800">{money(value)}</b>
                      </div>
                      <div className={cn("dashboard-meter mt-1.5", tone)}><span style={{ width: `${share(value, Math.max(cash.month.moneyIn, cash.month.moneyOut))}%` }} /></div>
                      <p className="mt-1 truncate text-[10px] text-gray-400" title={note}>{note}</p>
                    </Link>
                  ))}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Owed to us vs owed by us</p>
                    <p className={cn("mt-2 text-xl font-bold tracking-[-.03em]", cash.receivable - cash.payable < 0 ? "text-rose-600" : "text-gray-800")}>{signedMoney(cash.receivable - cash.payable)}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">To collect minus to pay</p>
                  </div>
                  <Link href="/money?tab=parties" className={cn("dashboard-stat-icon h-10 w-10 shrink-0", TONES.blue)} aria-label="Parties"><Scale size={17} /></Link>
                </div>
                <div className="dashboard-versus mt-4">
                  <span className="is-in" style={{ flexGrow: Math.max(cash.receivable, 0.0001) }} />
                  <span className="is-out" style={{ flexGrow: Math.max(cash.payable, 0.0001) }} />
                </div>
                <div className="mt-2 flex justify-between gap-3 text-[11px]">
                  <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#4f7cac]" />To collect <b className="text-gray-800">{money(cash.receivable)}</b></span>
                  <span className="text-right"><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#d3a64c]" />To pay <b className="text-gray-800">{money(cash.payable)}</b></span>
                </div>
                <p className="mt-3 text-[11px] text-gray-400">
                  {plural(cash.partiesDue, "party", "parties")} owe us · {plural(cash.distributorsOwed, "distributor")} to pay
                </p>
              </Card>

              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Cash, bank & UPI</p>
                    <p className={cn("mt-2 text-xl font-bold tracking-[-.03em]", cash.balances.total < 0 ? "text-rose-600" : "text-gray-800")}>{signedMoney(cash.balances.total)}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">Balance across every active account</p>
                  </div>
                  <Link href="/money?tab=accounts" className={cn("dashboard-stat-icon h-10 w-10 shrink-0", cash.balances.total < 0 ? TONES.rose : TONES.green)} aria-label="Accounts"><Wallet size={17} /></Link>
                </div>
                <div className="mt-4">
                  <SegmentBar
                    label="Balance by account type"
                    parts={[
                      { label: "Cash", value: cash.balances.cash, color: "#236b59", display: signedMoney(cash.balances.cash) },
                      { label: "Bank", value: cash.balances.bank, color: "#1b3c55", display: signedMoney(cash.balances.bank) },
                      { label: "UPI", value: cash.balances.upi, color: "#d3a64c", display: signedMoney(cash.balances.upi) },
                    ]}
                  />
                </div>
              </Card>
            </div>
          </>
        )}
      </section>

      {/* ---------- Material flow ---------- */}
      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,.55fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
            <SectionTitle eyebrow="Material flow" title={`KG per day · last ${trendDays} days`} />
            <div className="flex rounded-xl bg-gray-100 p-0.5 text-[11px] font-bold" role="group" aria-label="Trend range">
              {TREND_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={trendDays === range}
                  onClick={() => setTrendDays(range)}
                  className={cn("rounded-[10px] px-3 py-1 transition", trendDays === range ? "bg-white text-[#183b32] shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  {range}D
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="relative pt-4">
            <div className={cn("transition-opacity", (trendLoading || trendEmpty) && "opacity-40")}>
              <ProductionChart data={chart.trend} series={TREND_SERIES} />
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
            <SectionTitle eyebrow="Compared" title={`vs the ${trendDays} days before`} />
          </CardHeader>
          <CardContent className={cn("space-y-2.5 transition-opacity", trendLoading && "opacity-40")}>
            {TREND_SERIES.map((series) => {
              const total = trendTotals[series.key];
              const before = chart.trendPrevious[series.key];
              return (
                <div key={series.key} className="dashboard-compare" style={{ "--series": series.color } as React.CSSProperties}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-gray-600">
                      <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: series.color }} />
                      <span className="truncate">{series.label}</span>
                    </span>
                    <Delta value={change(total, before)} />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <b className="text-lg font-bold tracking-tight text-gray-800">{kg(total)}</b>
                    <span className="text-[11px] text-gray-400">{kg(total / trendDays)} / day</span>
                  </div>
                  <div className="dashboard-compare__bars" aria-hidden>
                    <span style={{ width: `${share(total, Math.max(total, before))}%` }} />
                    <span className="is-before" style={{ width: `${share(before, Math.max(total, before))}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">Before: {kg(before)}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      {/* ---------- Shop floor ---------- */}
      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,.55fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle
              eyebrow="Shop floor"
              title="Batches waiting longest"
              action={<MoreLink href="/production">{p.active > p.batches.length ? `All ${p.active} batches` : "All batches"}</MoreLink>}
            />
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
                      <th className="px-5 py-3">Progress</th>
                      <th className="px-5 py-3">Weight</th>
                      <th className="px-5 py-3">In this stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {p.batches.map((b) => (
                      <tr key={b.id} className="transition hover:bg-[#fafcfb]">
                        <td className="px-5 py-3.5">
                          <Link href={`/production?batch=${encodeURIComponent(b.flowNo)}`} className="customers-code">{b.flowNo}</Link>
                          <p className="mt-1 text-[11px] text-gray-500">{b.fabric}{b.color ? ` · ${b.color}` : ""}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge tone={b.status === "AT_OFFICE" ? "success" : b.status === "PURCHASED" ? "default" : "info"}>{stageLabel(b.status)}</Badge>
                          <p className="mt-1 max-w-[16rem] truncate text-[11px] text-gray-500" title={b.place}>{b.place}</p>
                        </td>
                        <td className="px-5 py-3.5"><StageSteps status={b.status} /></td>
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-gray-700">{kg(b.currentKg)}</p>
                          <p className="mt-0.5 text-[11px] text-gray-400">from {kg(b.startedKg)}{b.lossPct > 0.05 ? ` · ${b.lossPct.toFixed(1)}% loss` : ""}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className={cn("font-semibold", b.daysInStage > STUCK_DAYS ? "text-rose-600" : "text-gray-700")}>{days(b.daysInStage)}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.active > p.batches.length && (
                  <p className="border-t border-gray-100 px-5 py-2.5 text-[11px] text-gray-400">
                    Showing the {p.batches.length} longest waiting of {p.active} open batches.
                  </p>
                )}
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
                <p className="mt-1 text-[11px] text-white/45">{kg(m.knittedOnRunningKg)} knitted on current runs</p>
              </div>
            </div>
            <div className="mt-4">
              <SegmentBar
                label="Machines by status"
                parts={[
                  { label: "Knitting", value: m.knitting, color: "#d3a64c" },
                  { label: "Idle", value: idle, color: "#cbd5e1" },
                  { label: "Maintenance", value: maintenance, color: "#f59e0b" },
                  { label: "Breakdown", value: breakdown, color: "#e11d48" },
                ]}
              />
            </div>
            {m.running.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-gray-100 pt-3">
                {m.running.slice(0, runningShown).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 text-xs">
                    <span className="min-w-0">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" />
                      <Link href={machineHref(r.machineId)} className="font-bold text-[#1b3c55] hover:underline">{r.machine}</Link>
                      <Link href={runHref(r.runNo)} className="ml-2 font-mono text-gray-600 hover:underline">{r.runNo}</Link>
                      <span className="block text-[11px] text-gray-400">Since {shiftText(r.startedAt, r.startShift)}</span>
                    </span>
                    <b className="shrink-0 tabular-nums">{kg(r.knittedKg)}</b>
                  </li>
                ))}
                {m.running.length > runningShown && <li className="px-1 text-[11px] text-gray-400">+{m.running.length - runningShown} more running</li>}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---------- Stock, purchases, sales, alerts ---------- */}
      <section className={cn("grid gap-5 lg:grid-cols-2", d.isAdmin ? "2xl:grid-cols-4" : "2xl:grid-cols-3")}>
        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Warehouses" title="Stock on hand" action={<MoreLink href="/warehouses">Warehouses</MoreLink>} />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total in KG</span>
              <b className="text-xl font-bold tracking-tight text-gray-800">{kg(stockTotal)}</b>
            </div>
            <div className="dashboard-segments mt-2" role="img" aria-label="Stock by category">
              {stockTotal > 0
                ? ([["YARN", "#236b59"], ["GREY_FABRIC", "#94a3b8"], ["DYED_FABRIC", "#4f7cac"], ["FINISHED_FABRIC", "#d3a64c"]] as const).map(([key, color]) =>
                    d.stockKg[key] > 0 && <span key={key} style={{ width: `${share(d.stockKg[key], stockTotal)}%`, background: color }} />)
                : <span className="is-empty" />}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {([
                ["Yarn", d.stockKg.YARN, Boxes, "bg-emerald-50 text-emerald-700", "YARN"],
                ["Grey fabric", d.stockKg.GREY_FABRIC, Layers, "bg-slate-100 text-slate-700", "GREY_FABRIC"],
                ["Dyed fabric", d.stockKg.DYED_FABRIC, Droplets, "bg-blue-50 text-blue-700", "DYED_FABRIC"],
                ["Finished fabric", d.stockKg.FINISHED_FABRIC, PackageCheck, "bg-amber-50 text-amber-700", "FINISHED_FABRIC"],
              ] as const).map(([label, value, Icon, tone, category]) => (
                <Link key={label} href={`/warehouses?category=${category}`} className="dashboard-stat-tile flex items-center gap-3 p-3">
                  <div className={cn("dashboard-stat-icon h-9 w-9 shrink-0", tone)}><Icon size={16} /></div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                    <p className={cn("mt-0.5 truncate text-base font-bold", value < -0.0005 ? "text-rose-600" : "text-gray-800")}>{kg(value)}</p>
                    <p className="text-[10px] text-gray-400">{Math.round(share(value, stockTotal))}% of stock</p>
                  </div>
                </Link>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-gray-400"><Scale size={11} className="mr-1 inline" />KG only; cones, bags and other units are on the Warehouses page.</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <SectionTitle eyebrow="Incoming" title="Material on the way" action={d.isAdmin ? <MoreLink href="/purchases">Purchases</MoreLink> : undefined} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-center">
              {([
                ["Open POs", String(d.purchases.open), false],
                ["Fabric to receive", String(d.awaitingFabric.count), false],
              ] as const).map(([label, value, bad]) => (
                <div key={label} className={cn("rounded-xl px-2 py-2.5", bad ? "bg-rose-50" : "bg-gray-50")}>
                  <p className={cn("text-lg font-bold", bad ? "text-rose-700" : "text-gray-800")}>{value}</p>
                  <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                </div>
              ))}
            </div>
            {d.isAdmin && d.purchases.toArriveValue !== null && d.purchases.toArriveValue > 0 && (
              <p className="rounded-xl bg-[#f7f9f8] px-3 py-2 text-[11px] text-gray-500">Still to arrive on open POs: <b className="text-gray-800">{money(d.purchases.toArriveValue)}</b></p>
            )}
            {d.purchases.next.length === 0 ? (
              <p className="text-sm text-gray-500">No purchase orders waiting.</p>
            ) : (
              <ul className="space-y-1.5">
                {d.purchases.next.map((po) => {
                  return (
                    <li key={po.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 text-xs">
                      <span className="min-w-0">
                        {d.isAdmin ? <Link href={`/purchases/${po.id}`} className="font-bold text-[#1b3c55] hover:underline">{po.poNo}</Link> : <b>{po.poNo}</b>}
                        <span className="block truncate text-[11px] text-gray-500">{po.supplier}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {d.awaitingFabric.next.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400"><Warehouse size={12} /> Fabric to receive</p>
                <ul className="space-y-1.5">
                  {d.awaitingFabric.next.map((row) => (
                    <li key={row.id}>
                      <Link href={row.warehouseId ? `/warehouses?warehouse=${row.warehouseId}` : "/warehouses"} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 text-xs transition hover:border-[#c9d8d1] hover:bg-[#fafcfb]">
                        <span className="min-w-0">
                          <b className="text-[#1b3c55]">{row.flowNo}</b>
                          <span className="block truncate text-[11px] text-gray-500">{row.warehouse} · sent {formatDate(row.deliveredAt)}</span>
                        </span>
                        <b className="shrink-0 tabular-nums">{kg(row.kg)}</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {d.isAdmin && (
          <Card className="overflow-hidden">
            <CardHeader>
              <SectionTitle eyebrow="Sales" title="Latest bills" action={<MoreLink href="/sales">Sales</MoreLink>} />
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(sales.waiting > 0 || sales.sentBack > 0) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {sales.waiting > 0 && <Badge tone="warning">{sales.waiting} waiting dispatch</Badge>}
                  {sales.sentBack > 0 && <Badge tone="danger">{sales.sentBack} sent back</Badge>}
                </div>
              )}
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
                      <b className="tabular-nums">{money(sale.total)}</b>
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
                const kind = notificationKind(alert);
                const AlertIcon = notificationIcon(alert);
                return (
                  <div key={alert.id} className={cn("flex gap-3 rounded-2xl border p-3", urgent ? "border-rose-200 bg-rose-50/60" : "border-gray-100 bg-gray-50/60")}>
                    <span className={cn("attn-icon mt-0.5", `is-${kind}`, urgent && "is-urgent")}><AlertIcon size={15} /></span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-gray-800">
                        <span className={cn("attn-kind-chip", `is-${kind}`)}>{ATTENTION_KINDS[kind].label}</span>
                        {alert.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">{alert.message}</p>
                      <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">{alert.priority} · {dateTime.format(new Date(alert.createdAt))}</p>
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
