"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeft,
  CalendarClock,
  FileCheck2,
  HandCoins,
  IndianRupee,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  ReceiptIndianRupee,
  Shirt,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { chequeLabel, chequeTone, MODE_LABEL, SALE_PAYMENT_LABEL, salePaymentTone, type ChequeStatus, type PaymentMode, type SalePaymentStatus } from "@/lib/money";
import { SALE_STATUS_LABEL, saleTone, type SaleStatus } from "@/lib/sales";
import { useApiQuery } from "@/lib/use-api-query";
import { EDIT_PARAM } from "@/lib/use-new-param";
import { cn, formatDate, money, todayInput } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { MoneyEntryDialog } from "@/components/money-entry-dialog";
import { StatementDialog } from "../../../money/dialogs";

type Account = {
  textile: {
    id: string;
    code: string;
    name: string;
    contactPerson: string | null;
    mobile: string | null;
    email: string | null;
    gst: string | null;
    address: string | null;
    city: string | null;
    paymentTerms: string | null;
    creditLimit: number | null;
    openingBalance: number;
    notes: string | null;
    active: boolean;
    createdAt: string;
  };
  totals: { openingBalance: number; billed: number; bills: number; received: number; chequesPending: number; refunded: number; balance: number; openSales: number };
  sales: Array<{
    id: string;
    saleNo: string;
    saleDate: string;
    status: SaleStatus;
    totalAmount: number;
    dispatchedAt: string | null;
    warehouse: { code: string };
    payment: { received: number; pending: number; due: number; status: SalePaymentStatus } | null;
  }>;
  money: Array<{
    id: string;
    txnNo: string;
    kind: "RECEIPT" | "PAYMENT";
    txnDate: string;
    amount: number;
    mode: PaymentMode;
    referenceNo: string | null;
    chequeNo: string | null;
    chequeStatus: ChequeStatus | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    account: { name: string } | null;
    sale: { id: string; saleNo: string } | null;
    counted: boolean;
  }>;
};

/** "₹12,000 due" / "₹500 advance" / "Settled". */
const balanceText = (balance: number) => (Math.abs(balance) < 0.005 ? "Settled" : `${money(Math.abs(balance))} ${balance > 0 ? "due" : "advance"}`);

