"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { api, ApiError, post } from "@/lib/api";
import {
  ACCOUNT_LABEL,
  ACCOUNT_TYPES_FOR,
  accountText,
  dayIso,
  EXPENSE_CATEGORIES,
  MACHINE_EXPENSE_TYPES,
  MODE_LABEL,
  MODES,
  STAFF_PAY_KINDS,
  WAGES_CATEGORY,
  type Expense,
  type MoneyAccount,
  type MoneyContext,
  type PaymentMode,
} from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, money, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";

/**
 * How an expense was paid and from which account, with the server's rule (cash from a cash account, UPI from a UPI
 * or bank account…). `account` is the one to send: the chosen one, or the only one that fits.
 */
export function usePaidFrom(accounts: MoneyAccount[]) {
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [accountId, setAccountId] = useState("");
  const choices = accounts.filter((a) => a.active !== false && ACCOUNT_TYPES_FOR[mode].includes(a.type));
  const account = accountId && choices.some((a) => a.id === accountId) ? accountId : choices.length === 1 ? choices[0].id : "";
  const problem = choices.length > 0 && !account ? "Choose the account it was paid from." : "";
  return { mode, setMode, account, setAccountId, choices, problem };
}

/** The "Paid by" mode buttons and "Paid from account" select for `usePaidFrom`. */
export function PaidFromFields({ paid }: { paid: ReturnType<typeof usePaidFrom> }) {
  const { mode, setMode, account, setAccountId, choices } = paid;
  return (
    <>
      <Field label="Paid by">
        <div className="money-segment money-segment--4" role="radiogroup" aria-label="Paid by">
          {MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={cn(mode === m && "is-active")} onClick={() => setMode(m)}>{m === "BANK" ? "Bank" : MODE_LABEL[m]}</button>
          ))}
        </div>
      </Field>
      <Field label="Paid from account" hint={ACCOUNT_TYPES_FOR[mode].map((t) => ACCOUNT_LABEL[t]).join(" / ")}>
        <select className="erp-input" value={account} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{choices.length ? "Select account" : "No matching account"}</option>
          {choices.map((a) => <option key={a.id} value={a.id}>{ACCOUNT_LABEL[a.type]} · {accountText(a)}</option>)}
        </select>
      </Field>
      {choices.length === 0 && (
        <p className="money-note money-note--warn sm:col-span-2">
          No account for {MODE_LABEL[mode].toLowerCase()} yet, so this won&apos;t lower any balance. <Link href="/money?tab=accounts" className="font-semibold underline">Add an account</Link>.
        </p>
      )}
    </>
  );
}

type ExpenseFor = "general" | "machine" | "employee";
const FOR_OPTIONS: Array<{ value: ExpenseFor; label: string; hint: string }> = [
  { value: "general", label: "General", hint: "Power, rent, transport…" },
  { value: "machine", label: "A machine", hint: "Repair, spares, needles…" },
  { value: "employee", label: "An employee", hint: "Wage, salary, advance…" },
];

/**
 * Records an expense paid from a cash, bank or UPI account (its balance goes down by the amount). It can be for a
 * machine (counted on that machine and as machine expenses on Finance) or given to an employee (on their page, under
 * Wages), or general.
 */
