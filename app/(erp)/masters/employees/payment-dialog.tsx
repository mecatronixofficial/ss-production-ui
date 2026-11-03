"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { api, post } from "@/lib/api";
import { dayIso, STAFF_PAY_KINDS, WAGES_CATEGORY, type Expense, type MoneyContext, type StaffPayKind } from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, formatDate, money, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { PaidFromFields, usePaidFrom } from "@/components/expense-dialog";
import { KnitDialog } from "../machines/knit-dialog";
import { decimals } from "../machines/types";

/**
 * Money given to an employee on a day: a daily wage, salary, advance, overtime, bonus or other. It is a Wages expense
 * paid from a cash / bank / UPI account, so it counts on Money and Finance and shows on the employee's page.
 */
export function EmployeePaymentDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: { id: string; code: string; name: string };
  onClose: () => void;
  onSaved: (expense: Expense) => void;
}) {
  const ctx = useApiQuery<MoneyContext>("/money/context");
  const paid = usePaidFrom(ctx.data?.accounts ?? []);
  const [f, setF] = useState({ kind: "Daily wage" as StaffPayKind, amount: "", date: todayInput(), note: "" });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amount = toNumber(f.amount);

  const save = async () => {
    setError("");
    const problem = !(amount > 0) ? "Enter the amount given." : decimals(f.amount) > 2 ? "Amount can have at most 2 decimals." : paid.problem;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const expense = await api<Expense>("/money/expenses", {
        silent: true,
        ...post({
          category: WAGES_CATEGORY,
          subcategory: f.kind,
          description: f.note.trim() || `${f.kind} · ${employee.name} (${employee.code}) · ${formatDate(`${f.date}T12:00:00`)}`,
          amount,
          paymentMode: paid.mode,
          accountId: paid.account || undefined,
          expenseDate: dayIso(f.date),
          employeeId: employee.id,
        }),
      });
      toast.success(`${expense.expenseNo}: ${money(amount)} ${f.kind.toLowerCase()} given to ${employee.name}.`);
      onSaved(expense);
    } catch (e) {
      setError(errorMessage(e, "Could not save the payment"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={HandCoins}
      title={`Give money to ${employee.name}`}
      caption={`${employee.code}. Recorded on the day it is given, as a Wages expense from the account it came from, so it counts on Money and Finance.`}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <p className="mr-auto text-sm">{amount > 0 ? <>Giving <strong>{money(amount)}</strong> on {formatDate(`${f.date}T12:00:00`)}</> : null}</p>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy || !ctx.data}>{busy ? "Saving…" : "Save payment"}</Button>
        </>
      }
    >
      {!ctx.data ? (
        ctx.error ? <p className="knit-alert is-error">{ctx.error}</p> : <Loading />
      ) : (
        <>
          {error && <p className="knit-alert is-error" role="alert">{error}</p>}
          <div>
            <span className="erp-label">For</span>
            <div className="knit-kinds" role="radiogroup" aria-label="For">
              {STAFF_PAY_KINDS.map((k) => (
                <button key={k.kind} type="button" role="radio" aria-checked={f.kind === k.kind} className={cn(f.kind === k.kind && "is-active")} onClick={() => set({ kind: k.kind })}>
                  <strong>{k.kind}</strong>
                  <span>{k.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" hint="₹"><Input type="number" inputMode="decimal" min="0.01" step="0.01" value={f.amount} autoFocus onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field label="Given on"><Input type="date" max={todayInput()} value={f.date} onChange={(e) => set({ date: e.target.value || todayInput() })} /></Field>
            <PaidFromFields paid={paid} />
          </div>
          <Field label="Note" hint="Optional"><Input value={f.note} maxLength={300} placeholder={f.kind === "Daily wage" ? "e.g. day shift on KN-02" : f.kind === "Advance" ? "e.g. advance against October salary" : "Optional"} onChange={(e) => set({ note: e.target.value })} /></Field>
        </>
      )}
    </KnitDialog>
  );
}
