"use client";

import { useState } from "react";
import { Wrench } from "lucide-react";
import { api, post } from "@/lib/api";
import { dayIso, MACHINE_EXPENSE_TYPES, type Expense, type MachineExpenseType, type MoneyContext } from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, money, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { PaidFromFields, usePaidFrom } from "@/components/expense-dialog";
import { KnitDialog } from "./knit-dialog";
import { decimals, type KnitMachine } from "./types";

/** "October 2026" */
export const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

const amountProblem = (value: string) => (!(toNumber(value) > 0) ? "Enter the amount." : decimals(value) > 2 ? "Amount can have at most 2 decimals." : "");

/**
 * Money spent on a machine: repair, spares, needles, oil, service, power. It is an expense paid from a cash / bank /
 * UPI account (on Money and Finance under its category) and shows on the machine with its cost per KG knitted.
 */
export function MachineExpenseDialog({ machines, machineId, onClose, onSaved }: { machines: KnitMachine[]; machineId?: string; onClose: () => void; onSaved: (expense: Expense) => void }) {
  const ctx = useApiQuery<MoneyContext>("/money/context");
  const paid = usePaidFrom(ctx.data?.accounts ?? []);
  const [f, setF] = useState({ machineId: machineId ?? machines[0]?.id ?? "", type: "Repair" as MachineExpenseType, amount: "", date: todayInput(), description: "" });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = MACHINE_EXPENSE_TYPES.find((t) => t.type === f.type)!;
  const machine = machines.find((m) => m.id === f.machineId);

  const save = async () => {
    setError("");
    const problem = !machine ? "Choose the machine." : amountProblem(f.amount) || paid.problem;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const expense = await api<Expense>("/money/expenses", {
        silent: true,
        ...post({
          category: kind.category,
          subcategory: kind.type,
          description: f.description.trim() || undefined,
          amount: toNumber(f.amount),
          paymentMode: paid.mode,
          accountId: paid.account || undefined,
          expenseDate: dayIso(f.date),
          machineId: machine!.id,
        }),
      });
      toast.success(`${expense.expenseNo}: ${kind.type} on ${machine!.code}, ${money(expense.amount)}.`);
      onSaved(expense);
    } catch (e) {
      setError(errorMessage(e, "Could not save the expense"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KnitDialog
      icon={Wrench}
      tone="gold"
      title={machine ? `Expense on ${machine.code}` : "Machine expense"}
      caption="Repair, spares, needles, oil, service or power for one machine. It is paid from an account and counts on Money and Finance."
      busy={busy}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="knit-btn" disabled={busy || !ctx.data}>{busy ? "Saving…" : "Save expense"}</Button>
        </>
      }
    >
      {!ctx.data ? (
        ctx.error ? <p className="knit-alert is-error">{ctx.error}</p> : <Loading />
      ) : (
        <>
          {error && <p className="knit-alert is-error" role="alert">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Machine">
              <select className="erp-input" value={f.machineId} onChange={(e) => set({ machineId: e.target.value })} disabled={!!machineId}>
                {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
              </select>
            </Field>
            <Field label="Date"><Input type="date" max={todayInput()} value={f.date} onChange={(e) => set({ date: e.target.value || todayInput() })} /></Field>
          </div>
          <div>
            <span className="erp-label">What for</span>
            <div className="knit-kinds" role="radiogroup" aria-label="What for">
              {MACHINE_EXPENSE_TYPES.map((t) => (
                <button key={t.type} type="button" role="radio" aria-checked={f.type === t.type} className={cn(f.type === t.type && "is-active")} onClick={() => set({ type: t.type })}>
                  <strong>{t.type}</strong>
                  <span>{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" hint="₹"><Input type="number" inputMode="decimal" min="0.01" step="0.01" value={f.amount} autoFocus onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field label="Details" hint="Optional"><Input value={f.description} maxLength={300} placeholder={f.type === "Repair" ? "e.g. cam box repair, mechanic Raju" : "e.g. 500 needles VOTA 24G"} onChange={(e) => set({ description: e.target.value })} /></Field>
            <PaidFromFields paid={paid} />
          </div>
          <p className="text-xs text-gray-500">Counted on Finance as {kind.category}.</p>
        </>
      )}
    </KnitDialog>
  );
}
