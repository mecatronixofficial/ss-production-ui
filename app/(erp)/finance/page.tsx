"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  BarChart3,
  CalendarRange,
  Download,
  Factory,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Scale,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wallet,
  WalletCards,
  Wrench,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { expenseModeLabel, MODE_LABEL, type Expense, type FinanceOverview, type FinancePnl, type PnlBucket, type PnlGroup } from "@/lib/money";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, humanize, kg, money, todayInput, toNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type BatchDelivery = { id: string; deliveredAt: string; destination: "CUSTOMER" | "WAREHOUSE"; partyName: string | null; weightKg: string; amount: string; expense: string; notes: string | null };
type Batch = {
  id: string;
  flowNo: string;
  status: string;
  yarnCount: string;
  fabricType: string | null;
  purchaseDate: string;
  collectedAmount: number;
  deliveries?: BatchDelivery[];
  metrics: { totalSpent: number; profit: number };
};
/** One delivery to a party, with its batch, for the Collections tab. */
type Collection = BatchDelivery & { flowNo: string; fabric: string };
type Tab = "overview" | "expenses" | "collections" | "production";
type Preset = "today" | "week" | "month" | "lastMonth" | "fy" | "lastFy" | "custom";

const TABS: Array<{ value: Tab; label: string; icon: typeof Landmark }> = [
  { value: "overview", label: "Profit & loss", icon: LayoutDashboard },
  { value: "expenses", label: "Expense analysis", icon: TrendingDown },
  { value: "collections", label: "Delivery collections", icon: ArrowDownCircle },
  { value: "production", label: "Batch profit", icon: Factory },
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Indian financial year: April to March. */
function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  const today = todayInput();
  if (preset === "today") return { from: today, to: today };
  // Weeks run Monday to Sunday.
  if (preset === "week") return { from: ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))), to: today };
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "lastMonth") return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  if (preset === "fy") return { from: `${fyStart}-04-01`, to: today };
  return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
}
const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "fy", label: "This financial year" },
  { value: "lastFy", label: "Last financial year" },
  { value: "custom", label: "Custom" },
];
const startIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endIso = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();
const signed = (value: number) => `${value < 0 ? "−" : ""}${money(Math.abs(value))}`;
const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const inPeriod = (date: string, from: string, to: string) => date.slice(0, 10) >= from && date.slice(0, 10) <= to;
const marginText = (profit: number, earned: number) => (earned > 0.005 ? `${((profit / earned) * 100).toFixed(1)}%` : "—");

