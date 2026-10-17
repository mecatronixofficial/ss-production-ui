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
  Landmark,
  LayoutDashboard,
  Scale,
  TrendingDown,
  UserRound,
  Wallet,
  WalletCards,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { expenseModeLabel, MODE_LABEL, type Expense, type FinanceOverview } from "@/lib/money";
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
type Preset = "month" | "lastMonth" | "fy" | "lastFy" | "custom";

const TABS: Array<{ value: Tab; label: string; icon: typeof Landmark }> = [
  { value: "overview", label: "Results", icon: LayoutDashboard },
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
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "lastMonth") return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  if (preset === "fy") return { from: `${fyStart}-04-01`, to: today };
  return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
}
const PRESETS: Array<{ value: Preset; label: string }> = [
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
 * `/finance`: the results side, read-only. For any period: what was earned and spent, how money flowed, month by
 * month, expense analysis, delivery collections and batch profit. Everything is recorded on the Money page; the money
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
            Results and reports, read-only: earned vs spent, cash flow and profit for any period. Record receipts, payments and expenses on the{" "}
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
          <StatTile tone="expenses" icon={ArrowUpCircle} label="Spent" value={money(o.spent.total)} note={`Goods ${money(o.spent.purchases)} · expenses ${money(o.spent.expenses)}`} />
          <StatTile tone="outstanding" icon={Scale} label="Earned − spent" value={signed(o.result)} note="Before stock still in hand" />
          <StatTile tone="invoiced" icon={WalletCards} label="Net cash" value={signed(o.cashFlow.net)} note={`In ${money(o.cashFlow.moneyIn)} · out ${money(o.cashFlow.moneyOut)}`} />
        </div>
      )}

      {tab === "overview" && o && <ResultsTab o={o} />}
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

function ResultsTab({ o }: { o: FinanceOverview }) {
  const c = o.cashFlow;
  const maxMonth = Math.max(1, ...o.months.map((m) => Math.max(m.moneyIn, m.moneyOut)));
  const topExpense = o.expensesByCategory[0]?.amount ?? 0;
  return (
    <>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Earned vs spent" icon={Scale} badge={1} tone="finance-card--invoice">
          <dl className="finance-flow">
            <div>
              <dt>Sales billed (taxable){o.earned.salesCount ? <span className="block text-[11px] text-gray-400">{o.earned.salesCount} bills · textiles {money(o.earned.textiles.amount)} · distributors {money(o.earned.distributors.amount)} (with GST)</span> : null}</dt>
              <dd className="text-emerald-700">{money(o.earned.salesTaxable)}</dd>
            </div>
            <div><dt>Collected on production deliveries<span className="block text-[11px] text-gray-400">{o.earned.deliveries} deliver{o.earned.deliveries === 1 ? "y" : "ies"}</span></dt><dd className="text-emerald-700">{money(o.earned.collected)}</dd></div>
            <div className="is-total"><dt>Earned</dt><dd className="text-emerald-700">{money(o.earned.total)}</dd></div>
            <div><dt>Goods received from distributors<span className="block text-[11px] text-gray-400">{o.spent.purchaseReceipts} receipt{o.spent.purchaseReceipts === 1 ? "" : "s"}, at PO rate</span></dt><dd className="text-rose-700">{money(o.spent.purchases)}</dd></div>
            <div><dt>Expenses<span className="block text-[11px] text-gray-400">{o.spent.expenseCount} entries</span></dt><dd className="text-rose-700">{money(o.spent.expenses)}</dd></div>
            <div><dt>Costs entered on production batches</dt><dd className="text-rose-700">{money(o.spent.batchCosts)}</dd></div>
            <div className="is-total"><dt>Earned − spent</dt><dd className={o.result >= 0 ? "text-emerald-700" : "text-red-700"}>{signed(o.result)}</dd></div>
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
            <div><dt>Expenses</dt><dd className="text-rose-700">−{money(c.expenses)}</dd></div>
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

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Month by month"
          icon={BarChart3}
          badge={3}
          tone="finance-card--register"
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={!o.months.length}
              onClick={() =>
                downloadCsv(
                  `cash-flow-by-month-${todayInput()}.csv`,
                  ["Month", "Received", "Collected on deliveries", "Money in", "Payments", "Expenses", "Money out", "Net"],
                  o.months.map((m) => [m.month, m.received.toFixed(2), m.collected.toFixed(2), m.moneyIn.toFixed(2), m.paid.toFixed(2), m.expenses.toFixed(2), m.moneyOut.toFixed(2), m.net.toFixed(2)]),
                )
              }
            >
              <Download size={14} /> Export
            </Button>
          }
        >
          {o.months.length === 0 ? (
            <p className="text-sm text-gray-500">No months in this period.</p>
          ) : (
            <div className="purchases-line-table overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr><th className="px-3 py-2">Month</th><th className="px-3 py-2">In vs out</th><th className="px-3 py-2 text-right">Money in</th><th className="px-3 py-2 text-right">Money out</th><th className="px-3 py-2 text-right">Net</th></tr></thead>
                <tbody>
                  {[...o.months].reverse().map((m) => (
                    <tr key={m.month}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{monthName(m.month)}</td>
                      <td className="w-[38%] px-3 py-2">
                        <span className="finance-month-bar finance-month-bar--in" style={{ width: `${(m.moneyIn / maxMonth) * 100}%` }} />
                        <span className="finance-month-bar finance-month-bar--out" style={{ width: `${(m.moneyOut / maxMonth) * 100}%` }} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">{money(m.moneyIn)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-rose-700">{money(m.moneyOut)}</td>
                      <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", m.net < 0 ? "text-red-700" : "text-emerald-700")}>{signed(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {o.months.length >= 24 && <p className="text-[11px] text-amber-700">Showing the first 24 months of the period.</p>}
        </Panel>

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
      </div>
    </>
  );
}

function ExpenseAnalysis({ rows, error, retry, from, to, batchCosts }: { rows?: Expense[]; error: string; retry: () => void; from: string; to: string; batchCosts: number }) {
  if (!rows) return error ? <ErrorState message={error} onRetry={retry} /> : <Loading />;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byCategory = [...rows.reduce((map, r) => map.set(r.category, (map.get(r.category) ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const months = [...new Set(rows.map((r) => r.expenseDate.slice(0, 7)))].sort();
  const cell = (category: string, month: string) => rows.filter((r) => r.category === category && r.expenseDate.slice(0, 7) === month).reduce((s, r) => s + r.amount, 0);
  const byAccount = [...rows.reduce((map, r) => map.set(r.account?.name ?? "No account", (map.get(r.account?.name ?? "No account") ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const top = byCategory[0]?.[1] ?? 0;
  const columns: ColumnDef<Expense>[] = [
    { header: "Date", id: "date", accessorFn: (r) => r.expenseDate, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.expenseDate)}<span className="block font-mono text-[11px] text-gray-400">{row.original.expenseNo}</span></span> },
    { header: "Category", accessorKey: "category", cell: ({ row }) => <Badge tone="info">{row.original.category}</Badge> },
    { header: "Description", id: "description", accessorFn: (r) => r.description ?? "", cell: ({ row }) => row.original.description || <span className="text-gray-400">—</span> },
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
            onClick={() => downloadCsv(`expenses-${from}-${to}.csv`, ["No", "Date", "Category", "Description", "Paid by", "Account", "Amount"], rows.map((r) => [r.expenseNo, r.expenseDate.slice(0, 10), r.category, r.description, expenseModeLabel(r.paymentMode), r.account?.name, r.amount.toFixed(2)]))}
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
