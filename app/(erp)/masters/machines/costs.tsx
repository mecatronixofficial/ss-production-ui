"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Plus, Wrench, XCircle } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { expenseModeLabel, type Expense } from "@/lib/money";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { CancelExpenseDialog } from "../../money/dialogs";
import { MachineExpenseDialog, monthLabel } from "./money-dialogs";
import { localMonth, machineHref, monthKg, type KnitMachine, type KnitRun } from "./types";

/** The ISO range of a YYYY-MM month in local time, for `/money/expenses?from=&to=`. */
function monthRange(month: string) {
  const from = new Date(`${month}-01T00:00:00`);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  to.setMilliseconds(-1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  return (
    <Input type="month" aria-label="Month" className="w-auto" max={localMonth()} value={value} onChange={(e) => onChange(e.target.value || localMonth())} />
  );
}

/** Horizontal share bars: label, amount, and its part of the biggest. */
function ShareBars({ rows }: { rows: Array<[string, number]> }) {
  const top = Math.max(...rows.map(([, v]) => v), 0);
  return (
    <ul className="space-y-2">
      {rows.map(([label, value]) => (
        <li key={label}>
          <div className="flex items-baseline justify-between gap-2 text-xs"><span className="font-semibold text-gray-700">{label}</span><span className="font-bold text-[#0f2a24]">{money(value)}</span></div>
          <div className="knit-sharebar mt-1"><span style={{ width: `${top > 0 ? (value / top) * 100 : 0}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Money spent on machines in a month: totals by type and by machine with the cost per KG they knitted, and every
 * entry (cancel a wrong one). With `machineId`, one machine only (its own page).
 */
export function MachineExpensesView({ machines, runs, machineId }: { machines: KnitMachine[]; runs: KnitRun[]; machineId?: string }) {
  const [month, setMonth] = useState(localMonth());
  const range = monthRange(month);
  const path = `/money/expenses?${new URLSearchParams({ ...(machineId ? { machineId } : { scope: "machines" }), from: range.from, to: range.to })}`;
  const query = useApiQuery<Expense[]>(path);
  const [adding, setAdding] = useState<{ machineId?: string } | null>(null);
  const [cancelling, setCancelling] = useState<Expense | null>(null);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const byType = [...rows.reduce((map, r) => map.set(r.subcategory ?? r.category, (map.get(r.subcategory ?? r.category) ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const scoped = machineId ? machines.filter((m) => m.id === machineId) : machines;
  const perMachine = scoped
    .map((m) => {
      const spent = rows.filter((r) => r.machine?.id === m.id).reduce((sum, r) => sum + r.amount, 0);
      const knitted = monthKg(runs.filter((r) => r.machine.id === m.id), month);
      return { machine: m, spent, knitted, count: rows.filter((r) => r.machine?.id === m.id).length };
    })
    .sort((a, b) => b.spent - a.spent || a.machine.code.localeCompare(b.machine.code));
  const knittedAll = perMachine.reduce((sum, r) => sum + r.knitted, 0);

  const exportRows = () =>
    downloadCsv(
      `machine-expenses-${month}${machineId ? `-${scoped[0]?.code ?? ""}` : ""}.csv`,
      ["Expense no", "Date", "Machine", "Type", "Category", "Details", "Paid by", "Account", "Amount"],
      rows.map((r) => [r.expenseNo, r.expenseDate.slice(0, 10), r.machine?.code ?? "", r.subcategory ?? "", r.category, r.description ?? "", expenseModeLabel(r.paymentMode), r.account?.name ?? "", r.amount.toFixed(2)]),
    );

  return (
    <section className="knit-card">
      <div className="knit-card__head">
        <div>
          <p className="knit-card__eyebrow">Running costs</p>
          <h2 className="knit-card__title">Machine expenses · {monthLabel(month)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker value={month} onChange={setMonth} />
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={exportRows}><Download size={14} /> Export CSV</Button>
          <Button size="sm" className="knit-btn" disabled={!scoped.length} onClick={() => setAdding({ machineId })}><Plus size={14} /> Add expense</Button>
        </div>
      </div>
      <div className="space-y-4 p-4">
        {!query.data ? (
          query.error ? <p className="knit-alert is-error">{query.error}</p> : <Loading />
        ) : (
          <>
            <div className="knit-kpis">
              <div className="knit-kpi"><p>Spent this month</p><strong>{money(total)}</strong><span>{rows.length} expense{rows.length === 1 ? "" : "s"}</span></div>
              <div className="knit-kpi"><p>Fabric knitted</p><strong>{kg(knittedAll)}</strong><span>{machineId ? "on this machine" : "on all machines"}</span></div>
              <div className="knit-kpi"><p>Cost per KG</p><strong>{knittedAll > 0 ? money(total / knittedAll) : "—"}</strong><span>machine expenses ÷ KG knitted</span></div>
              <div className="knit-kpi"><p>Biggest</p><strong>{byType[0] ? byType[0][0] : "—"}</strong><span>{byType[0] ? money(byType[0][1]) : "Nothing spent"}</span></div>
            </div>

            {rows.length > 0 && (
              <div className={cn("grid gap-4", !machineId && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]")}>
                <div className="knit-panel">
                  <p className="knit-panel__title">By type</p>
                  <ShareBars rows={byType} />
                </div>
                {!machineId && (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="knit-table w-full min-w-[520px] text-sm">
                      <thead><tr><th>Machine</th><th className="text-right">Spent</th><th className="text-right">Knitted</th><th className="text-right">Per KG</th><th /></tr></thead>
                      <tbody>
                        {perMachine.filter((r) => r.spent > 0 || r.knitted > 0).map((r) => (
                          <tr key={r.machine.id}>
                            <td><Link href={machineHref(r.machine.id)} className="font-mono font-bold text-[#0f2a24] hover:underline">{r.machine.code}</Link><span className="block text-xs text-gray-500">{r.count} expense{r.count === 1 ? "" : "s"}</span></td>
                            <td className="text-right font-semibold">{money(r.spent)}</td>
                            <td className="text-right">{kg(r.knitted)}</td>
                            <td className="text-right text-xs text-gray-600">{r.knitted > 0 ? money(r.spent / r.knitted) : "—"}</td>
                            <td className="text-right"><button type="button" className="knit-icon-btn" aria-label={`Add expense on ${r.machine.code}`} title="Add expense" onClick={() => setAdding({ machineId: r.machine.id })}><Plus size={14} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {rows.length === 0 ? (
              <div className="knit-empty">
                <Wrench size={22} />
                <p className="font-bold text-gray-900">No machine expense in {monthLabel(month)}</p>
                <p className="text-sm text-gray-500">Record repairs, spares, needles, oil, service and power against the machine they were for.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="knit-table w-full min-w-[820px] text-sm">
                  <thead><tr><th>Date</th><th>Machine</th><th>Type</th><th>Details</th><th>Paid from</th><th className="text-right">Amount</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap">{formatDate(r.expenseDate)}<span className="block font-mono text-[11px] text-gray-400">{r.expenseNo}</span></td>
                        <td className="font-mono font-bold">{r.machine?.code ?? "—"}</td>
                        <td><span className="knit-chip">{r.subcategory ?? r.category}</span></td>
                        <td className="text-xs text-gray-600">{r.description ?? ""}</td>
                        <td className="text-xs text-gray-600">{expenseModeLabel(r.paymentMode)}{r.account ? ` · ${r.account.name}` : ""}</td>
                        <td className="text-right font-bold">{money(r.amount)}</td>
                        <td className="text-right"><button type="button" className="knit-icon-btn" aria-label={`Cancel ${r.expenseNo}`} title="Cancel this expense" onClick={() => setCancelling(r)}><XCircle size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={5}>Total</td><td className="text-right">{money(total)}</td><td /></tr></tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <MachineExpenseDialog
          machines={scoped}
          machineId={adding.machineId}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            void query.reload();
          }}
        />
      )}
      {cancelling && <CancelExpenseDialog expense={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void query.reload(); }} />}
    </section>
  );
}