const GROUPS: Array<{ value: PnlGroup; label: string; plural: string; days: number; max: number }> = [
  { value: "day", label: "Day", plural: "days", days: 1, max: 400 },
  { value: "week", label: "Week", plural: "weeks", days: 7, max: 260 },
  { value: "month", label: "Month", plural: "months", days: 28, max: 120 },
  { value: "year", label: "Year", plural: "years", days: 365, max: 30 },
];
/** Days in a YYYY-MM-DD period, both ends counted. */
const periodDays = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1;
/** Whether a grouping makes a table the server will give (about how many rows it would have). */
const groupFits = (group: (typeof GROUPS)[number], days: number) => Math.ceil(days / group.days) + 1 <= group.max;
/** The grouping that reads best for a period: days for a month, weeks for a quarter, months for two years. */
const autoGroup = (days: number): PnlGroup => (days <= 31 ? "day" : days <= 120 ? "week" : days <= 731 ? "month" : "year");
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
/** "Sat, 31 Oct 2026" · "26 Oct – 1 Nov 2026" · "Oct 2026" · "FY 2026–27". */
function bucketLabel(b: PnlBucket, group: PnlGroup) {
  if (group === "day") return new Date(`${b.key}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (group === "week") return b.from === b.to ? formatDate(`${b.from}T12:00:00`) : `${shortDay(b.from)} – ${formatDate(`${b.to}T12:00:00`)}`;
  if (group === "month") return monthName(b.key);
  return `FY ${b.key}–${String((Number(b.key) + 1) % 100).padStart(2, "0")}`;
}

function StatTile({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Landmark; tone: "invoiced" | "received" | "outstanding" | "expenses" }) {
  return (
    <div className={`finance-stat-tile finance-stat-tile--${tone}`}>
      <div className="finance-stat-icon"><Icon size={15} /></div>
      <div className="min-w-0">
        <p className="finance-stat-label">{label}</p>
        <p className="finance-stat-value truncate">{value}</p>
        <p className="truncate text-[11px] text-gray-500">{note}</p>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, badge = 3, action, tone, children }: { title: string; icon: typeof Landmark; badge?: 1 | 2 | 3 | 4 | 5; action?: React.ReactNode; tone?: string; children: React.ReactNode }) {
  return (
    <Card className={cn("finance-card", tone)}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="finance-card-heading">
          <span className={`finance-step-badge finance-step-badge--${badge}`}><Icon size={14} /></span>
          <h3 className="font-bold">{title}</h3>
        </div>
        {action}
      </CardHeader>
      <CardContent className="space-y-2.5">{children}</CardContent>
    </Card>
  );
}

/**
 * `/finance`: the results side, read-only. For any period: profit and loss (statement, and by day, week, month or
 * financial year), how money flowed, machine expenses, money given to staff, expense analysis, delivery collections
 * and batch profit. Everything is recorded on the Money page; the money
 * figures here are the same calculation, so the two pages always agree.
 */
export default function Finance() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? tabParam! : "overview";
  const setTab = (next: Tab) => router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false });

  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState(presetRange("month"));
  const period = preset === "custom" ? custom : presetRange(preset);
  const validPeriod = !!period.from && !!period.to && period.from <= period.to;
  const range = `from=${encodeURIComponent(startIso(period.from || todayInput()))}&to=${encodeURIComponent(endIso(period.to || todayInput()))}`;

  const overview = useApiQuery<FinanceOverview>(validPeriod ? `/finance/overview?${range}` : null);
  const expenses = useApiQuery<Expense[]>(tab === "expenses" && validPeriod ? `/money/expenses?${range}` : null);
  const production = useApiQuery<{ data: Batch[]; summary: { totalSpent: number; collectedAmount: number; profit: number; activeBatches: number } }>(
    tab === "collections" || tab === "production" ? "/production/fabric-flows" : null,
  );

  /** Every delivery of finished fabric to a party in the period, newest first. */
  const collections = useMemo<Collection[]>(
    () =>
      (production.data?.data ?? [])
        .flatMap((b) => (b.deliveries ?? []).filter((d) => d.destination === "CUSTOMER").map((d) => ({ ...d, flowNo: b.flowNo, fabric: b.fabricType ?? b.yarnCount })))
        .filter((d) => inPeriod(d.deliveredAt, period.from, period.to))
        .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt)),
    [production.data, period.from, period.to],
  );

  const periodText = `${formatDate(`${period.from}T12:00:00`)} – ${formatDate(`${period.to}T12:00:00`)}`;
  const header = (
    <>
      <div className="finance-page-header flex-wrap">
        <span className="finance-page-icon"><Landmark size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold md:text-xl">Finance</h2>
          <p className="text-xs text-gray-500">
            Profit and loss for any period, by day, week, month or year, with cash flow and machine expenses (read-only). Record receipts, payments and expenses on the{" "}
            <Link href="/money" className="font-semibold text-[#1b3c55] underline">Money</Link> page.
          </p>
        </div>
        <Button variant="outline" asChild><Link href="/money"><Wallet size={15} /> Open Money <ArrowRight size={14} /></Link></Button>
      </div>

      <div className="finance-period">
        <CalendarRange size={16} className="text-[#1b3c55]" aria-hidden />
        <div className="purchases-filters" role="tablist" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" role="tab" aria-selected={preset === p.value} className={cn(preset === p.value && "is-active")} onClick={() => { if (p.value === "custom") setCustom(period); setPreset(p.value); }}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From" className="w-36"><Input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
            <Field label="To" className="w-36"><Input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
          </div>
        ) : (
          <span className="text-xs font-semibold text-gray-600">{periodText}</span>
        )}
      </div>

      <div className="finance-tabs" role="tablist" aria-label="Finance sections">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={cn(tab === value && "is-active")} onClick={() => setTab(value)}>
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>
    </>
  );

  if (!validPeriod) {
    return <div className="finance-page">{header}<p className="text-sm text-red-600">Choose a start date on or before the end date.</p></div>;
  }

  const o = overview.data;
  return (
    <div className="finance-page">
      {header}

      {!o ? (
        overview.error ? <ErrorState message={overview.error} onRetry={() => void overview.reload()} /> : <Loading />
      ) : (
        <div className="finance-stats grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile tone="received" icon={ArrowDownCircle} label="Earned" value={money(o.earned.total)} note={`Sales ${money(o.earned.salesTaxable)} · deliveries ${money(o.earned.collected)}`} />
          <StatTile tone="expenses" icon={ArrowUpCircle} label="Spent" value={money(o.spent.total)} note={`Goods ${money(o.spent.purchases)} · expenses ${money(o.spent.expenses)}${o.machineExpenses.total || o.staffPayments.total ? ` (machines ${money(o.machineExpenses.total)}, staff ${money(o.staffPayments.total)})` : ""}`} />
          <StatTile tone="outstanding" icon={o.result >= 0 ? TrendingUp : TrendingDown} label={o.result >= 0 ? "Profit" : "Loss"} value={signed(o.result)} note={o.earned.total > 0.005 ? `${marginText(o.result, o.earned.total)} of earned · before stock in hand` : "Before stock still in hand"} />
          <StatTile tone="invoiced" icon={WalletCards} label="Net cash" value={signed(o.cashFlow.net)} note={`In ${money(o.cashFlow.moneyIn)} · out ${money(o.cashFlow.moneyOut)}`} />
        </div>
      )}

      {tab === "overview" && o && <ResultsTab o={o} from={period.from} to={period.to} />}
      {tab === "expenses" && (
        <ExpenseAnalysis
          rows={expenses.data}
          error={expenses.error}
          retry={() => void expenses.reload()}
          from={period.from}
          to={period.to}
          batchCosts={o?.spent.batchCosts ?? 0}
        />
      )}
      {tab === "collections" && (
        <CollectionsTab rows={collections} loading={!production.data} error={production.error} retry={() => void production.reload()} from={period.from} to={period.to} />
      )}
      {tab === "production" && <BatchProfit data={production.data} error={production.error} retry={() => void production.reload()} />}
    </div>
  );
}

function ResultsTab({ o, from, to }: { o: FinanceOverview; from: string; to: string }) {
  const c = o.cashFlow;
  const topExpense = o.expensesByCategory[0]?.amount ?? 0;
  return (
    <>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Profit & loss statement" icon={Scale} badge={1} tone="finance-card--invoice">
          <dl className="finance-flow">
            <div>
              <dt>Sales billed (taxable){o.earned.salesCount ? <span className="block text-[11px] text-gray-400">{o.earned.salesCount} bills · textiles {money(o.earned.textiles.amount)} · distributors {money(o.earned.distributors.amount)} (with GST)</span> : null}</dt>
              <dd className="text-emerald-700">{money(o.earned.salesTaxable)}</dd>
            </div>
            <div><dt>Collected on production deliveries<span className="block text-[11px] text-gray-400">{o.earned.deliveries} deliver{o.earned.deliveries === 1 ? "y" : "ies"}</span></dt><dd className="text-emerald-700">{money(o.earned.collected)}</dd></div>
            <div className="is-total"><dt>Earned</dt><dd className="text-emerald-700">{money(o.earned.total)}</dd></div>
            <div><dt>Goods received from distributors<span className="block text-[11px] text-gray-400">{o.spent.purchaseReceipts} receipt{o.spent.purchaseReceipts === 1 ? "" : "s"}, at PO rate</span></dt><dd className="text-rose-700">{money(o.spent.purchases)}</dd></div>
            <div><dt>Expenses<span className="block text-[11px] text-gray-400">{o.spent.expenseCount} entries{o.machineExpenses.total || o.staffPayments.total ? ` · machines ${money(o.machineExpenses.total)}, staff ${money(o.staffPayments.total)}, other ${money(o.spent.expenses - o.machineExpenses.total - o.staffPayments.total)}` : ""}</span></dt><dd className="text-rose-700">{money(o.spent.expenses)}</dd></div>
            <div><dt>Costs entered on production batches</dt><dd className="text-rose-700">{money(o.spent.batchCosts)}</dd></div>
            <div className="is-total"><dt>{o.result >= 0 ? "Profit" : "Loss"}<span className="block text-[11px] font-normal text-gray-400">earned − spent · margin {marginText(o.result, o.earned.total)}</span></dt><dd className={o.result >= 0 ? "text-emerald-700" : "text-red-700"}>{signed(o.result)}</dd></div>
          </dl>
          <p className="text-[11px] text-gray-500">GST on sales ({money(o.earned.salesGst)}) is collected for the government and not counted as earned. Material bought and still in stock counts as spent here; see Batch profit for profit per batch.</p>
        </Panel>

        <Panel title="Cash flow" icon={WalletCards} badge={2} tone="finance-card--payment" action={<Button size="sm" variant="outline" asChild><Link href="/money?tab=entries">Entries</Link></Button>}>
          <dl className="finance-flow">
            {c.received.filter((r) => r.amount > 0).map((r) => (
              <div key={`in-${r.mode}`}><dt>Received · {MODE_LABEL[r.mode]}<span className="block text-[11px] text-gray-400">{r.count} entr{r.count === 1 ? "y" : "ies"}</span></dt><dd className="text-emerald-700">+{money(r.amount)}</dd></div>
            ))}
            {c.collected > 0 && <div><dt>Collected on deliveries</dt><dd className="text-emerald-700">+{money(c.collected)}</dd></div>}
            <div><dt>Paid to distributors</dt><dd className="text-rose-700">−{money(c.supplierPaid)}</dd></div>
            {c.otherPaid > 0 && <div><dt>Other payments</dt><dd className="text-rose-700">−{money(c.otherPaid)}</dd></div>}
            <div>
              <dt>
                Expenses
                {(c.machineExpenses > 0 || c.staffPayments > 0) && (
                  <span className="block text-[11px] font-normal text-gray-400">machines {money(c.machineExpenses)} · staff {money(c.staffPayments)} · other {money(c.expenses - c.machineExpenses - c.staffPayments)}</span>
                )}
              </dt>
              <dd className="text-rose-700">−{money(c.expenses)}</dd>
            </div>
            <div className="is-total"><dt>Net cash</dt><dd className={c.net >= 0 ? "text-emerald-700" : "text-red-700"}>{signed(c.net)}</dd></div>
          </dl>
          <p className="text-[11px] text-gray-500">Money that actually moved; a cheque counts on the day it cleared. The Money page shows the same figures.</p>
        </Panel>

        <Panel title="Where it stands now" icon={Wallet} badge={4} tone="finance-card--payments-list">
          <dl className="finance-flow">
            <div><dt>In cash, bank & UPI<span className="block text-[11px] text-gray-400">{o.position.accounts} account{o.position.accounts === 1 ? "" : "s"}</span></dt><dd>{signed(o.position.inAccounts)}</dd></div>
            <div><dt>To collect from textiles & distributors</dt><dd className="text-amber-700">{money(o.position.receivable)}</dd></div>
            <div><dt>Advances received</dt><dd className="text-emerald-700">{money(o.position.advanceReceived)}</dd></div>
            <div><dt>To pay distributors</dt><dd className="text-red-700">{money(o.position.payable)}</dd></div>
            <div><dt>Advances paid</dt><dd className="text-emerald-700">{money(o.position.advancePaid)}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild><Link href="/money?tab=accounts">Accounts</Link></Button>
            <Button size="sm" variant="outline" asChild><Link href="/money?tab=parties">Who owes what</Link></Button>
          </div>
          <p className="text-[11px] text-gray-500">Today&apos;s balances, whatever the period.</p>
        </Panel>
      </div>

      <PnlPanel from={from} to={to} />

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Biggest expenses" icon={TrendingDown} badge={5}>
          {o.expensesByCategory.length === 0 ? (
            <p className="text-sm text-gray-500">No expenses in this period.</p>
          ) : (
            <ul className="space-y-2">
              {o.expensesByCategory.slice(0, 8).map((row) => (
                <li key={row.category} className="finance-bar">
                  <span className="flex justify-between gap-2 text-sm"><span>{row.category}</span><b>{money(row.amount)}</b></span>
                  <span className="block text-[11px] text-gray-500">{row.count} entr{row.count === 1 ? "y" : "ies"} · {o.spent.expenses ? ((row.amount / o.spent.expenses) * 100).toFixed(0) : 0}%</span>
                  <span className="finance-bar__track" aria-hidden><span style={{ width: `${(row.amount / topExpense) * 100}%` }} /></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <MachineExpensesPanel o={o} />
        <StaffPaymentsPanel o={o} />
      </div>
    </>
  );
}

/**
 * Profit and loss over time: the period day by day, week by week, month by month or by financial year, with the
 * profit of each against the biggest, its margin and the cash that moved.
 */
function PnlPanel({ from, to }: { from: string; to: string }) {
  const days = periodDays(from, to);
  const [chosen, setChosen] = useState<PnlGroup | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const fitting = GROUPS.filter((g) => groupFits(g, days));
  const group = chosen && fitting.some((g) => g.value === chosen) ? chosen : autoGroup(days);
  const meta = GROUPS.find((g) => g.value === group)!;
  const tz = new Date().getTimezoneOffset();
  const pnl = useApiQuery<FinancePnl>(`/finance/pnl?from=${encodeURIComponent(startIso(from))}&to=${encodeURIComponent(endIso(to))}&group=${group}&tz=${tz}`);
  const data = pnl.data?.group === group ? pnl.data : undefined;
  const rows = data ? [...data.buckets].reverse().filter((b) => !hideEmpty || b.earned || b.spent || b.moneyIn || b.moneyOut) : [];
  const top = Math.max(1, ...(data?.buckets ?? []).map((b) => Math.abs(b.profit)));
  const t = data?.totals;
  const label = (key: string | null) => {
    const b = key ? data?.buckets.find((x) => x.key === key) : undefined;
    return b ? bucketLabel(b, group) : "—";
  };

  const exportRows = () =>
    data &&
    downloadCsv(
      `profit-and-loss-by-${group}-${from}-${to}.csv`,
      ["Period", "From", "To", "Sales (taxable)", "Collected on deliveries", "Earned", "Goods received", "Expenses", "of which machines", "of which staff", "Batch costs", "Spent", "Profit", "Margin %", "Money in", "Money out", "Net cash"],
      data.buckets.map((b) => [
        bucketLabel(b, group),
        b.from,
        b.to,
        b.sales.toFixed(2),
        b.collected.toFixed(2),
        b.earned.toFixed(2),
        b.purchases.toFixed(2),
        b.expenses.toFixed(2),
        b.machineExpenses.toFixed(2),
        b.staffPayments.toFixed(2),
        b.batchCosts.toFixed(2),
        b.spent.toFixed(2),
        b.profit.toFixed(2),
        b.earned > 0.005 ? ((b.profit / b.earned) * 100).toFixed(1) : "",
        b.moneyIn.toFixed(2),
        b.moneyOut.toFixed(2),
        b.net.toFixed(2),
      ]),
    );

  return (
    <Panel
      title={`Profit & loss by ${meta.label.toLowerCase()}`}
      icon={BarChart3}
      badge={3}
      tone="finance-card--register"
      action={
        <div className="finance-pnl-head">
          <div className="purchases-filters" role="tablist" aria-label="Group by">
            {GROUPS.map((g) => {
              const fits = fitting.some((f) => f.value === g.value);
              return (
                <button key={g.value} type="button" role="tab" aria-selected={group === g.value} disabled={!fits} title={fits ? `By ${g.label.toLowerCase()}` : `Too many ${g.plural} in this period`} className={cn(group === g.value && "is-active")} onClick={() => setChosen(g.value)}>
                  {g.label}
                </button>
              );
            })}
          </div>
          <Button size="sm" variant="outline" disabled={!data} onClick={exportRows}><Download size={14} /> Export</Button>
        </div>
      }
    >
      {!data ? (
        pnl.error ? <ErrorState message={pnl.error} onRetry={() => void pnl.reload()} /> : <Loading />
      ) : (
        <>
          <div className="finance-pnl-summary">
            <div><p>{t!.profit >= 0 ? "Profit" : "Loss"}</p><strong className={t!.profit >= 0 ? "text-emerald-700" : "text-red-700"}>{signed(t!.profit)}</strong><span>margin {marginText(t!.profit, t!.earned)}</span></div>
            <div><p>Average per {meta.label.toLowerCase()}</p><strong>{signed(data.activeBuckets ? t!.profit / data.activeBuckets : 0)}</strong><span>over {data.activeBuckets} {data.activeBuckets === 1 ? meta.label.toLowerCase() : meta.plural} with business</span></div>
            <div><p>In profit</p><strong>{data.profitableBuckets} of {data.activeBuckets}</strong><span>{meta.plural}</span></div>
            <div><p>Best · worst</p><strong className="text-sm">{label(data.best)}</strong><span>worst: {label(data.worst)}</span></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>{data.buckets.length} {data.buckets.length === 1 ? meta.label.toLowerCase() : meta.plural}, newest first.{group === "week" ? " Weeks run Monday to Sunday." : group === "year" ? " Financial years run April to March." : ""}</span>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide {meta.plural} with nothing
            </label>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">No sales, purchases, expenses or money moved in this period.</p>
          ) : (
            <div className="purchases-line-table max-h-[34rem] overflow-auto rounded-xl border">
              <table className="finance-pnl-table w-full min-w-[820px] text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2">{meta.label}</th>
                    <th className="px-3 py-2 text-right">Earned</th>
                    <th className="px-3 py-2 text-right">Spent</th>
                    <th className="px-3 py-2 text-right">Profit / loss</th>
                    <th className="w-[20%] px-3 py-2"><span className="sr-only">Profit bar</span></th>
                    <th className="px-3 py-2 text-right">Margin</th>
                    <th className="px-3 py-2 text-right">Net cash</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const empty = !b.earned && !b.spent;
                    return (
                      <tr key={b.key} className={cn(empty && "is-empty", b.key === data.best && data.activeBuckets > 1 && "is-best", b.key === data.worst && data.activeBuckets > 1 && "is-worst")}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{bucketLabel(b, group)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700" title={`Sales ${money(b.sales)} · collected ${money(b.collected)}`}>{money(b.earned)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-rose-700" title={`Goods ${money(b.purchases)} · expenses ${money(b.expenses)} (machines ${money(b.machineExpenses)}, staff ${money(b.staffPayments)}) · batch costs ${money(b.batchCosts)}`}>
                          {money(b.spent)}
                          {(b.machineExpenses > 0 || b.staffPayments > 0) && (
                            <span className="block text-[11px] text-gray-400">{[b.machineExpenses > 0 && `machines ${money(b.machineExpenses)}`, b.staffPayments > 0 && `staff ${money(b.staffPayments)}`].filter(Boolean).join(" · ")}</span>
                          )}
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", b.profit < 0 ? "text-red-700" : "text-emerald-700")}>{signed(b.profit)}</td>
                        <td className="px-3 py-2"><span className="finance-pnl-bar" aria-hidden><span className={b.profit < 0 ? "is-loss" : "is-gain"} style={{ width: `${(Math.abs(b.profit) / top) * 50}%` }} /></span></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-600">{marginText(b.profit, b.earned)}</td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", b.net < 0 ? "text-red-700" : "text-gray-700")} title={`In ${money(b.moneyIn)} · out ${money(b.moneyOut)}`}>{signed(b.net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{money(t!.earned)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">{money(t!.spent)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", t!.profit < 0 ? "text-red-700" : "text-emerald-700")}>{signed(t!.profit)}</td>
                    <td />
                    <td className="px-3 py-2 text-right text-xs">{marginText(t!.profit, t!.earned)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{signed(t!.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-500">Earned is sales billed (taxable) plus amounts collected on deliveries; spent is goods received, expenses (machine expenses and money given to staff included) and batch costs. Net cash is the money that actually moved. Hover a figure for its parts.</p>
        </>
      )}
    </Panel>
  );
}

/** Machine expenses in the period: by machine and by type (part of expenses above). */
function MachineExpensesPanel({ o }: { o: FinanceOverview }) {
  const m = o.machineExpenses;
  const top = m.byMachine[0]?.amount ?? 0;
  return (
    <Panel
      title={`Machine expenses · ${money(m.total)}`}
      icon={Wrench}
      badge={4}
      action={<Button size="sm" variant="outline" asChild><Link href="/masters/machines?view=expenses">Machines</Link></Button>}
    >
      {m.byMachine.length === 0 ? (
        <p className="text-sm text-gray-500">No machine expense in this period. Record repairs, spares, needles, oil, service and power on Machines → Machine expenses.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {m.byMachine.slice(0, 8).map((row) => (
              <li key={row.id} className="finance-bar">
                <span className="flex justify-between gap-2 text-sm"><Link href={`/masters/machines/${row.id}`} className="font-mono font-semibold hover:underline">{row.code}</Link><b>{money(row.amount)}</b></span>
                <span className="block text-[11px] text-gray-500">{row.name} · {row.count} entr{row.count === 1 ? "y" : "ies"} · {m.total ? ((row.amount / m.total) * 100).toFixed(0) : 0}%</span>
                <span className="finance-bar__track" aria-hidden><span style={{ width: `${(row.amount / top) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {m.byType.map((row) => <Badge key={row.type} tone="info">{row.type} · {money(row.amount)}</Badge>)}
          </div>
          <p className="text-[11px] text-gray-500">{o.spent.expenses ? ((m.total / o.spent.expenses) * 100).toFixed(0) : 0}% of all expenses in this period. Each machine&apos;s cost per KG knitted is on its Machines page.</p>
        </>
      )}
    </Panel>
  );
}