function Section({ icon: Icon, title, caption, action, children }: { icon: typeof Shirt; title: string; caption?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="item-details-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="item-details-section__head">
          <span className="item-details-section__icon"><Icon size={14} /></span>
          <div>
            <h3 className="text-sm font-bold text-[#1b3c55]">{title}</h3>
            {caption && <p className="text-xs text-gray-500">{caption}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** `/masters/textiles/<id>`: one textile — details, sale bills and how each is paid, money received, and its account. */
export default function TextilePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApiQuery<Account>(`/masters/textiles/${id}/account`);
  const [receiving, setReceiving] = useState(false);
  const [statement, setStatement] = useState(false);
  const [billFilter, setBillFilter] = useState<"due" | "all">("due");

  const back = <Link href="/masters/distributors?tab=textiles" className="purchases-back-link"><ArrowLeft size={15} /> Textiles</Link>;
  if (!data) return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;

  const { textile: t, totals } = data;
  const state = totals.balance > 0.005 ? "due" : totals.balance < -0.005 ? "advance" : "settled";
  const overLimit = t.creditLimit !== null && t.creditLimit > 0 && totals.balance > t.creditLimit + 0.005;
  const live = data.sales.filter((s) => s.status !== "CANCELLED");
  const dueBills = live.filter((s) => s.payment && s.payment.due > 0.005);
  const bills = billFilter === "due" ? dueBills : data.sales;
  const lastReceipt = data.money.find((m) => m.kind === "RECEIPT" && m.counted);

  const exportBills = () =>
    downloadCsv(
      `${t.code}-bills-${todayInput()}.csv`,
      ["Bill", "Date", "Status", "Total", "Received", "Cheques to clear", "Due", "Payment"],
      data.sales.map((s) => [s.saleNo, s.saleDate.slice(0, 10), SALE_STATUS_LABEL[s.status], s.totalAmount.toFixed(2), s.payment?.received.toFixed(2), s.payment?.pending.toFixed(2), s.payment?.due.toFixed(2), s.payment ? SALE_PAYMENT_LABEL[s.payment.status] : ""]),
    );

  const details: Array<[string, React.ReactNode]> = [
    ["Contact person", t.contactPerson ?? "—"],
    ["Mobile", t.mobile ? <a href={`tel:${t.mobile}`} className="text-[#1b3c55] hover:underline">{t.mobile}</a> : "—"],
    ["Email", t.email ? <a href={`mailto:${t.email}`} className="break-all text-[#1b3c55] hover:underline">{t.email}</a> : "—"],
    ["GSTIN", t.gst ? <span className="font-mono">{t.gst}</span> : "—"],
    ["City / town", t.city ?? "—"],
    ["Payment terms", t.paymentTerms ?? "—"],
    ["Credit limit", t.creditLimit ? money(t.creditLimit) : "Not set"],
    ["Opening balance", balanceText(totals.openingBalance)],
    ["Textile since", formatDate(t.createdAt)],
  ];

  return (
    <div className="inventory-list-page">
      {back}

      <div className="item-details-header flex-wrap">
        <span className="warehouses-page-icon"><Shirt size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            {t.name}
            <span className="font-mono text-sm font-semibold text-gray-500">{t.code}</span>
            <Badge tone={t.active ? "success" : "warning"}>{t.active ? "Active" : "Inactive"}</Badge>
            {t.city && <Badge tone="info">{t.city}</Badge>}
          </h2>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            {t.mobile && <span className="inline-flex items-center gap-1"><Phone size={12} /> {t.mobile}</span>}
            {t.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {t.email}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild><Link href={`/masters/distributors?tab=textiles&${EDIT_PARAM}=${t.id}`}><Pencil size={15} /> Edit</Link></Button>
          <Button variant="outline" onClick={() => setStatement(true)}><Receipt size={15} /> Account</Button>
          <Button variant="outline" onClick={() => setReceiving(true)}><HandCoins size={15} /> Receive money</Button>
          {t.active && <Button asChild><Link href="/sales/new"><Plus size={15} /> New sale</Link></Button>}
        </div>
      </div>

      {!t.active && <p className="warehouses-inactive-note">This textile is inactive: it can&apos;t be picked for new sales. Its history stays below.</p>}
      {overLimit && (
        <p className="warehouses-inactive-note"><AlertTriangle size={15} className="shrink-0" /> {money(totals.balance)} is due, over the credit limit of {money(t.creditLimit)}.</p>
      )}

      <section className="customer-account" aria-label="Account summary">
        <div className={cn("customer-account__balance", state === "due" && "is-due", state === "advance" && "is-advance")}>
          <p className="customer-account__label"><IndianRupee size={13} aria-hidden /> {state === "due" ? "To collect" : state === "advance" ? "Advance received" : "Balance"}</p>
          <p className="customer-account__amount">{state === "settled" ? money(0) : money(Math.abs(totals.balance))}</p>
          <p className="customer-account__note">
            {totals.billed || totals.received || totals.openingBalance
              ? `Opening ${money(totals.openingBalance)} + billed ${money(totals.billed)} − received ${money(totals.received)}${totals.refunded ? ` + refunded ${money(totals.refunded)}` : ""}`
              : "No bills or money yet. The balance starts with the first dispatched sale."}
          </p>
        </div>
        <dl className="customer-account__figures">
          {[
            { label: "Billed", value: money(totals.billed), note: `${totals.bills} dispatched bill${totals.bills === 1 ? "" : "s"}${totals.openSales ? ` · ${totals.openSales} waiting` : ""}`, icon: ReceiptIndianRupee },
            { label: "Received", value: money(totals.received), note: lastReceipt ? `Last ${formatDate(lastReceipt.txnDate)}` : "Nothing received yet", icon: ArrowDownCircle },
            { label: "Cheques to clear", value: money(totals.chequesPending), note: totals.chequesPending ? "Counted once cleared" : "None waiting", icon: FileCheck2 },
            { label: "Payment terms", value: t.paymentTerms ?? "Not set", note: t.creditLimit ? `Limit ${money(t.creditLimit)}` : "No credit limit", icon: CalendarClock },
          ].map(({ label, value, note, icon: Icon }) => (
            <div key={label} className="customer-account__figure">
              <span className="customer-account__icon"><Icon size={15} aria-hidden /></span>
              <div className="min-w-0">
                <dt>{label}</dt>
                <dd className="truncate">{value}</dd>
                <p className="truncate">{note}</p>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section icon={Shirt} title="Contact & billing">
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="erp-label">{label}</dt>
                <dd className="font-medium text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section icon={MapPin} title="Billing address">
          <p className="whitespace-pre-line text-sm text-gray-800">{t.address || "—"}</p>
          {t.notes && <p className="whitespace-pre-line text-xs text-gray-500">{t.notes}</p>}
        </Section>
      </div>

      <Section
        icon={ReceiptIndianRupee}
        title={`Sale bills (${data.sales.length})`}
        caption="Newest first, with how much of each bill is received."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="purchases-filters" role="tablist" aria-label="Show bills">
              {(["due", "all"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={billFilter === value} className={cn(billFilter === value && "is-active")} onClick={() => setBillFilter(value)}>
                  {value === "due" ? "Still due" : "All"} <span>{value === "due" ? dueBills.length : data.sales.length}</span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={!data.sales.length} onClick={exportBills}>Export</Button>
          </div>
        }
      >
        {bills.length === 0 ? (
          <div className="purchases-empty">{data.sales.length ? "Every bill is fully received." : "No sales to this textile yet."}</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr><th className="px-3 py-2">Bill</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Due</th><th className="px-3 py-2">Payment</th></tr></thead>
              <tbody>
                {bills.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2"><Link href={`/sales/${s.id}`} className="customers-code">{s.saleNo}</Link><span className="block text-xs text-gray-400">{formatDate(s.saleDate)} · {s.warehouse.code}</span></td>
                    <td className="px-3 py-2"><Badge tone={saleTone(s.status)}>{SALE_STATUS_LABEL[s.status]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(s.totalAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">{s.payment ? money(s.payment.received) : "—"}{s.payment && s.payment.pending > 0 && <span className="block text-[11px] text-blue-700">+{money(s.payment.pending)} cheque</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-amber-700">{s.payment && s.payment.due > 0.005 ? money(s.payment.due) : "—"}</td>
                    <td className="px-3 py-2">{s.payment ? <Badge tone={salePaymentTone(s.payment.status)}>{SALE_PAYMENT_LABEL[s.payment.status]}</Badge> : <span className="text-xs text-gray-400">Cancelled</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section icon={ArrowDownCircle} title={`Money (${data.money.length})`} caption="Received from and refunded to this textile, newest first. A cheque counts once it clears.">
        {data.money.length === 0 ? (
          <div className="purchases-empty">No money recorded yet. Use “Receive money”.</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr><th className="px-3 py-2">Entry</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Against</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {data.money.map((m) => (
                  <tr key={m.id} className={cn(m.cancelledAt && "money-row-muted")}>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs font-semibold">{m.txnNo}</span>
                      <span className="block text-xs text-gray-400">{formatDate(m.txnDate)} · {m.kind === "RECEIPT" ? "Received" : "Refunded"}{m.cancelledAt ? ` · cancelled: ${m.cancelReason ?? ""}` : ""}</span>
                    </td>
                    <td className="px-3 py-2">
                      {MODE_LABEL[m.mode]}
                      {m.mode === "CHEQUE" && <Badge tone={chequeTone(m.chequeStatus)} className="ml-1.5 align-middle">{chequeLabel(m)}</Badge>}
                      <span className="block text-xs text-gray-400">{[m.account?.name, m.chequeNo ? `No ${m.chequeNo}` : m.referenceNo].filter(Boolean).join(" · ") || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{m.sale ? <Link href={`/sales/${m.sale.id}`} className="text-[#1b3c55] hover:underline">{m.sale.saleNo}</Link> : "On account"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", !m.counted ? "text-gray-400" : m.kind === "RECEIPT" ? "text-emerald-700" : "text-rose-700")}>
                      {m.kind === "RECEIPT" ? "" : "−"}{money(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {receiving && (
        <MoneyEntryDialog
          kind="RECEIPT"
          lockKind
          preset={{ partyType: "TEXTILE", textileId: t.id, amount: totals.balance > 0 ? totals.balance : undefined }}
          onClose={() => setReceiving(false)}
          onSaved={() => void reload()}
        />
      )}
      {statement && <StatementDialog party={{ type: "TEXTILE", textileId: t.id, name: t.name }} onClose={() => setStatement(false)} onChanged={() => void reload()} />}
    </div>
  );
}
