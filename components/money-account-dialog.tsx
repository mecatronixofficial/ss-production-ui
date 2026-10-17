"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Banknote, Building2, Lock, ShieldAlert, Smartphone, X } from "lucide-react";
import { api, ApiError, post } from "@/lib/api";
import { ACCOUNT_LABEL, encryptionProblem, type AccountType, type EncryptionStatus, type MoneyAccount } from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const TYPES: Array<{ value: AccountType; icon: typeof Banknote; hint: string }> = [
  { value: "CASH", icon: Banknote, hint: "Cash in hand / office cash" },
  { value: "BANK", icon: Building2, hint: "Current / savings account" },
  { value: "UPI", icon: Smartphone, hint: "UPI ID / wallet" },
];
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/**
 * Adds or edits a cash, bank or UPI account. The bank account number is sent once and stored encrypted; afterwards
 * only its last 4 digits come back, so editing leaves the field empty ("keep the saved number").
 */
export function MoneyAccountDialog({ account, onClose, onSaved }: { account?: MoneyAccount; onClose: () => void; onSaved: () => void }) {
  const editing = !!account;
  const [type, setType] = useState<AccountType>(account?.type ?? "BANK");
  const [form, setForm] = useState({
    name: account?.name ?? "",
    bankName: account?.bankName ?? "",
    branch: account?.branch ?? "",
    ifsc: account?.ifsc ?? "",
    accountHolder: account?.accountHolder ?? "",
    accountNo: "",
    accountNoAgain: "",
    upiId: account?.upiId ?? "",
    openingBalance: account?.openingBalance ? String(account.openingBalance) : "",
    notes: account?.notes ?? "",
    active: account?.active ?? true,
  });
  const [removeNo, setRemoveNo] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  // Whether this server can store account numbers (encryption key set and unchanged); the rest of the form works either way.
  const security = useApiQuery<EncryptionStatus>("/money/security");
  const numberProblem = encryptionProblem(security.data);
  const canStoreNo = !!security.data && !numberProblem;

  const submit = async () => {
    setError("");
    const accountNo = canStoreNo ? form.accountNo.replace(/[\s-]/g, "") : "";
    const ifsc = form.ifsc.trim().toUpperCase();
    const problem =
      !form.name.trim() ? "Give the account a name, e.g. SBI Current or Office cash." :
      type === "BANK" && !form.bankName.trim() ? "Enter the bank name." :
      type === "BANK" && ifsc && !IFSC.test(ifsc) ? "IFSC is 11 characters, like SBIN0001234." :
      type === "BANK" && accountNo && !/^[0-9]{6,18}$/.test(accountNo) ? "Account number is 6 to 18 digits." :
      type === "BANK" && accountNo !== form.accountNoAgain.replace(/[\s-]/g, "") ? "The two account numbers don't match." :
      type === "UPI" && !form.upiId.trim() ? "Enter the UPI ID." :
      type !== "CASH" && form.upiId.trim() && !UPI.test(form.upiId.trim()) ? "UPI ID looks like name@bank." :
      form.openingBalance && (form.openingBalance.split(".")[1] ?? "").length > 2 ? "Opening balance can have at most 2 decimals." :
      "";
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const body = {
        type,
        name: form.name.trim(),
        notes: form.notes.trim() || null,
        openingBalance: form.openingBalance.trim() ? toNumber(form.openingBalance) : 0,
        ...(type !== "CASH" ? { bankName: form.bankName.trim() || null, upiId: form.upiId.trim() || null } : {}),
        ...(type === "BANK"
          ? { branch: form.branch.trim() || null, ifsc: ifsc || null, accountHolder: form.accountHolder.trim() || null, ...(accountNo ? { accountNo } : removeNo ? { accountNo: null } : {}) }
          : {}),
        ...(editing ? { active: form.active } : {}),
      };
      await api(editing ? `/money/accounts/${account.id}` : "/money/accounts", { ...post(body, editing ? "PATCH" : "POST"), silent: true });
      toast.success(editing ? `${body.name} updated.` : `${body.name} added.`);
      onSaved();
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
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{editing ? `Edit ${account.name}` : "Add account"}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <form
            className="users-dialog__body"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="money-modes" role="radiogroup" aria-label="Account type">
              {TYPES.map(({ value, icon: Icon, hint }) => (
                <button key={value} type="button" role="radio" aria-checked={type === value} className={cn("money-mode", type === value && "is-active")} onClick={() => setType(value)}>
                  <Icon size={18} aria-hidden />
                  <span className="font-semibold">{ACCOUNT_LABEL[value]}</span>
                  <span className="text-[10px] text-gray-500">{hint}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Account name">
                <Input value={form.name} maxLength={80} placeholder={type === "CASH" ? "Office cash" : type === "BANK" ? "SBI Current" : "PhonePe business"} onChange={set("name")} />
              </Field>
              <Field label="Opening balance" hint="₹ when added">
                <Input type="number" step="0.01" value={form.openingBalance} onChange={set("openingBalance")} placeholder="0.00" />
              </Field>
            </div>

            {type === "BANK" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Bank name"><Input value={form.bankName} maxLength={80} placeholder="State Bank of India" onChange={set("bankName")} /></Field>
                  <Field label="Branch" hint="Optional"><Input value={form.branch} maxLength={80} onChange={set("branch")} /></Field>
                  <Field label="Account holder" hint="Optional"><Input value={form.accountHolder} maxLength={120} onChange={set("accountHolder")} /></Field>
                  <Field label="IFSC" hint="Optional"><Input value={form.ifsc} maxLength={11} className="uppercase" placeholder="SBIN0001234" onChange={set("ifsc")} /></Field>
                </div>
                <fieldset className="money-secure">
                  <legend><Lock size={13} aria-hidden /> Account number · stored encrypted</legend>
                  {editing && account.hasAccountNo && (
                    <p className="text-xs text-gray-600">
                      Saved: <b className="font-mono">{account.accountNoMasked}</b>. Leave empty to keep it.
                      <label className="ml-2 inline-flex items-center gap-1"><input type="checkbox" checked={removeNo} onChange={(e) => setRemoveNo(e.target.checked)} /> Remove it</label>
                    </p>
                  )}
                  {numberProblem && (
                    <p className="money-note money-note--warn" role="status"><ShieldAlert size={14} className="mr-1 inline align-[-2px]" aria-hidden />{numberProblem}</p>
                  )}
                  {security.error && <p className="money-note money-note--warn">Could not check whether account numbers can be saved: {security.error}</p>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={editing && account.hasAccountNo ? "New account number" : "Account number"} hint={canStoreNo ? "Optional" : "Not available"}>
                      <Input value={form.accountNo} inputMode="numeric" autoComplete="off" maxLength={22} onChange={set("accountNo")} disabled={removeNo || !canStoreNo} />
                    </Field>
                    <Field label="Type it again">
                      <Input value={form.accountNoAgain} inputMode="numeric" autoComplete="off" maxLength={22} onChange={set("accountNoAgain")} onPaste={(e) => e.preventDefault()} disabled={removeNo || !canStoreNo} />
                    </Field>
                  </div>
                  <p className="text-[11px] text-gray-500">Only the last 4 digits are shown in the ERP. A super admin can see the full number; each time is recorded in the audit log.</p>
                </fieldset>
              </>
            )}

            {type !== "CASH" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="UPI ID" hint={type === "BANK" ? "Optional, linked to this account" : undefined}>
                  <Input value={form.upiId} maxLength={120} placeholder="business@okaxis" onChange={set("upiId")} />
                </Field>
                {type === "UPI" && <Field label="App / bank" hint="Optional"><Input value={form.bankName} maxLength={80} placeholder="PhonePe" onChange={set("bankName")} /></Field>}
              </div>
            )}

            <Field label="Notes" hint="Optional"><Input value={form.notes} maxLength={300} onChange={set("notes")} /></Field>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active <span className="text-xs text-gray-500">(an inactive account keeps its history but can&apos;t be used for new entries)</span>
              </label>
            )}
            {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
            <div className="users-dialog__foot">
              <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Add account"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