export function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: (expense: Expense) => void }) {
  const ctx = useApiQuery<MoneyContext>("/money/context");
  const [form, setForm] = useState({
    for: "general" as ExpenseFor,
    category: "Power",
    machineId: "",
    machineType: MACHINE_EXPENSE_TYPES[0].type as string,
    employeeId: "",
    payKind: STAFF_PAY_KINDS[0].kind as string,
    description: "",
    amount: "",
    expenseDate: todayInput(),
  });
  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }));
  const paid = usePaidFrom(ctx.data?.accounts ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const machines = ctx.data?.machines ?? [];
  const employees = ctx.data?.employees ?? [];
  const machine = machines.find((m) => m.id === form.machineId);
  const employee = employees.find((e) => e.id === form.employeeId);
  const machineKind = MACHINE_EXPENSE_TYPES.find((t) => t.type === form.machineType) ?? MACHINE_EXPENSE_TYPES[0];
  // The category it is counted under: machine expenses by their type, money to staff as Wages.
  const category = form.for === "machine" ? machineKind.category : form.for === "employee" ? WAGES_CATEGORY : form.category;

  const submit = async () => {
    setError("");
    const amount = toNumber(form.amount);
    const problem =
      form.for === "machine" && !machine ? "Choose the machine." :
      form.for === "employee" && !employee ? "Choose the employee." :
      !category.trim() ? "Choose a category." :
      amount <= 0 ? "Enter the amount." :
      (form.amount.split(".")[1] ?? "").length > 2 ? "Amount can have at most 2 decimals." :
      paid.problem;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const expense = await api<Expense>("/money/expenses", {
        silent: true,
        ...post({
          category: category.trim(),
          subcategory: form.for === "machine" ? machineKind.type : form.for === "employee" ? form.payKind : undefined,
          description: form.description.trim() || undefined,
          amount,
          paymentMode: paid.mode,
          accountId: paid.account || undefined,
          expenseDate: dayIso(form.expenseDate),
          machineId: form.for === "machine" ? machine!.id : undefined,
          employeeId: form.for === "employee" ? employee!.id : undefined,
        }),
      });
      const target = form.for === "machine" ? ` on ${machine!.code}` : form.for === "employee" ? ` to ${employee!.name}` : "";
      toast.success(`${expense.expenseNo}: ${form.for === "general" ? category : form.for === "machine" ? machineKind.type : form.payKind} ${money(amount)}${target} recorded.`);
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
              <Field label="For">
                <div className="money-segment money-segment--3" role="radiogroup" aria-label="Expense for">
                  {FOR_OPTIONS.map((o) => (
                    <button key={o.value} type="button" role="radio" aria-checked={form.for === o.value} title={o.hint} className={cn(form.for === o.value && "is-active")} onClick={() => set({ for: o.value })}>{o.label}</button>
                  ))}
                </div>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                {form.for === "general" && (
                  <Field label="Category">
                    <select className="erp-input" value={form.category} onChange={(e) => set({ category: e.target.value })}>
                      {EXPENSE_CATEGORIES.filter((c) => c !== WAGES_CATEGORY).map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                )}
                {form.for === "machine" && (
                  <>
                    <Field label="Machine">
                      <select className="erp-input" value={form.machineId} onChange={(e) => set({ machineId: e.target.value })}>
                        <option value="">{machines.length ? "Select machine" : "No machines"}</option>
                        {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
                      </select>
                    </Field>
                    <Field label="What for" hint={`Counted as ${machineKind.category}`}>
                      <select className="erp-input" value={form.machineType} onChange={(e) => set({ machineType: e.target.value })}>
                        {MACHINE_EXPENSE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type} · {t.hint}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                {form.for === "employee" && (
                  <>
                    <Field label="Employee">
                      <select className="erp-input" value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
                        <option value="">{employees.length ? "Select employee" : "No active employees"}</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.code} · {e.department}</option>)}
                      </select>
                    </Field>
                    <Field label="Given as" hint="Counted as Wages">
                      <select className="erp-input" value={form.payKind} onChange={(e) => set({ payKind: e.target.value })}>
                        {STAFF_PAY_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.kind} · {k.hint}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                <Field label="Date">
                  <Input type="date" max={todayInput()} value={form.expenseDate} onChange={(e) => set({ expenseDate: e.target.value || todayInput() })} />
                </Field>
                <Field label="Amount" hint="₹">
                  <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} autoFocus onChange={(e) => set({ amount: e.target.value })} />
                </Field>
                <PaidFromFields paid={paid} />
              </div>
              <Field label="Description" hint="Optional">
                <Input
                  value={form.description}
                  maxLength={300}
                  placeholder={form.for === "machine" ? "e.g. cam box repair, 500 needles VOTA 24G" : form.for === "employee" ? "e.g. day shift on KN-02, advance for October" : "e.g. EB bill September, diesel for generator"}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </Field>
              <p className="text-xs text-gray-500">
                {form.for === "machine"
                  ? "Shows on the machine with its cost per KG knitted, and as machine expenses on Finance."
                  : form.for === "employee"
                    ? "Shows on the employee's page day by day, and as money paid to staff on Finance."
                    : "Costs of one production batch (transport, extra processing) go on that batch in Production, so its profit stays right."}
              </p>
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
