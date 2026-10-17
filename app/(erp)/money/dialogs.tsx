"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDownCircle, ArrowUpCircle, Ban, CheckCircle2, Download, Landmark, Undo2, X } from "lucide-react";
import { api, ApiError, post, qs } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import {
  ACCOUNT_LABEL,
  accountText,
  chequeLabel,
  chequeTone,
  dayIso,
  isOpenCheque,
  KIND_LABEL,
  MODE_LABEL,
  PARTY_TYPE_LABEL,
  expenseModeLabel,
  type Cashbook,
  type Expense,
  type MoneyAccount,
  type MoneyTxn,
  type PartyType,
  type Statement,
} from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, formatDate, formatDateTime, money, todayInput } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { MoneyEntryDialog } from "@/components/money-entry-dialog";

function Shell({ title, wide, busy, onClose, children }: { title: React.ReactNode; wide?: boolean; busy?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className={cn("users-dialog money-dialog", wide && "money-dialog--wide")} aria-describedby={undefined}>
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{title}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type ChequeAction = "DEPOSIT" | "CLEAR" | "BOUNCE";
const ACTION_TITLE: Record<ChequeAction, string> = { DEPOSIT: "Deposit cheque", CLEAR: "Mark cheque cleared", BOUNCE: "Mark cheque bounced" };

/** Deposit a received cheque into a bank, or mark any open cheque cleared / bounced. */
export function ChequeActionDialog({ txn, action, accounts, onClose, onDone }: { txn: MoneyTxn; action: ChequeAction; accounts: MoneyAccount[]; onClose: () => void; onDone: () => void }) {
  const needsBank = txn.kind === "RECEIPT" && (action === "DEPOSIT" || (action === "CLEAR" && !txn.account));
  const banks = accounts.filter((a) => a.active && a.type === "BANK");
  const [date, setDate] = useState(todayInput());
  const [accountId, setAccountId] = useState(banks.length === 1 ? banks[0].id : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (needsBank && !accountId) return setError("Choose the bank account it was deposited into.");
    if (action === "BOUNCE" && !reason.trim()) return setError("Say why it bounced (e.g. insufficient funds).");
    setBusy(true);
    try {
      await api(`/money/transactions/${txn.id}/cheque`, { ...post({ action, date: dayIso(date), accountId: needsBank ? accountId : undefined, reason: action === "BOUNCE" ? reason.trim() : undefined }), silent: true });
      toast.success(action === "DEPOSIT" ? `Cheque ${txn.chequeNo} deposited.` : action === "CLEAR" ? `Cheque ${txn.chequeNo} cleared: ${money(txn.amount)} now counts.` : `Cheque ${txn.chequeNo} marked bounced; the amount is due again.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e, "Could not update the cheque"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={ACTION_TITLE[action]} busy={busy} onClose={onClose}>
      <form className="users-dialog__body" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="money-note">
          Cheque <b className="font-mono">{txn.chequeNo}</b> · {money(txn.amount)} · {txn.kind === "RECEIPT" ? "from" : "to"} <b>{txn.partyName}</b>
          {txn.chequeBank ? ` · ${txn.chequeBank}` : ""} · dated {formatDate(txn.chequeDate)}
        </p>
        {txn.chequeDate && txn.chequeDate.slice(0, 10) > todayInput() && action !== "BOUNCE" && (
          <p className="money-note money-note--warn">This cheque is dated {formatDate(txn.chequeDate)}; banks don&apos;t pay it before that day.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={action === "DEPOSIT" ? "Deposited on" : action === "CLEAR" ? "Cleared on" : "Bounced on"}>
            <Input type="date" max={todayInput()} min={txn.txnDate.slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value || todayInput())} />
          </Field>
          {needsBank && (
            <Field label="Into bank account">
              <select className="erp-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">{banks.length ? "Select bank" : "No bank account yet"}</option>
                {banks.map((a) => <option key={a.id} value={a.id}>{accountText(a)}</option>)}
              </select>
            </Field>
          )}
        </div>
        {action === "BOUNCE" && (
          <Field label="Reason">
            <Input value={reason} maxLength={300} placeholder="e.g. Insufficient funds, signature mismatch" onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        )}
        {action === "BOUNCE" && <p className="text-xs text-gray-500">A bounced cheque counts nowhere: {txn.kind === "RECEIPT" ? `${txn.partyName} owes this amount again` : `you owe ${txn.partyName} this amount again`}. Admins get a notification.</p>}
        {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
        <div className="users-dialog__foot">
          <Button variant="outline" disabled={busy} onClick={onClose}>Back</Button>
          <Button type="submit" variant={action === "BOUNCE" ? "danger" : "default"} disabled={busy}>{busy ? "Saving..." : ACTION_TITLE[action]}</Button>
        </div>
      </form>
    </Shell>
  );
}

/** Every detail of one entry, with its cheque actions and cancel. */
export function TxnDetailsDialog({ txn, accounts, onClose, onChanged }: { txn: MoneyTxn; accounts: MoneyAccount[]; onClose: () => void; onChanged: () => void }) {
  const [action, setAction] = useState<ChequeAction | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = isOpenCheque(txn);

  const cancel = async () => {
    setError("");
    if (reason.trim().length < 3) return setError("Say why it is cancelled.");
    setBusy(true);
    try {
      await api(`/money/transactions/${txn.id}/cancel`, { ...post({ reason: reason.trim() }), silent: true });
      toast.success(`${txn.txnNo} cancelled; it no longer counts.`);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e, "Could not cancel"));
    } finally {
      setBusy(false);
    }
  };

  if (action) return <ChequeActionDialog txn={txn} action={action} accounts={accounts} onClose={() => setAction(null)} onDone={() => { onChanged(); onClose(); }} />;

  const rows: Array<[string, React.ReactNode]> = [
    ["Date", formatDate(txn.txnDate)],
    ["Mode", MODE_LABEL[txn.mode]],
    ["Amount", <b key="a">{money(txn.amount)}</b>],
    txn.kind === "TRANSFER"
      ? ["From → into", `${txn.account?.name ?? "—"} → ${txn.toAccount?.name ?? "—"}`]
      : [txn.kind === "RECEIPT" ? "Into account" : "From account", txn.account ? `${ACCOUNT_LABEL[txn.account.type]} · ${txn.account.name}` : txn.mode === "CHEQUE" && txn.kind === "RECEIPT" ? "Not deposited yet" : "Not recorded (old entry)"],
    ...(txn.kind !== "TRANSFER"
      ? ([[txn.kind === "RECEIPT" ? "From" : "To", <span key="p">{txn.partyName}{txn.partyType ? <span className="text-gray-500"> · {PARTY_TYPE_LABEL[txn.partyType]}{txn.supplier ? ` ${txn.supplier.code}` : ""}</span> : null}</span>]] as Array<[string, React.ReactNode]>)
      : []),
    ...(txn.kind === "RECEIPT" ? ([["Against bill", txn.sale ? <Link key="s" href={`/sales/${txn.sale.id}`} className="customers-code">{txn.sale.saleNo}</Link> : "On account (advance)"]] as Array<[string, React.ReactNode]>) : []),
    ...(txn.referenceNo ? ([[txn.mode === "UPI" ? "UPI transaction ID" : "Reference / UTR", <span key="r" className="font-mono">{txn.referenceNo}</span>]] as Array<[string, React.ReactNode]>) : []),
    ...(txn.mode === "CHEQUE"
      ? ([
          ["Cheque", <span key="c"><span className="font-mono">{txn.chequeNo}</span> · dated {formatDate(txn.chequeDate)}{txn.chequeBank ? ` · ${txn.chequeBank}` : ""}</span>],
          ["Cheque status", <Badge key="st" tone={chequeTone(txn.chequeStatus)}>{chequeLabel(txn)}</Badge>],
          ...(txn.depositedAt ? [["Deposited", formatDate(txn.depositedAt)]] : []),
          ...(txn.clearedAt ? [["Cleared", formatDate(txn.clearedAt)]] : []),
          ...(txn.bouncedAt ? [["Bounced", `${formatDate(txn.bouncedAt)} · ${txn.bounceReason ?? ""}`]] : []),
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(txn.notes ? ([["Notes", txn.notes]] as Array<[string, React.ReactNode]>) : []),
    ["Entered", `${formatDateTime(txn.createdAt)}${txn.createdBy ? ` · ${txn.createdBy}` : ""}`],
    ...(txn.cancelledAt ? ([["Cancelled", <span key="x" className="text-red-700">{formatDateTime(txn.cancelledAt)}{txn.cancelledBy ? ` · ${txn.cancelledBy}` : ""} · {txn.cancelReason}</span>]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <Shell
      busy={busy}
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{txn.txnNo}</span>
          <Badge tone={txn.kind === "RECEIPT" ? "success" : txn.kind === "PAYMENT" ? "warning" : "info"}>{KIND_LABEL[txn.kind]}</Badge>
          {txn.cancelledAt && <Badge tone="danger">Cancelled</Badge>}
        </span>
      }
    >
      <div className="users-dialog__body">
        <dl className="money-details">
          {rows.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        {!txn.counted && !txn.cancelledAt && txn.chequeStatus !== "BOUNCED" && <p className="money-note">This cheque is not in any balance until it clears.</p>}
        {cancelling && (
          <Field label="Why cancel?">
            <Input value={reason} maxLength={300} autoFocus placeholder="e.g. Entered twice, wrong amount" onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
        <div className="users-dialog__foot flex-wrap">
          {!txn.cancelledAt && !cancelling && (
            <Button variant="outline" className="mr-auto text-red-600" disabled={busy} onClick={() => setCancelling(true)}><Undo2 size={15} /> Cancel entry</Button>
          )}
          {cancelling ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setCancelling(false)}>Back</Button>
              <Button variant="danger" disabled={busy} onClick={() => void cancel()}>{busy ? "Cancelling..." : "Cancel this entry"}</Button>
            </>
          ) : (
            open && (
              <>
                {txn.kind === "RECEIPT" && txn.chequeStatus === "PENDING" && <Button variant="outline" onClick={() => setAction("DEPOSIT")}><Landmark size={15} /> Deposit</Button>}
                <Button variant="outline" className="text-red-600" onClick={() => setAction("BOUNCE")}><Ban size={15} /> Bounced</Button>
                <Button onClick={() => setAction("CLEAR")}><CheckCircle2 size={15} /> Cleared</Button>
              </>
            )
          )}
        </div>
      </div>
    </Shell>
  );
}

/** A distributor or textile by id (name for display), or an other party by name. */
export type PartyRef = { type: PartyType; supplierId?: string; textileId?: string; name: string };

/** One distributor's or textile's account: bills, goods, money in and out, running balance; record money from here. */
export function StatementDialog({ party, onClose, onChanged }: { party: PartyRef; onClose: () => void; onChanged: () => void }) {
  const path = `/money/statement${qs({ type: party.type, supplierId: party.supplierId, textileId: party.textileId, name: party.type === "OTHER" ? party.name : undefined })}`;
  const { data, error, reload } = useApiQuery<Statement>(path);
  const [entry, setEntry] = useState<"RECEIPT" | "PAYMENT" | null>(null);

  const balanceText = (value: number) => (Math.abs(value) < 0.005 ? "Settled" : value > 0 ? `${money(value)} they owe` : `${money(-value)} we owe`);
  const exportCsv = () =>
    data &&
    downloadCsv(
      `${data.party.code ?? data.party.name.replace(/[^\w]+/g, "-")}-account-${todayInput()}.csv`,
      ["Date", "Ref", "Particulars", "Debit (they owe)", "Credit (we owe)", "Counts", "Balance"],
      [
        ["", "", "Opening balance", "", "", "", data.opening.toFixed(2)],
        ...data.lines.map((l) => [l.date.slice(0, 10), l.ref, l.text, l.debit ? l.debit.toFixed(2) : "", l.credit ? l.credit.toFixed(2) : "", l.counted ? "yes" : `no (${l.status ?? ""})`, l.balance.toFixed(2)]),
      ],
    );

  if (entry) {
    return (
      <MoneyEntryDialog
        kind={entry}
        lockKind
        preset={{ partyType: party.type, supplierId: party.supplierId, textileId: party.textileId, partyName: party.type === "OTHER" ? party.name : undefined }}
        onClose={() => setEntry(null)}
        onSaved={() => {
          void reload();
          onChanged();
        }}
      />
    );
  }

  return (
    <Shell wide onClose={onClose} title={<span>{data?.party.name ?? party.name} <span className="text-sm font-semibold text-gray-500">· {PARTY_TYPE_LABEL[party.type]}{data?.party.code ? ` ${data.party.code}` : ""}</span></span>}>
      <div className="users-dialog__body pb-4">
        {!data ? (
          error ? <p className="text-sm text-red-600">{error}</p> : <Loading />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn("money-balance-chip", data.totals.balance > 0.005 ? "is-due" : data.totals.balance < -0.005 ? "is-owe" : "")}>
                <span className="text-[11px] uppercase tracking-wide">Balance now</span>
                <b>{balanceText(data.totals.balance)}</b>
              </div>
              {data.totals.chequesPending > 0 && <Badge tone="info">{money(data.totals.chequesPending)} in cheques to clear</Badge>}
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={exportCsv}><Download size={14} /> Export</Button>
              <Button size="sm" variant="outline" onClick={() => setEntry("PAYMENT")}><ArrowUpCircle size={14} /> Paid</Button>
              <Button size="sm" onClick={() => setEntry("RECEIPT")}><ArrowDownCircle size={14} /> Received</Button>
            </div>
            {(data.party.phone || data.party.gst) && <p className="text-xs text-gray-500">{[data.party.phone, data.party.gst && `GSTIN ${data.party.gst}`].filter(Boolean).join(" · ")}</p>}
            <div className="purchases-line-table overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2 text-gray-400">—</td>
                    <td className="px-3 py-2 font-semibold">Opening balance</td>
                    <td /><td />
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{balanceText(data.opening)}</td>
                  </tr>
                  {data.lines.map((l) => (
                    <tr key={`${l.kind}-${l.ref}`} className={cn(!l.counted && "money-row-muted")}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(l.date)}</td>
                      <td className="px-3 py-2">
                        {l.kind === "SALE" && l.refId ? <Link href={`/sales/${l.refId}`} className="customers-code">{l.ref}</Link> : l.kind === "GOODS" && l.refId ? <Link href={`/purchases/${l.refId}`} className="customers-code">{l.ref}</Link> : <span className="font-mono text-xs text-gray-500">{l.ref}</span>}
                        <span className="block text-xs text-gray-600">{l.text}</span>
                        {l.status && l.status !== "CLEARED" && <Badge tone={chequeTone(l.status)} className="mt-0.5">{l.status === "BOUNCED" ? "Bounced · not counted" : "Cheque to clear · not counted yet"}</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.debit ? money(l.debit) : ""}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.credit ? money(l.credit) : ""}</td>
                      <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", l.balance > 0.005 ? "text-amber-700" : l.balance < -0.005 ? "text-red-700" : "text-emerald-700")}>{balanceText(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="px-3 py-2.5 text-right font-bold">Totals (counted)</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(data.totals.debit)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(data.totals.credit)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-black">{balanceText(data.totals.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-gray-500">
              Debit: sale bills and money we paid them. Credit: goods they delivered and money they paid us. A cheque counts once cleared.
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

const CASHBOOK_KIND: Record<Cashbook["lines"][number]["kind"], string> = {
  RECEIPT: "Received",
  PAYMENT: "Paid",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  EXPENSE: "Expense",
};

/** One account's cash book: opening, every movement that counts with the running balance, and cheques still to clear. */
export function CashbookDialog({ account, onClose }: { account: MoneyAccount; onClose: () => void }) {
  const { data, error } = useApiQuery<Cashbook>(`/money/accounts/${account.id}/cashbook`);
  const lines = data ? [...data.lines].reverse() : [];

  const exportCsv = () =>
    data &&
    downloadCsv(
      `${account.name.replace(/[^\w]+/g, "-")}-cash-book-${todayInput()}.csv`,
      ["Date", "Ref", "Kind", "Particulars", "Mode", "In", "Out", "Balance"],
      [
        ["", "", "", "Opening balance", "", "", "", data.opening.toFixed(2)],
        ...data.lines.map((l) => [l.date.slice(0, 10), l.ref, CASHBOOK_KIND[l.kind], l.text, expenseModeLabel(l.mode), l.moneyIn ? l.moneyIn.toFixed(2) : "", l.moneyOut ? l.moneyOut.toFixed(2) : "", l.balance.toFixed(2)]),
      ],
    );

  return (
    <Shell wide onClose={onClose} title={<span>{account.name} <span className="text-sm font-semibold text-gray-500">· {ACCOUNT_LABEL[account.type]} cash book</span></span>}>
      <div className="users-dialog__body pb-4">
        {!data ? (
          error ? <p className="text-sm text-red-600">{error}</p> : <Loading />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn("money-balance-chip", data.totals.balance < 0 && "is-owe")}>
                <span className="text-[11px] uppercase tracking-wide">Balance now</span>
                <b>{money(data.totals.balance)}</b>
              </div>
              <Badge tone="success">In {money(data.totals.moneyIn)}</Badge>
              <Badge tone="warning">Out {money(data.totals.moneyOut)}</Badge>
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={exportCsv}><Download size={14} /> Export</Button>
            </div>
            {data.openCheques.length > 0 && (
              <p className="money-note">
                Not in the balance yet: {data.openCheques.map((c) => `${c.kind === "RECEIPT" ? "+" : "−"}${money(c.amount)} cheque ${c.chequeNo} (${c.partyName})`).join(", ")}.
              </p>
            )}
            <div className="purchases-line-table overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">In</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Balance</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={`${l.kind}-${l.id}`}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(l.date)}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-gray-500">{l.ref}</span> <Badge tone={l.moneyIn ? "success" : l.kind === "EXPENSE" ? "danger" : "warning"}>{CASHBOOK_KIND[l.kind]}</Badge>
                        <span className="block text-xs text-gray-600">{l.text}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">{l.moneyIn ? money(l.moneyIn) : ""}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-rose-700">{l.moneyOut ? money(l.moneyOut) : ""}</td>
                      <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", l.balance < 0 && "text-red-700")}>{money(l.balance)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-3 py-2 text-gray-400">—</td>
                    <td className="px-3 py-2 font-semibold">Opening balance</td>
                    <td /><td />
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{money(data.opening)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-500">Newest first. A cheque shows on the day it cleared. Expenses paid from this account are included.</p>
          </>
        )}
      </div>
    </Shell>
  );
}

/** Cancels a wrong expense: it stays on record but no longer counts anywhere. */
export function CancelExpenseDialog({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (reason.trim().length < 3) return setError("Say why it is cancelled.");
    setBusy(true);
    try {
      await api(`/money/expenses/${expense.id}/cancel`, { ...post({ reason: reason.trim() }), silent: true });
      toast.success(`${expense.expenseNo} cancelled; it no longer counts.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e, "Could not cancel"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={`Cancel ${expense.expenseNo}?`} busy={busy} onClose={onClose}>
      <form className="users-dialog__body" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="money-note">
          {expense.category} · <b>{money(expense.amount)}</b> · {formatDate(expense.expenseDate)}{expense.account ? ` · from ${expense.account.name}` : ""}
          {expense.description ? <span className="block text-xs text-gray-500">{expense.description}</span> : null}
        </p>
        <Field label="Why cancel?">
          <Input value={reason} maxLength={300} autoFocus placeholder="e.g. Entered twice, wrong amount" onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="text-xs text-gray-500">It stays on record (with your reason, in the audit log) and its amount goes back to the account. Enter it again if the amount was wrong.</p>
        {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
        <div className="users-dialog__foot">
          <Button variant="outline" disabled={busy} onClick={onClose}>Keep it</Button>
          <Button type="submit" variant="danger" disabled={busy}>{busy ? "Cancelling..." : "Cancel expense"}</Button>
        </div>
      </form>
    </Shell>
  );
}
