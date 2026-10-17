"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Download, Plus, Receipt, Undo2 } from "lucide-react";
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

/** Money page → Expenses: record, filter, see by category, and cancel a wrong one. Analysis by period is on Finance. */
export function ExpensesTab({ accounts, version, onAdd, onChanged }: { accounts: MoneyAccount[]; version: number; onAdd: () => void; onChanged: () => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayInput());
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelling, setCancelling] = useState<Expense | null>(null);

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

  const rows = data ?? [];
  const live = rows.filter((r) => !r.cancelledAt);
  const total = live.reduce((s, r) => s + r.amount, 0);
  const byCategory = [...live.reduce((map, r) => map.set(r.category, (map.get(r.category) ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const top = byCategory[0]?.[1] ?? 0;
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...rows.map((r) => r.category)])];

  const columns: ColumnDef<Expense>[] = [
    { header: "Date", id: "date", accessorFn: (r) => r.expenseDate, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.expenseDate)}<span className="block font-mono text-[11px] text-gray-400">{row.original.expenseNo}</span></span> },
    { header: "Category", accessorKey: "category", cell: ({ row }) => <Badge tone={row.original.cancelledAt ? "default" : "info"}>{row.original.category}</Badge> },
    {
      header: "Description",
      id: "description",
      accessorFn: (r) => r.description ?? "",
      cell: ({ row }) => (
        <div className="max-w-[18rem]">
          <p className="truncate">{row.original.description || <span className="text-gray-400">—</span>}</p>
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
    <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="finance-card finance-card--register">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="finance-card-heading">
            <span className="finance-step-badge finance-step-badge--5"><ClipboardList size={14} /></span>
            <h3 className="font-bold">Expenses</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `expenses-${from || "all"}-${to || todayInput()}.csv`,
                  ["No", "Date", "Category", "Description", "Paid by", "Account", "Amount", "Entered by", "Cancelled"],
                  rows.map((r) => [r.expenseNo, r.expenseDate.slice(0, 10), r.category, r.description, expenseModeLabel(r.paymentMode), r.account?.name, r.amount.toFixed(2), r.createdBy, r.cancelledAt ? `${r.cancelledAt.slice(0, 10)} ${r.cancelReason ?? ""}` : ""]),
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
            <DataTable data={rows} columns={columns} getRowId={(r) => r.id} minWidth={760} pageSize={25} searchPlaceholder="Search description, number..." emptyTitle="No expenses in these dates" emptyDescription="Use “Record expense” to add one." />
          )}
        </CardContent>
      </Card>

      <Card className="finance-card">
        <CardHeader className="flex items-center justify-between gap-3">
          <div className="finance-card-heading">
            <span className="finance-step-badge finance-step-badge--3"><Receipt size={14} /></span>
            <h3 className="font-bold">By category · {money(total)}</h3>
          </div>
        </CardHeader>
        <CardContent>
          {byCategory.length === 0 ? (
            <p className="text-sm text-gray-500">No expenses in these dates.</p>
          ) : (
            <ul className="space-y-2">
              {byCategory.map(([name, amount]) => (
                <li key={name}>
                  <button type="button" className="finance-bar" onClick={() => setCategory(name === category ? "" : name)} title={`Show ${name} only`}>
                    <span className="flex justify-between gap-2 text-sm"><span>{name}</span><b>{money(amount)}</b></span>
                    <span className="finance-bar__track" aria-hidden><span style={{ width: `${(amount / top) * 100}%` }} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-gray-500">For month-by-month analysis and profit, open Finance.</p>
        </CardContent>
      </Card>

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