/** Money given to employees in the period (daily wages, salary, advances…): by employee and by kind. */
function StaffPaymentsPanel({ o }: { o: FinanceOverview }) {
  const p = o.staffPayments;
  const top = p.byEmployee[0]?.amount ?? 0;
  return (
    <Panel
      title={`Paid to staff · ${money(p.total)}`}
      icon={HandCoins}
      badge={2}
      action={<Button size="sm" variant="outline" asChild><Link href="/masters/employees">Employees</Link></Button>}
    >
      {p.byEmployee.length === 0 ? (
        <p className="text-sm text-gray-500">No money given to employees in this period. Give money from an employee&apos;s page; it is recorded on the day under Wages.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {p.byEmployee.slice(0, 8).map((row) => (
              <li key={row.id} className="finance-bar">
                <span className="flex justify-between gap-2 text-sm"><Link href={`/masters/employees/${row.id}`} className="truncate font-semibold hover:underline">{row.name}</Link><b>{money(row.amount)}</b></span>
                <span className="block text-[11px] text-gray-500">{row.code} · {row.department} · {row.count} payment{row.count === 1 ? "" : "s"}{row.last ? ` · last ${formatDate(row.last)}` : ""}</span>
                <span className="finance-bar__track" aria-hidden><span style={{ width: `${(row.amount / top) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
          {p.byEmployee.length > 8 && <p className="text-[11px] text-gray-500">And {p.byEmployee.length - 8} more.</p>}
          <div className="flex flex-wrap gap-1.5">
            {p.byKind.map((row) => <Badge key={row.kind} tone="info">{row.kind} · {money(row.amount)}</Badge>)}
          </div>
          <p className="text-[11px] text-gray-500">{o.spent.expenses ? ((p.total / o.spent.expenses) * 100).toFixed(0) : 0}% of all expenses in this period, counted under Wages.</p>
        </>
      )}
    </Panel>
  );
}

function ExpenseAnalysis({ rows, error, retry, from, to, batchCosts }: { rows?: Expense[]; error: string; retry: () => void; from: string; to: string; batchCosts: number }) {
  if (!rows) return error ? <ErrorState message={error} onRetry={retry} /> : <Loading />;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byCategory = [...rows.reduce((map, r) => map.set(r.category, (map.get(r.category) ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const months = [...new Set(rows.map((r) => r.expenseDate.slice(0, 7)))].sort();
  const cell = (category: string, month: string) => rows.filter((r) => r.category === category && r.expenseDate.slice(0, 7) === month).reduce((s, r) => s + r.amount, 0);
  const byAccount = [...rows.reduce((map, r) => map.set(r.account?.name ?? "No account", (map.get(r.account?.name ?? "No account") ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const byMachine = [...rows.reduce((map, r) => (r.machine ? map.set(r.machine.code, (map.get(r.machine.code) ?? 0) + r.amount) : map), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const machineTotal = byMachine.reduce((s, [, v]) => s + v, 0);
  const byEmployee = [...rows.reduce((map, r) => (r.employee ? map.set(r.employee.name, (map.get(r.employee.name) ?? 0) + r.amount) : map), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const staffTotal = byEmployee.reduce((s, [, v]) => s + v, 0);
  const top = byCategory[0]?.[1] ?? 0;
  const columns: ColumnDef<Expense>[] = [
    { header: "Date", id: "date", accessorFn: (r) => r.expenseDate, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.expenseDate)}<span className="block font-mono text-[11px] text-gray-400">{row.original.expenseNo}</span></span> },
    { header: "Category", accessorKey: "category", cell: ({ row }) => <Badge tone="info">{row.original.category}</Badge> },
    {
      header: "Description",
      id: "description",
      accessorFn: (r) => [r.description, r.machine?.code, r.employee?.name, r.subcategory].filter(Boolean).join(" "),
      cell: ({ row }) => (
        <span>
          {row.original.machine && <span className="block text-[11px] font-semibold text-[#17644f]">Machine {row.original.machine.code}{row.original.subcategory ? ` · ${row.original.subcategory}` : ""}</span>}
          {row.original.employee && <span className="block text-[11px] font-semibold text-[#b45309]">{row.original.employee.name} · {row.original.employee.code}{row.original.subcategory ? ` · ${row.original.subcategory}` : ""}</span>}
          {row.original.description || <span className="text-gray-400">—</span>}
        </span>
      ),
    },
    { header: "Paid from", id: "paid", accessorFn: (r) => `${expenseModeLabel(r.paymentMode)} ${r.account?.name ?? ""}`, cell: ({ row }) => <span>{expenseModeLabel(row.original.paymentMode)}<span className="block text-xs text-gray-400">{row.original.account?.name ?? "No account"}</span></span> },
    { header: "Amount", id: "amount", meta: { align: "right" }, accessorFn: (r) => r.amount, cell: ({ getValue }) => <b className="text-rose-700">{money(getValue<number>())}</b> },
  ];
  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={`By category · ${money(total)}`} icon={TrendingDown} badge={5} tone="finance-card--expenses-list">
          {byCategory.length === 0 ? (
            <p className="text-sm text-gray-500">No expenses in this period.</p>
          ) : (
            <ul className="space-y-2">
              {byCategory.map(([category, amount]) => (
                <li key={category} className="finance-bar">
                  <span className="flex justify-between gap-2 text-sm"><span>{category}</span><b>{money(amount)} <span className="text-[11px] font-normal text-gray-500">{((amount / total) * 100).toFixed(0)}%</span></b></span>
                  <span className="finance-bar__track" aria-hidden><span style={{ width: `${(amount / top) * 100}%` }} /></span>
                </li>
              ))}
            </ul>
          )}
          {batchCosts > 0 && <p className="text-[11px] text-gray-500">Plus {money(batchCosts)} entered as costs on production batches (see Batch profit).</p>}
        </Panel>
        <Panel title="Paid from" icon={Wallet} badge={2}>
          <dl className="finance-flow">
            {byAccount.map(([name, amount]) => <div key={name}><dt>{name}</dt><dd className="text-rose-700">{money(amount)}</dd></div>)}
          </dl>
          {byMachine.length > 0 && (
            <>
              <h4 className="pt-2 text-sm font-bold">On machines · {money(machineTotal)}</h4>
              <dl className="finance-flow">
                {byMachine.map(([code, amount]) => <div key={code}><dt className="font-mono">{code}</dt><dd className="text-rose-700">{money(amount)}</dd></div>)}
              </dl>
            </>
          )}
          {byEmployee.length > 0 && (
            <>
              <h4 className="pt-2 text-sm font-bold">To staff · {money(staffTotal)}</h4>
              <dl className="finance-flow">
                {byEmployee.map(([name, amount]) => <div key={name}><dt>{name}</dt><dd className="text-rose-700">{money(amount)}</dd></div>)}
              </dl>
            </>
          )}
          <p className="text-[11px] text-gray-500">To record or cancel an expense, use <Link href="/money?tab=expenses" className="text-[#1b3c55] underline">Money → Expenses</Link>.</p>
        </Panel>
      </div>

      {months.length > 1 && (
        <Panel title="Category by month" icon={BarChart3} badge={3} tone="finance-card--register">
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full text-sm" style={{ minWidth: 220 + months.length * 110 }}>
              <thead><tr><th className="px-3 py-2">Category</th>{months.map((m) => <th key={m} className="px-3 py-2 text-right">{monthName(m)}</th>)}<th className="px-3 py-2 text-right">Total</th></tr></thead>
              <tbody>
                {byCategory.map(([category, amount]) => (
                  <tr key={category}>
                    <td className="px-3 py-2 font-medium">{category}</td>
                    {months.map((m) => { const v = cell(category, m); return <td key={m} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{v ? money(v) : <span className="text-gray-300">—</span>}</td>; })}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{money(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title="Expenses in this period"
        icon={TrendingDown}
        badge={3}
        tone="finance-card--register"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!rows.length}
            onClick={() => downloadCsv(`expenses-${from}-${to}.csv`, ["No", "Date", "Category", "Type", "Machine", "Employee", "Description", "Paid by", "Account", "Amount"], rows.map((r) => [r.expenseNo, r.expenseDate.slice(0, 10), r.category, r.subcategory, r.machine?.code, r.employee ? `${r.employee.name} (${r.employee.code})` : "", r.description, expenseModeLabel(r.paymentMode), r.account?.name, r.amount.toFixed(2)]))}
          >
            <Download size={14} /> Export
          </Button>
        }
      >
        <DataTable data={rows} columns={columns} getRowId={(r) => r.id} minWidth={680} pageSize={25} searchPlaceholder="Search description, number..." emptyTitle="No expenses in this period" />
      </Panel>
    </>
  );
}

function CollectionsTab({ rows, loading, error, retry, from, to }: { rows: Collection[]; loading: boolean; error: string; retry: () => void; from: string; to: string }) {
  if (loading) return error ? <ErrorState message={error} onRetry={retry} /> : <Loading />;
  const byParty = [...rows.reduce((map, c) => {
    const key = c.partyName ?? "Party";
    const row = map.get(key) ?? { kg: 0, amount: 0, count: 0 };
    map.set(key, { kg: row.kg + toNumber(c.weightKg), amount: row.amount + toNumber(c.amount), count: row.count + 1 });
    return map;
  }, new Map<string, { kg: number; amount: number; count: number }>())].sort((a, b) => b[1].amount - a[1].amount);
  const top = byParty[0]?.[1].amount || 1;
  const columns: ColumnDef<Collection>[] = [
    { header: "Date", id: "date", accessorFn: (r) => r.deliveredAt, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.deliveredAt)}</span> },
    { header: "Party", id: "party", accessorFn: (r) => r.partyName ?? "", cell: ({ row }) => <span className="font-medium">{row.original.partyName ?? "Party"}</span> },
    {
      header: "Batch",
      id: "batch",
      accessorFn: (r) => `${r.flowNo} ${r.fabric}`,
      cell: ({ row }) => (
        <div>
          <Link href={`/production?batch=${encodeURIComponent(row.original.flowNo)}`} className="customers-code">{row.original.flowNo}</Link>
          <span className="mt-0.5 block text-xs text-gray-500">{row.original.fabric}</span>
        </div>
      ),
    },
    { header: "Weight", id: "weight", meta: { align: "right" }, accessorFn: (r) => toNumber(r.weightKg), cell: ({ getValue }) => kg(getValue<number>()) },
    { header: "Collected", id: "amount", meta: { align: "right" }, accessorFn: (r) => toNumber(r.amount), cell: ({ getValue }) => <b className={getValue<number>() > 0 ? "text-emerald-700" : "text-gray-400"}>{getValue<number>() > 0 ? money(getValue<number>()) : "Not recorded"}</b> },
    { header: "Notes", id: "notes", accessorFn: (r) => r.notes ?? "", cell: ({ row }) => <span className="block max-w-[14rem] truncate text-xs text-gray-500" title={row.original.notes ?? undefined}>{row.original.notes || "—"}</span> },
  ];
  return (
    <>
      <Panel title="Collected by party" icon={UserRound} badge={2} tone="finance-card--payment">
        <p className="text-xs text-gray-500">Amounts entered when finished fabric is delivered to a party on the Production page. They count as money in, but are not in any cash / bank account.</p>
        {byParty.length === 0 ? (
          <p className="text-sm text-gray-500">No fabric delivered to a party in this period.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {byParty.map(([party, row]) => (
              <li key={party} className="finance-bar">
                <span className="flex justify-between gap-2 text-sm"><span className="truncate">{party}</span><b>{money(row.amount)}</b></span>
                <span className="block text-[11px] text-gray-500">{row.count} deliver{row.count === 1 ? "y" : "ies"} · {kg(row.kg)}</span>
                <span className="finance-bar__track finance-bar__track--in" aria-hidden><span style={{ width: `${(row.amount / top) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="Deliveries to parties"
        icon={ArrowDownCircle}
        badge={3}
        tone="finance-card--register"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `collections-${from}-${to}.csv`,
                ["Date", "Party", "Batch", "Fabric", "Weight KG", "Collected", "Notes"],
                rows.map((c) => [c.deliveredAt.slice(0, 10), c.partyName, c.flowNo, c.fabric, toNumber(c.weightKg).toFixed(3), toNumber(c.amount).toFixed(2), c.notes]),
              )
            }
          >
            <Download size={14} /> Export
          </Button>
        }
      >
        <DataTable data={rows} columns={columns} getRowId={(r) => r.id} minWidth={720} searchPlaceholder="Search party, batch..." emptyTitle="No deliveries to parties in this period" />
      </Panel>
    </>
  );
}

function BatchProfit({ data, error, retry }: { data?: { data: Batch[]; summary: { totalSpent: number; collectedAmount: number; profit: number; activeBatches: number } }; error: string; retry: () => void }) {
  if (!data) return error ? <ErrorState message={error} onRetry={retry} /> : <Loading />;
  const batches = data.data;
  const columns: ColumnDef<Batch>[] = [
    {
      header: "Batch",
      id: "batch",
      accessorFn: (r) => `${r.flowNo} ${r.fabricType ?? ""} ${r.yarnCount}`,
      cell: ({ row }) => (
        <div>
          <Link href={`/production?batch=${encodeURIComponent(row.original.flowNo)}`} className="customers-code">{row.original.flowNo}</Link>
          <span className="mt-0.5 block text-xs text-gray-500">{row.original.fabricType ?? row.original.yarnCount} · {formatDate(row.original.purchaseDate)}</span>
        </div>
      ),
    },
    { header: "Status", accessorKey: "status", cell: ({ row }) => <Badge tone={row.original.status === "DELIVERED" ? "success" : "default"}>{humanize(row.original.status)}</Badge> },
    { header: "Spent", id: "spent", meta: { align: "right" }, accessorFn: (r) => r.metrics.totalSpent, cell: ({ getValue }) => <span className="text-rose-700">{money(getValue<number>())}</span> },
    { header: "Collected", id: "collected", meta: { align: "right" }, accessorFn: (r) => r.collectedAmount, cell: ({ getValue }) => <span className="text-emerald-700">{money(getValue<number>())}</span> },
    {
      header: "Profit",
      id: "profit",
      meta: { align: "right" },
      accessorFn: (r) => r.metrics.profit,
      cell: ({ row }) => {
        const p = row.original.metrics.profit;
        const margin = row.original.collectedAmount > 0 ? (p / row.original.collectedAmount) * 100 : null;
        return (
          <b className={p >= 0 ? "text-emerald-700" : "text-red-700"}>
            {signed(p)}
            {margin !== null && <span className="block text-[11px] font-normal text-gray-500">{margin.toFixed(1)}% margin</span>}
          </b>
        );
      },
    },
  ];
  return (
    <>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatTile tone="expenses" icon={ArrowUpCircle} label="Spent on batches" value={money(data.summary.totalSpent)} note="Yarn, processing and other batch costs" />
        <StatTile tone="received" icon={ArrowDownCircle} label="Collected on deliveries" value={money(data.summary.collectedAmount)} note="From parties" />
        <StatTile tone="outstanding" icon={Scale} label="Profit so far" value={signed(data.summary.profit)} note={`${data.summary.activeBatches} batch${data.summary.activeBatches === 1 ? "" : "es"} still running`} />
      </div>
      <Panel
        title="Money per production batch"
        icon={Factory}
        badge={1}
        tone="finance-card--register"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={batches.length === 0}
            onClick={() =>
              downloadCsv(
                `batch-profit-${todayInput()}.csv`,
                ["Batch", "Fabric", "Started", "Status", "Spent", "Collected", "Profit"],
                batches.map((b) => [b.flowNo, b.fabricType ?? b.yarnCount, b.purchaseDate.slice(0, 10), humanize(b.status), b.metrics.totalSpent.toFixed(2), b.collectedAmount.toFixed(2), b.metrics.profit.toFixed(2)]),
              )
            }
          >
            <Download size={14} /> Export
          </Button>
        }
      >
        <p className="text-xs text-gray-500">All batches, whatever the period. Spent is yarn plus knitting, dyeing, compacting and other batch costs; collected is what parties paid on delivery. A batch still in process shows a loss until it is delivered.</p>
        <DataTable data={batches} columns={columns} getRowId={(r) => r.id} minWidth={720} searchPlaceholder="Search batch, fabric..." emptyTitle="No production batches yet" />
      </Panel>
    </>
  );
}
