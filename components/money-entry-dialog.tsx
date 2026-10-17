"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Banknote, Building2, FileCheck2, Smartphone, X } from "lucide-react";
import { api, ApiError, post } from "@/lib/api";
import {
  ACCOUNT_LABEL,
  ACCOUNT_TYPES_FOR,
  accountText,
  dayIso,
  MODE_HINT,
  MODE_LABEL,
  MODES,
  textileNameKey,
  type MoneyContext,
  type MoneyTxn,
  type PartyType,
  type PaymentMode,
  type TxnKind,
} from "@/lib/money";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, formatDate, money, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PartyPicker, type PickParty } from "@/components/party-picker";
import { Loading } from "@/components/loading";

export type MoneyEntryPreset = {
  partyType?: PartyType;
  supplierId?: string;
  /** A textile from the Textiles list (or give its name as `partyName`; it is matched to the list). */
  textileId?: string;
  /** An other party's name, or a textile's name. */
  partyName?: string;
  /** Receipt against this sale bill (party and amount follow the bill). */
  saleId?: string;
  amount?: number;
};

const MODE_ICON: Record<PaymentMode, typeof Banknote> = { CASH: Banknote, UPI: Smartphone, BANK: Building2, CHEQUE: FileCheck2 };
const KINDS: Array<{ value: TxnKind; label: string; icon: typeof Banknote }> = [
  { value: "RECEIPT", label: "Money received", icon: ArrowDownCircle },
  { value: "PAYMENT", label: "Money paid", icon: ArrowUpCircle },
  { value: "TRANSFER", label: "Transfer", icon: ArrowLeftRight },
];
const decimals = (value: string) => (value.split(".")[1] ?? "").length;

/**
 * Records money received, paid, or moved between own accounts: by cash, UPI, bank transfer or cheque, into / out of
 * which account, from / to whom, and (for money received) against which sale bill.
 */
