"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Download, Factory, HandCoins, Plus, Receipt, Undo2, Wallet } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { accountText, EXPENSE_CATEGORIES, expenseModeLabel, type Expense, type MoneyAccount } from "@/lib/money";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime, money, todayInput } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { CancelExpenseDialog } from "./dialogs";

const monthStart = () => `${todayInput().slice(0, 7)}-01`;
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/** What an expense was for: a machine, an employee, or neither. */
type Scope = "" | "machines" | "employees" | "other";
type Breakdown = "category" | "machine" | "employee";
const forOf = (r: Expense): Exclude<Scope, ""> => (r.machine ? "machines" : r.employee ? "employees" : "other");

function sumBy(rows: Expense[], key: (r: Expense) => string | null) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) map.set(k, (map.get(k) ?? 0) + r.amount);
  }
  return [...map].sort((a, b) => b[1] - a[1]);
}

/**
 * Money page → Expenses: record, filter by date / category / account / what it was for (machines, staff, other),
 * see totals by category, machine and employee, and cancel a wrong one. Results by period are on Finance.
 */
export function ExpensesTab({ accounts, version, onAdd, onChanged }: { accounts: MoneyAccount[]; version: number; onAdd: () => void; onChanged: () => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayInput());
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState("");
  const [scope, setScope] = useState<Scope>("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [breakdown, setBreakdown] = useState<Breakdown>("category");
  const [cancelling, setCancelling] = useState<Expense | null>(null);

  // The whole period for the totals; the For tiles only narrow the list, so each tile always shows its share.
  const path = `/money/expenses?${new URLSearchParams({
    ...(from ? { from: dayStart(from) } : {}),
    ...(to ? { to: dayEnd(to) } : {}),
    ...(category ? { category } : {}),
    ...(accountId ? { accountId } : {}),
    ...(showCancelled ? { includeCancelled: "true" } : {}),
  }).toString()}`;
  const { data, error, reload } = useApiQuery<Expense[]>(path);
  useEffect(() => {
    if (version) void reload();
  }, [version, reload]);

  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => (scope ? all.filter((r) => forOf(r) === scope) : all), [all, scope]);
  const liveAll = all.filter((r) => !r.cancelledAt);
  const live = rows.filter((r) => !r.cancelledAt);
  const total = live.reduce((s, r) => s + r.amount, 0);
  const totalAll = liveAll.reduce((s, r) => s + r.amount, 0);
  const share = (s: Exclude<Scope, "">) => liveAll.filter((r) => forOf(r) === s).reduce((sum, r) => sum + r.amount, 0);
  const lists: Record<Breakdown, Array<[string, number]>> = {
    category: sumBy(live, (r) => r.category),
    machine: sumBy(live, (r) => (r.machine ? r.machine.code : null)),
    employee: sumBy(live, (r) => (r.employee ? `${r.employee.name} · ${r.employee.code}` : null)),
  };
  const list = lists[breakdown];
  const top = list[0]?.[1] ?? 0;
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...all.map((r) => r.category)])];

  const tiles: Array<{ value: Scope; label: string; amount: number; icon: typeof Receipt; note: string }> = [
    { value: "", label: "All expenses", amount: totalAll, icon: Receipt, note: `${liveAll.length} entr${liveAll.length === 1 ? "y" : "ies"}` },
    { value: "machines", label: "On machines", amount: share("machines"), icon: Factory, note: "Repair, spares, service…" },
    { value: "employees", label: "Paid to staff", amount: share("employees"), icon: HandCoins, note: "Wages, salary, advances…" },
    { value: "other", label: "Other", amount: share("other"), icon: Wallet, note: "Power, rent, transport…" },
  ];

  const columns: ColumnDef<Expense>[] = [
    { header: "Date", id: "date", accessorFn: (r) => r.expenseDate, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.expenseDate)}<span className="block font-mono text-[11px] text-gray-400">{row.original.expenseNo}</span></span> },
    {
      header: "Category",
      accessorKey: "category",
      cell: ({ row }) => (
        <span>
          <Badge tone={row.original.cancelledAt ? "default" : "info"}>{row.original.category}</Badge>
          {row.original.subcategory && row.original.subcategory !== row.original.category && <span className="mt-0.5 block text-[11px] text-gray-500">{row.original.subcategory}</span>}
        </span>
      ),
    },
    {
      header: "For",
      id: "for",
      accessorFn: (r) => r.machine?.code ?? (r.employee ? `${r.employee.name} ${r.employee.code}` : ""),
      cell: ({ row }) => {
        const r = row.original;
        if (r.machine) return <Link href={`/masters/machines/${r.machine.id}`} className="font-mono text-sm font-semibold text-[#17644f] hover:underline">{r.machine.code}</Link>;
        if (r.employee) return <Link href={`/masters/employees/${r.employee.id}`} className="text-sm font-semibold text-[#b45309] hover:underline">{r.employee.name}<span className="block font-mono text-[11px] font-normal text-gray-500">{r.employee.code}</span></Link>;
        return <span className="text-gray-400">—</span>;
      },
    },
    {
      header: "Description",
      id: "description",
      accessorFn: (r) => r.description ?? "",
      cell: ({ row }) => (
        <div className="max-w-[18rem]">
          <p className="truncate" title={row.original.description ?? undefined}>{row.original.description || <span className="text-gray-400">—</span>}</p>
          <p className="text-[11px] text-gray-400">
            {row.original.createdBy ? `by ${row.original.createdBy}` : ""}
            {row.original.cancelledAt ? ` · cancelled ${formatDateTime(row.original.cancelledAt)}: ${row.original.cancelReason}` : ""}
          </p>
        </div>
      ),
    },
    { header: "Paid from", id: "paidFrom", accessorFn: (r) => `${expenseModeLabel(r.paymentMode)} ${r.account?.name ?? ""}`, cell: ({ row }) => <span>{expenseModeLabel(row.original.paymentMode)}<span className="block text-xs text-gray-400">{row.original.account?.name ?? "No account"}</span></span> },
    { header: "Amount", id: "amount", meta: { align: "right" }, accessorFn: (r) => r.amount, cell: ({ row }) => <b className={cn(row.original.cancelledAt ? "text-gray-400 line-through" : "text-rose-700")}>{money(row.original.amount)}</b> },
    {
      header: "",
      id: "actions",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => (row.original.cancelledAt ? <Badge tone="default">Cancelled</Badge> : <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelling(row.original)}><Undo2 size={13} /> Cancel</Button>),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="money-expense-tiles" role="group" aria-label="Expenses by what they were for">
        {tiles.map((t) => (
          <button key={t.value || "all"} type="button" aria-pressed={scope === t.value} className={cn("money-expense-tile", `is-${t.value || "all"}`, scope === t.value && "is-active")} onClick={() => setScope(t.value)}>
            <span className="money-expense-tile__icon"><t.icon size={15} aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-500">{t.label}</span>
              <strong className="block truncate text-lg tabular-nums">{money(t.amount)}</strong>
              <span className="block truncate text-[11px] text-gray-500">{t.value && totalAll > 0 ? `${((t.amount / totalAll) * 100).toFixed(0)}% · ${t.note}` : t.note}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="finance-card finance-card--register">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="finance-card-heading">
              <span className="finance-step-badge finance-step-badge--5"><ClipboardList size={14} /></span>
              <h3 className="font-bold">{tiles.find((t) => t.value === scope)!.label} · {money(total)}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!rows.length}
                onClick={() =>
                  downloadCsv(
                    `expenses-${scope || "all"}-${from || "all"}-${to || todayInput()}.csv`,
                    ["No", "Date", "Category", "Type", "Machine", "Employee", "Description", "Paid by", "Account", "Amount", "Entered by", "Cancelled"],
                    rows.map((r) => [
                      r.expenseNo,
                      r.expenseDate.slice(0, 10),
                      r.category,
                      r.subcategory,
                      r.machine?.code,
                      r.employee ? `${r.employee.name} (${r.employee.code})` : "",
                      r.description,
                      expenseModeLabel(r.paymentMode),
                      r.account?.name,
                      r.amount.toFixed(2),
                      r.createdBy,
                      r.cancelledAt ? `${r.cancelledAt.slice(0, 10)} ${r.cancelReason ?? ""}` : "",
                    ]),
                  )
                }
              >
                <Download size={14} /> Export
              </Button>
              <Button size="sm" onClick={onAdd}><Plus size={14} /> Record expense</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="From" className="w-36"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To" className="w-36"><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
              <select className="erp-input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="erp-input w-auto" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
                <option value="">All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{accountText(a)}</option>)}
              </select>
              <label className="flex h-11 items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled</label>
            </div>
            {!data ? (
              error ? <ErrorState message={error} onRetry={() => void reload()} /> : <Loading />
            ) : (
              <DataTable data={rows} columns={columns} getRowId={(r) => r.id} minWidth={880} pageSize={25} searchPlaceholder="Search description, number, machine, employee..." emptyTitle="No expenses in these dates" emptyDescription="Use “Record expense” to add one." />
            )}
          </CardContent>
        </Card>

        <Card className="finance-card">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="finance-card-heading">
              <span className="finance-step-badge finance-step-badge--3"><Receipt size={14} /></span>
              <h3 className="font-bold">Breakdown · {money(total)}</h3>
            </div>
            <div className="purchases-filters" role="tablist" aria-label="Break down by">
              {(["category", "machine", "employee"] as const).map((b) => (
                <button key={b} type="button" role="tab" aria-selected={breakdown === b} className={cn(breakdown === b && "is-active")} onClick={() => setBreakdown(b)}>
                  {b === "category" ? "Category" : b === "machine" ? "Machine" : "Staff"}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <p className="text-sm text-gray-500">{breakdown === "category" ? "No expenses in these dates." : breakdown === "machine" ? "No machine expenses in these dates." : "No money given to staff in these dates."}</p>
            ) : (
              <ul className="space-y-2">
                {list.map(([name, amount]) => (
                  <li key={name}>
                    {breakdown === "category" ? (
                      <button type="button" className="finance-bar" onClick={() => setCategory(name === category ? "" : name)} title={`Show ${name} only`}>
                        <span className="flex justify-between gap-2 text-sm"><span>{name}</span><b>{money(amount)}</b></span>
                        <span className="finance-bar__track" aria-hidden><span style={{ width: `${(amount / top) * 100}%` }} /></span>
                      </button>
                    ) : (
                      <div className="finance-bar">
                        <span className="flex justify-between gap-2 text-sm"><span className={cn(breakdown === "machine" && "font-mono font-semibold")}>{name}</span><b>{money(amount)}</b></span>
                        <span className="finance-bar__track" aria-hidden><span style={{ width: `${(amount / top) * 100}%` }} /></span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-gray-500">
              Machine expenses also show on each machine with its cost per KG; money given to staff on each employee&apos;s page. Profit by day, week, month and year is on <Link href="/finance" className="font-semibold text-[#1b3c55] underline">Finance</Link>.
            </p>
          </CardContent>
        </Card>
      </div>

      {cancelling && (
        <CancelExpenseDialog
          expense={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            void reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
