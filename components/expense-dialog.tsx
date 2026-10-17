"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { api, ApiError, post } from "@/lib/api";
import { ACCOUNT_LABEL, ACCOUNT_TYPES_FOR, accountText, dayIso, EXPENSE_CATEGORIES, MODE_LABEL, MODES, type Expense, type MoneyContext, type PaymentMode } from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, money, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";

/** Records an expense paid from a cash, bank or UPI account (its balance goes down by the amount). */
export function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: (expense: Expense) => void }) {
  const ctx = useApiQuery<MoneyContext>("/money/context");
  const [form, setForm] = useState({ category: "Power", description: "", amount: "", expenseDate: todayInput() });
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const accounts = ctx.data?.accounts ?? [];
  const choices = accounts.filter((a) => ACCOUNT_TYPES_FOR[mode].includes(a.type));
  const chosen = accountId && choices.some((a) => a.id === accountId) ? accountId : choices.length === 1 ? choices[0].id : "";

  const submit = async () => {
    setError("");
    const amount = toNumber(form.amount);
    const problem =
      !form.category.trim() ? "Choose a category." :
      amount <= 0 ? "Enter the amount." :
      (form.amount.split(".")[1] ?? "").length > 2 ? "Amount can have at most 2 decimals." :
      choices.length > 0 && !chosen ? "Choose the account it was paid from." :
      "";
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const expense = await api<Expense>("/money/expenses", {
        silent: true,
        ...post({
          category: form.category.trim(),
          description: form.description.trim() || undefined,
          amount,
          paymentMode: mode,
          accountId: chosen || undefined,
          expenseDate: dayIso(form.expenseDate),
        }),
      });
      toast.success(`${expense.expenseNo}: ${form.category} ${money(amount)} recorded.`);
      onSaved?.(expense);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog money-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">Record expense</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          {!ctx.data ? (
            <div className="users-dialog__body pb-4">{ctx.error ? <p className="text-sm text-red-600">{ctx.error}</p> : <Loading />}</div>
          ) : (
            <form className="users-dialog__body" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <select className="erp-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Date">
                  <Input type="date" max={todayInput()} value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value || todayInput() })} />
                </Field>
                <Field label="Amount" hint="₹">
                  <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} autoFocus onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </Field>
                <Field label="Paid by">
                  <div className="money-segment money-segment--4" role="radiogroup" aria-label="Paid by">
                    {MODES.map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={mode === m} className={cn(mode === m && "is-active")} onClick={() => setMode(m)}>{m === "BANK" ? "Bank" : MODE_LABEL[m]}</button>
                    ))}
                  </div>
                </Field>
              </div>
              <Field label="Paid from account" hint={ACCOUNT_TYPES_FOR[mode].map((t) => ACCOUNT_LABEL[t]).join(" / ")}>
                <select className="erp-input" value={chosen} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">{choices.length ? "Select account" : "No matching account"}</option>
                  {choices.map((a) => <option key={a.id} value={a.id}>{ACCOUNT_LABEL[a.type]} · {accountText(a)}</option>)}
                </select>
              </Field>
              {choices.length === 0 && (
                <p className="money-note money-note--warn">
                  No account for {MODE_LABEL[mode].toLowerCase()} yet, so this expense won&apos;t lower any balance. <Link href="/money?tab=accounts" className="font-semibold underline">Add an account</Link>.
                </p>
              )}
              <Field label="Description" hint="Optional">
                <Input value={form.description} maxLength={300} placeholder="e.g. EB bill September, spare needles for KN-02" onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <p className="text-xs text-gray-500">Costs of one production batch (transport, extra processing) go on that batch in Production, so its profit stays right.</p>
              {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
              <div className="users-dialog__foot">
                <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save expense"}</Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
