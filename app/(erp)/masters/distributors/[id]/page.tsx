"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarClock, ClipboardList, Download, IndianRupee, Mail, MapPin, PackageCheck, Pencil, Phone, Plus, Receipt, Truck, Wallet } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { CHEQUE_LABEL, chequeTone, MODE_LABEL, type ChequeStatus, type PaymentMode } from "@/lib/money";
import { MoneyEntryDialog } from "@/components/money-entry-dialog";
import { STATUS_LABEL, statusTone, type PurchaseStatus } from "@/lib/purchases";
import { useApiQuery } from "@/lib/use-api-query";
import { EDIT_PARAM, newHref } from "@/lib/use-new-param";
import { cn, formatDate, money, todayInput, toNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type Account = {
  supplier: {
    id: string;
    code: string;
    name: string;
    company: string | null;
    contactPerson: string | null;
    mobile: string | null;
    email: string | null;
    gst: string | null;
    address: string | null;
    materialCategory: string | null;
    paymentTerms: string | null;
    openingBalance: string;
    active: boolean;
    createdAt: string;
  };
  totals: { openingBalance: number; received: number; paid: number; balance: number; openOrders: number };
  orders: Array<{
    id: string;
    poNo: string;
    orderDate: string;
    expectedDate: string | null;
    status: PurchaseStatus;
    warehouse: { code: string } | null;
    items: string[];
    orderedValue: number;
    receivedValue: number;
  }>;
  receipts: Array<{
    id: string;
    receiptNo: string;
    receivedAt: string;
    lotNo: string | null;
    purchaseOrder: { id: string; poNo: string };
    warehouse: { code: string };
    items: string[];
    value: number;
  }>;
  /** `counted` is false for a cheque not yet cleared, or bounced. */
  payments: Array<{ id: string; txnNo: string; amount: string; mode: PaymentMode; referenceNo: string | null; paidAt: string; account: string | null; chequeStatus: ChequeStatus | null; counted: boolean }>;
};

const OPEN: PurchaseStatus[] = ["ORDERED", "PARTIALLY_RECEIVED"];
/** "₹12,000 to pay" / "₹500 advance" / "Settled". */
const balanceText = (balance: number) => (Math.abs(balance) < 0.005 ? "Settled" : `${money(Math.abs(balance))} ${balance > 0 ? "to pay" : "advance"}`);

function Section({ icon: Icon, title, caption, action, children }: { icon: typeof Truck; title: string; caption?: string; action?: React.ReactNode; children: React.ReactNode }) {
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

/** `/masters/distributors/<id>`: one distributor — details, purchase orders, goods received, payments and statement. */
export default function DistributorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApiQuery<Account>(`/masters/suppliers/${id}/account`);
  const [orderFilter, setOrderFilter] = useState<"open" | "all">("open");
  const [paying, setPaying] = useState(false);

  /** Opening balance, then goods received (owed to them) and payments (paid to them) by date, with the running balance. */
  const statement = useMemo(() => {
    if (!data) return [];
    const entries = [
      ...data.receipts.map((r) => ({ key: `r${r.id}`, date: r.receivedAt, text: `Received ${r.receiptNo} · ${r.purchaseOrder.poNo}`, owed: r.value, paid: 0 })),
      ...data.payments.filter((p) => p.counted).map((p) => ({ key: `p${p.id}`, date: p.paidAt, text: `Payment ${p.txnNo} · ${MODE_LABEL[p.mode]}${p.referenceNo ? ` ${p.referenceNo}` : ""}`, owed: 0, paid: toNumber(p.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let running = data.totals.openingBalance;
    return entries.map((entry) => {
      running += entry.owed - entry.paid;
      return { ...entry, balance: running };
    });
  }, [data]);

  const back = <Link href="/masters/distributors" className="purchases-back-link"><ArrowLeft size={15} /> Distributors</Link>;
  if (!data) {
    return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;
  }

  const { supplier: d, totals } = data;
  const today = todayInput();
  const state = totals.balance > 0.005 ? "due" : totals.balance < -0.005 ? "advance" : "settled";
  const orders = orderFilter === "open" ? data.orders.filter((o) => OPEN.includes(o.status)) : data.orders;
  const toArrive = data.orders.filter((o) => OPEN.includes(o.status)).reduce((sum, o) => sum + Math.max(0, o.orderedValue - o.receivedValue), 0);
  const lastPayment = data.payments.find((p) => p.counted);
  const chequesPending = data.payments.filter((p) => p.chequeStatus === "PENDING" || p.chequeStatus === "DEPOSITED").reduce((sum, p) => sum + toNumber(p.amount), 0);

  const exportStatement = () =>
    downloadCsv(
      `${d.code}-statement-${today}.csv`,
      ["Date", "Particulars", "Received (owed)", "Paid", "Balance"],
      [
        ["", "Opening balance", "", "", totals.openingBalance.toFixed(2)],
        ...statement.map((e) => [e.date.slice(0, 10), e.text, e.owed ? e.owed.toFixed(2) : "", e.paid ? e.paid.toFixed(2) : "", e.balance.toFixed(2)]),
      ],
    );

  const details: Array<[string, React.ReactNode]> = [
    ["Contact person", d.contactPerson ?? "—"],
    ["Mobile", d.mobile ? <a href={`tel:${d.mobile}`} className="text-[#1b3c55] hover:underline">{d.mobile}</a> : "—"],
    ["Email", d.email ? <a href={`mailto:${d.email}`} className="break-all text-[#1b3c55] hover:underline">{d.email}</a> : "—"],
    ["GSTIN", d.gst ? <span className="font-mono">{d.gst}</span> : "—"],
    ["Material", d.materialCategory ?? "—"],
    ["Payment terms", d.paymentTerms ?? "—"],
    ["Opening balance", balanceText(totals.openingBalance)],
    ["Distributor since", formatDate(d.createdAt)],
  ];

  return (
    <div className="inventory-list-page">
      {back}

      <div className="item-details-header flex-wrap">
        <span className="warehouses-page-icon"><Truck size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            {d.name}
            <span className="font-mono text-sm font-semibold text-gray-500">{d.code}</span>
            <Badge tone={d.active ? "success" : "warning"}>{d.active ? "Active" : "Inactive"}</Badge>
            {d.materialCategory && <Badge tone="info">{d.materialCategory}</Badge>}
          </h2>
          {d.company && d.company !== d.name && <p className="text-sm font-semibold text-gray-600">{d.company}</p>}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            {d.mobile && <span className="inline-flex items-center gap-1"><Phone size={12} /> {d.mobile}</span>}
            {d.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {d.email}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild><Link href={`/masters/distributors?${EDIT_PARAM}=${d.id}`}><Pencil size={15} /> Edit</Link></Button>
          <Button variant="outline" onClick={() => setPaying(true)}><Wallet size={15} /> Pay</Button>
          {d.active && <Button asChild><Link href={newHref("/purchases")}><Plus size={15} /> New purchase order</Link></Button>}
        </div>
      </div>

      {!d.active && <p className="warehouses-inactive-note">This distributor is inactive: they can&apos;t be picked for new purchase orders. Their history stays below.</p>}

      <section className="customer-account" aria-label="Account summary">
        <div className={cn("customer-account__balance", state === "due" && "is-due", state === "advance" && "is-advance")}>
          <p className="customer-account__label">
            <IndianRupee size={13} aria-hidden /> {state === "due" ? "To pay" : state === "advance" ? "Advance paid" : "Balance"}
          </p>
          <p className="customer-account__amount">{state === "settled" ? money(0) : money(Math.abs(totals.balance))}</p>
          <p className="customer-account__note">
            {totals.received || totals.paid || totals.openingBalance
              ? `Opening ${money(totals.openingBalance)} + received ${money(totals.received)} − paid ${money(totals.paid)}`
              : "Nothing received or paid yet. The balance starts with the first goods receipt."}
          </p>
        </div>
        <dl className="customer-account__figures">
          {[
            { label: "Goods received", value: money(totals.received), note: data.receipts.length ? `${data.receipts.length} receipt${data.receipts.length === 1 ? "" : "s"}` : "None yet", icon: PackageCheck },
            { label: "Paid", value: money(totals.paid), note: chequesPending > 0 ? `${money(chequesPending)} in cheques to clear` : lastPayment ? `Last ${formatDate(lastPayment.paidAt)}` : "No payments yet", icon: Wallet },
            { label: "Open POs", value: String(totals.openOrders), note: toArrive > 0 ? `${money(toArrive)} still to arrive` : `${data.orders.length} in all`, icon: ClipboardList },
            { label: "Payment terms", value: d.paymentTerms ?? "Not set", note: d.materialCategory ?? "No material set", icon: CalendarClock },
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
        <Section icon={Truck} title="Contact & billing">
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="erp-label">{label}</dt>
                <dd className="font-medium text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section icon={MapPin} title="Address">
          <p className="whitespace-pre-line text-sm text-gray-800">{d.address || "—"}</p>
        </Section>
      </div>

      <Section
        icon={ClipboardList}
        title={`Purchase orders (${data.orders.length})`}
        caption="Newest first. Open one to see its lines and receipts."
        action={
          <div className="purchases-filters" role="tablist" aria-label="Show purchase orders">
            {(["open", "all"] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={orderFilter === value} className={cn(orderFilter === value && "is-active")} onClick={() => setOrderFilter(value)}>
                {value === "open" ? "Open" : "All"} <span>{value === "open" ? totals.openOrders : data.orders.length}</span>
              </button>
            ))}
          </div>
        }
      >
        {orders.length === 0 ? (
          <div className="purchases-empty">{data.orders.length ? "No open purchase orders." : "No purchase orders yet."}</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><th className="px-3 py-2">PO</th><th className="px-3 py-2">Items</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>
                {orders.map((o) => {
                  return (
                    <tr key={o.id}>
                      <td className="px-3 py-2">
                        <Link href={`/purchases/${o.id}`} className="customers-code">{o.poNo}</Link>
                        <span className="mt-0.5 block text-xs text-gray-400">{formatDate(o.orderDate)}{o.warehouse ? ` · to ${o.warehouse.code}` : ""}</span>
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-xs text-gray-600" title={o.items.join(", ")}>{o.items.join(", ") || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(o.orderedValue)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-blue-700">{money(o.receivedValue)}</td>
                      <td className="px-3 py-2"><Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section icon={PackageCheck} title={`Goods received (${data.receipts.length})`} caption="Every receipt (GRN) against this distributor's purchase orders, newest first.">
        {data.receipts.length === 0 ? (
          <div className="purchases-empty">Nothing received yet.</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr><th className="px-3 py-2">Receipt</th><th className="px-3 py-2">PO</th><th className="px-3 py-2">Items</th><th className="px-3 py-2">Into</th><th className="px-3 py-2 text-right">Value</th></tr></thead>
              <tbody>
                {data.receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><span className="font-semibold">{r.receiptNo}</span><span className="block text-xs text-gray-400">{formatDate(r.receivedAt)}{r.lotNo ? ` · lot ${r.lotNo}` : ""}</span></td>
                    <td className="px-3 py-2"><Link href={`/purchases/${r.purchaseOrder.id}`} className="text-[#1b3c55] hover:underline">{r.purchaseOrder.poNo}</Link></td>
                    <td className="max-w-[16rem] truncate px-3 py-2 text-xs text-gray-600" title={r.items.join(", ")}>{r.items.join(", ")}</td>
                    <td className="px-3 py-2 text-xs">{r.warehouse.code}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        icon={Wallet}
        title={`Payments (${data.payments.length})`}
        caption="Money paid to this distributor, newest first. A cheque counts once it clears."
        action={<Button size="sm" variant="outline" asChild><Link href="/money?tab=parties">Money page</Link></Button>}
      >
        {data.payments.length === 0 ? (
          <div className="purchases-empty">No payments yet.</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(p.paidAt)}<span className="block font-mono text-[11px] text-gray-400">{p.txnNo}</span></td>
                    <td className="px-3 py-2">
                      {MODE_LABEL[p.mode]}
                      {p.chequeStatus && p.chequeStatus !== "CLEARED" && <Badge tone={chequeTone(p.chequeStatus)} className="ml-1.5 align-middle">{p.chequeStatus === "PENDING" ? "Issued" : CHEQUE_LABEL[p.chequeStatus]}</Badge>}
                      {p.account && <span className="block text-xs text-gray-400">{p.account}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{p.referenceNo || "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", p.counted ? "text-rose-700" : "text-gray-400")}>{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        icon={Receipt}
        title="Account statement"
        caption="Opening balance, goods received and payments in date order, with the running balance."
        action={<Button size="sm" variant="outline" onClick={exportStatement}><Download size={14} /> Export CSV</Button>}
      >
        <div className="purchases-line-table overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody>
              <tr>
                <td className="px-3 py-2 text-gray-400">—</td>
                <td className="px-3 py-2 font-semibold">Opening balance</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{balanceText(totals.openingBalance)}</td>
              </tr>
              {statement.map((e) => (
                <tr key={e.key}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(e.date)}</td>
                  <td className="px-3 py-2">{e.text}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{e.owed ? money(e.owed) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-rose-700">{e.paid ? money(e.paid) : ""}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", e.balance > 0.005 ? "text-red-700" : "text-emerald-700")}>{balanceText(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4} className="px-3 py-2.5 text-right font-bold">Balance now</td><td className="whitespace-nowrap px-3 py-2.5 text-right font-black">{balanceText(totals.balance)}</td></tr>
            </tfoot>
          </table>
        </div>
        {(data.receipts.length >= 500 || data.payments.length >= 500) && <p className="text-xs text-amber-700">Showing the latest 500 receipts and payments; the balance above covers everything.</p>}
      </Section>

      {paying && (
        <MoneyEntryDialog
          kind="PAYMENT"
          lockKind
          preset={{ partyType: "DISTRIBUTOR", supplierId: d.id, amount: totals.balance > 0 ? totals.balance : undefined }}
          onClose={() => setPaying(false)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}