export function MoneyEntryDialog({
  kind: initialKind = "RECEIPT",
  lockKind = false,
  preset = {},
  onClose,
  onSaved,
}: {
  kind?: TxnKind;
  lockKind?: boolean;
  preset?: MoneyEntryPreset;
  onClose: () => void;
  onSaved?: (txn: MoneyTxn) => void;
}) {
  const ctx = useApiQuery<MoneyContext>("/money/context");
  const [kind, setKind] = useState<TxnKind>(initialKind);
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [partyType, setPartyType] = useState<PartyType>(preset.partyType ?? "TEXTILE");
  const [supplierId, setSupplierId] = useState(preset.supplierId ?? "");
  const [partyName, setPartyName] = useState(preset.partyType === "OTHER" ? (preset.partyName ?? "") : "");
  /** Null until a textile is picked here: until then a preset textile (by id or name) applies. */
  const [textileId, setTextileId] = useState<string | null>(preset.textileId ?? null);
  const [added, setAdded] = useState<Array<PickParty & { kind: "DISTRIBUTOR" | "TEXTILE" }>>([]);
  const [saleId, setSaleId] = useState(preset.saleId ?? "");
  const [amount, setAmount] = useState(preset.amount ? String(preset.amount) : "");
  const [txnDate, setTxnDate] = useState(todayInput());
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [cheque, setCheque] = useState({ no: "", date: todayInput(), bank: "" });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const accounts = useMemo(() => ctx.data?.accounts ?? [], [ctx.data]);
  const fixedSale = preset.saleId ? ctx.data?.openSales.find((s) => s.id === preset.saleId) : undefined;
  const isCheque = mode === "CHEQUE";
  const allowed = kind === "TRANSFER" ? null : ACCOUNT_TYPES_FOR[mode];
  const accountChoices = accounts.filter((a) => !allowed || allowed.includes(a.type));
  const accountOptional = kind === "RECEIPT" && isCheque;
  /** With only one account that fits, it is chosen for you. */
  const chosenAccount = accountId || (kind !== "TRANSFER" && !accountOptional && accountChoices.length === 1 ? accountChoices[0].id : "");

  /** Distributors and textiles to pick from (with any just added here); a preset textile can be given by name. */
  const toPick = (p: { id: string; code: string; name: string; active: boolean }): PickParty => ({ id: p.id, code: p.code, name: p.active ? p.name : `${p.name} (inactive)`, gst: null, mobile: null, address: null });
  const distributorList = [...(ctx.data?.distributors ?? []).map(toPick), ...added.filter((p) => p.kind === "DISTRIBUTOR" && !ctx.data?.distributors.some((d) => d.id === p.id))];
  const textileList = [...(ctx.data?.textiles ?? []).map(toPick), ...added.filter((p) => p.kind === "TEXTILE" && !ctx.data?.textiles.some((t) => t.id === p.id))];
  const presetTextile = preset.partyName ? ctx.data?.textiles.find((t) => textileNameKey(t.name) === textileNameKey(preset.partyName!)) : undefined;
  const chosenTextileId = textileId ?? presetTextile?.id ?? "";
  const textile = partyType === "TEXTILE" && chosenTextileId ? textileList.find((t) => t.id === chosenTextileId) : undefined;
  const partyAdded = (kindOf: "DISTRIBUTOR" | "TEXTILE") => (created: PickParty) => {
    setAdded((current) => [...current, { ...created, kind: kindOf }]);
    void ctx.reload();
  };

  /** Open bills of the chosen party, for money received. */
  const bills = useMemo(() => {
    if (kind !== "RECEIPT" || !ctx.data) return [];
    return ctx.data.openSales.filter((s) =>
      partyType === "DISTRIBUTOR" ? s.partyType === "DISTRIBUTOR" && s.supplierId === supplierId : partyType === "TEXTILE" && s.partyType === "TEXTILE" && !!textile && s.textileId === textile.id,
    );
  }, [ctx.data, kind, partyType, supplierId, textile]);
  const bill = fixedSale ?? bills.find((s) => s.id === saleId);

  const pickMode = (next: PaymentMode) => {
    setMode(next);
    const current = accounts.find((a) => a.id === accountId);
    if (current && kind !== "TRANSFER" && !ACCOUNT_TYPES_FOR[next].includes(current.type)) setAccountId("");
  };
  const pickKind = (next: TxnKind) => {
    setKind(next);
    setSaleId("");
    if (next === "TRANSFER" && mode === "CHEQUE") setMode("BANK");
    if (next === "PAYMENT" && partyType === "TEXTILE" && !preset.partyType) setPartyType("DISTRIBUTOR");
  };
  const pickBill = (id: string) => {
    setSaleId(id);
    const sale = bills.find((s) => s.id === id);
    if (sale) setAmount(String(sale.open));
  };

  const submit = async () => {
    setError("");
    const value = toNumber(amount);
    const problem =
      value <= 0 ? "Enter the amount." :
      decimals(amount) > 2 ? "Amount can have at most 2 decimals." :
      bill && value > bill.open + 0.005 ? `Only ${money(bill.open)} is still to be received on ${bill.saleNo}. Record the rest without a bill (as an advance).` :
      kind === "TRANSFER" && (!accountId || !toAccountId) ? "Choose both accounts." :
      kind === "TRANSFER" && accountId === toAccountId ? "Choose two different accounts." :
      kind !== "TRANSFER" && !accountOptional && !chosenAccount ? `Choose the account the money ${kind === "RECEIPT" ? "came into" : isCheque ? "is drawn on" : "was paid from"}.` :
      kind !== "TRANSFER" && !preset.saleId && partyType === "DISTRIBUTOR" && !supplierId ? "Choose the distributor." :
      kind !== "TRANSFER" && !preset.saleId && partyType === "TEXTILE" && !textile ? "Choose the textile, or add a new one from the list." :
      kind !== "TRANSFER" && !preset.saleId && partyType === "OTHER" && !partyName.trim() ? "Enter the party name." :
      isCheque && !/^[0-9]{4,12}$/.test(cheque.no.trim()) ? "Enter the cheque number (the digits on the cheque)." :
      "";
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const txn = await api<MoneyTxn>("/money/transactions", {
        silent: true,
        ...post({
          kind,
          txnDate: dayIso(txnDate),
          mode,
          amount: value,
          accountId: (kind === "TRANSFER" ? accountId : chosenAccount) || undefined,
          ...(kind === "TRANSFER"
            ? { toAccountId }
            : preset.saleId || saleId
              ? { saleId: preset.saleId || saleId }
              : {
                  partyType,
                  ...(partyType === "DISTRIBUTOR" ? { supplierId } : partyType === "TEXTILE" ? { textileId: textile!.id } : { partyName: partyName.trim() }),
                }),
          referenceNo: !isCheque && referenceNo.trim() ? referenceNo.trim() : undefined,
          ...(isCheque ? { chequeNo: cheque.no.trim(), chequeDate: cheque.date ? dayIso(cheque.date) : undefined, chequeBank: cheque.bank.trim() || undefined } : {}),
          notes: notes.trim() || undefined,
        }),
      });
      toast.success(`${txn.txnNo}: ${money(txn.amount)} ${kind === "RECEIPT" ? "received" : kind === "PAYMENT" ? "paid" : "moved"}${isCheque ? " (cheque counts once cleared)" : ""}.`);
      onSaved?.(txn);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  const title = kind === "RECEIPT" ? "Record money received" : kind === "PAYMENT" ? "Record money paid" : "Move money between accounts";
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog money-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{title}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          {!ctx.data ? (
            <div className="users-dialog__body pb-4">{ctx.error ? <p className="text-sm text-red-600">{ctx.error}</p> : <Loading />}</div>
          ) : (
            <form
              className="users-dialog__body"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {!lockKind && (
                <div className="money-segment" role="tablist" aria-label="Kind of entry">
                  {KINDS.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" role="tab" aria-selected={kind === value} className={cn(kind === value && "is-active", `is-${value.toLowerCase()}`)} onClick={() => pickKind(value)}>
                      <Icon size={15} aria-hidden /> {label}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <span className="erp-label">{kind === "RECEIPT" ? "Received by" : kind === "PAYMENT" ? "Paid by" : "Moved by"}</span>
                <div className="money-modes" role="radiogroup" aria-label="Payment mode">
                  {MODES.filter((m) => kind !== "TRANSFER" || m !== "CHEQUE").map((m) => {
                    const Icon = MODE_ICON[m];
                    return (
                      <button key={m} type="button" role="radio" aria-checked={mode === m} className={cn("money-mode", mode === m && "is-active")} onClick={() => pickMode(m)}>
                        <Icon size={18} aria-hidden />
                        <span className="font-semibold">{MODE_LABEL[m]}</span>
                        <span className="text-[10px] text-gray-500">{MODE_HINT[m]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {kind !== "TRANSFER" &&
                (fixedSale || preset.saleId ? (
                  <p className="money-note">
                    Against bill <b>{fixedSale?.saleNo ?? "this sale"}</b>{fixedSale ? ` · ${fixedSale.partyName} · ${money(fixedSale.open)} still to receive` : ""}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <Field label={kind === "RECEIPT" ? "From" : "To"}>
                      <select className="erp-input" value={partyType} onChange={(e) => { setPartyType(e.target.value as PartyType); setSaleId(""); }}>
                        <option value="TEXTILE">Textile</option>
                        <option value="DISTRIBUTOR">Distributor</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </Field>
                    {partyType === "OTHER" ? (
                      <Field label="Name">
                        <SearchableSelect value={partyName} onChange={(v) => { setPartyName(v); setSaleId(""); }} options={ctx.data.others} placeholder="Who" />
                      </Field>
                    ) : (
                      // Not a <label>: clicking an option must not re-focus the search box.
                      <div>
                        <span className="erp-label">{partyType === "DISTRIBUTOR" ? "Distributor" : "Textile"}</span>
                        <PartyPicker
                          key={partyType}
                          kind={partyType}
                          parties={partyType === "DISTRIBUTOR" ? distributorList : textileList}
                          value={partyType === "DISTRIBUTOR" ? supplierId : chosenTextileId}
                          onChange={(picked) => {
                            if (partyType === "DISTRIBUTOR") setSupplierId(picked?.id ?? "");
                            else setTextileId(picked?.id ?? "");
                            setSaleId("");
                          }}
                          onCreated={partyAdded(partyType)}
                        />
                      </div>
                    )}
                  </div>
                ))}

              {kind === "RECEIPT" && !preset.saleId && (partyType === "DISTRIBUTOR" ? !!supplierId : partyType === "TEXTILE" && !!textile) && (
                <Field label="Against bill" hint={bills.length ? `${bills.length} open` : "No open bills"}>
                  <select className="erp-input" value={saleId} onChange={(e) => pickBill(e.target.value)}>
                    <option value="">No bill: on account / advance</option>
                    {bills.map((s) => <option key={s.id} value={s.id}>{s.saleNo} · {formatDate(s.saleDate)} · {money(s.open)} to receive{s.status !== "DISPATCHED" ? " (not dispatched yet)" : ""}</option>)}
                  </select>
                </Field>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount" hint={bill ? `Bill ${money(bill.totalAmount)}` : "₹"}>
                  <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                </Field>
                <Field label={kind === "RECEIPT" ? (isCheque ? "Cheque received on" : "Received on") : kind === "PAYMENT" ? (isCheque ? "Cheque given on" : "Paid on") : "Date"}>
                  <Input type="date" max={todayInput()} value={txnDate} onChange={(e) => setTxnDate(e.target.value || todayInput())} />
                </Field>
              </div>

              {kind === "TRANSFER" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="From account">
                    <AccountSelect value={accountId} onChange={setAccountId} accounts={accounts} />
                  </Field>
                  <Field label="Into account">
                    <AccountSelect value={toAccountId} onChange={setToAccountId} accounts={accounts.filter((a) => a.id !== accountId)} />
                  </Field>
                </div>
              ) : (
                <Field
                  label={kind === "RECEIPT" ? (isCheque ? "Deposited into" : "Into account") : isCheque ? "Cheque drawn on" : "Paid from"}
                  hint={accountOptional ? "Leave empty if not deposited yet" : allowed ? allowed.map((t) => ACCOUNT_LABEL[t]).join(" / ") : undefined}
                >
                  <AccountSelect value={chosenAccount} onChange={setAccountId} accounts={accountChoices} empty={accountOptional ? "Not deposited yet" : undefined} />
                </Field>
              )}
              {accountChoices.length === 0 && !accountOptional && (
                <p className="money-note money-note--warn">
                  No {allowed ? allowed.map((t) => ACCOUNT_LABEL[t].toLowerCase()).join(" or ") : ""} account yet. <Link href="/money?tab=accounts" className="font-semibold underline">Add one on the Money page</Link>.
                </p>
              )}

              {isCheque ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Cheque no">
                    <Input value={cheque.no} inputMode="numeric" maxLength={12} placeholder="000123" onChange={(e) => setCheque({ ...cheque, no: e.target.value.replace(/\D/g, "") })} />
                  </Field>
                  <Field label="Cheque date">
                    <Input type="date" value={cheque.date} onChange={(e) => setCheque({ ...cheque, date: e.target.value })} />
                  </Field>
                  <Field label={kind === "RECEIPT" ? "Their bank" : "Bank"} hint="Optional">
                    <Input value={cheque.bank} maxLength={80} placeholder={kind === "RECEIPT" ? "e.g. IOB Tiruppur" : ""} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} />
                  </Field>
                </div>
              ) : mode !== "CASH" ? (
                <Field label={mode === "UPI" ? "UPI transaction ID" : "UTR / reference no"} hint="Optional, stops double entry">
                  <Input value={referenceNo} maxLength={80} onChange={(e) => setReferenceNo(e.target.value)} />
                </Field>
              ) : null}

              <Field label="Notes" hint="Optional">
                <Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder={kind === "TRANSFER" ? "e.g. Cash deposited at branch" : ""} />
              </Field>

              {isCheque && <p className="money-note">A cheque counts in balances only after it clears. Track it on the Money page → Cheques.</p>}
              {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}

              <div className="users-dialog__foot">
                <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Saving..." : kind === "RECEIPT" ? "Save receipt" : kind === "PAYMENT" ? "Save payment" : "Save transfer"}</Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AccountSelect({ value, onChange, accounts, empty }: { value: string; onChange: (id: string) => void; accounts: MoneyContext["accounts"]; empty?: string }) {
  return (
    <select className="erp-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty ?? (accounts.length ? "Select account" : "No account")}</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{ACCOUNT_LABEL[a.type]} · {accountText(a)}</option>)}
    </select>
  );
}
