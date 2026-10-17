"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Ban, Building2, Check, CheckCircle2, Clock3, FileText, HandCoins, Package, Pencil, Printer, Send, Truck, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { chequeLabel, chequeTone, MODE_LABEL, SALE_PAYMENT_LABEL, salePaymentTone, type MoneyTxn } from "@/lib/money";
import { billQty, PARTY_LABEL, SALE_STATUS_LABEL, saleTone, type Sale } from "@/lib/sales";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, formatDate, formatDateTime, humanize, money, toNumber, unitQty } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { SaleBillDialog } from "@/components/sale-bill";
import { DeliveryChallanDialog } from "@/components/delivery-challan";
import { useAuth } from "@/components/auth-provider";
import { ADMIN_ROLES } from "@/lib/navigation";
import { MoneyEntryDialog } from "@/components/money-entry-dialog";

const qtyText = (value: number, unit: string) => unitQty(value, unit);

/** `/sales/<id>`: one sale — who to, what leaves which warehouse, the vehicle, where it stands, and its bill. */
export default function SalePage() {
  const { id } = useParams<{ id: string }>();
  const { data: sale, error, reload } = useApiQuery<Sale>(`/sales/${id}`);
  // Payments only for admins (who see prices): `payment` is null for warehouse staff.
  const receipts = useApiQuery<MoneyTxn[]>(sale?.payment ? `/money/transactions?saleId=${id}&includeCancelled=true` : null);
  const [billOpen, setBillOpen] = useState(false);
  const [challanOpen, setChallanOpen] = useState(false);
  // The delivery challan is an office document: only admins open and print it.
  const { user } = useAuth();
  const isOffice = !!user && ADMIN_ROLES.includes(user.role);
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);

  const back = <Link href="/sales" className="purchases-back-link"><ArrowLeft size={15} /> Sales</Link>;
  if (!sale) return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;

  const editable = sale.status === "PENDING" || sale.status === "REJECTED";
  const dispatched = sale.status === "DISPATCHED";
  const short = dispatched ? sale.items.filter((item) => billQty(item) < Number(item.quantity) - 0.0005) : [];

  const payment = sale.payment;
  const canReceive = !!payment && sale.status !== "CANCELLED" && payment.due - payment.pending > 0.005;
  const cancel = async () => {
    const ok = await confirmDialog({
      title: `Cancel ${sale.saleNo}?`,
      description: `The sale to ${sale.partyName} is cancelled${sale.status === "PENDING" ? ` and ${sale.warehouse.code} is told not to load it` : ""}. Nothing has left stock, so stock doesn't change.${payment && payment.received + payment.pending > 0 ? ` Money already received (${money(payment.received + payment.pending)}) stays with ${sale.partyName} as an advance.` : ""}`,
      confirmLabel: "Cancel sale",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/sales/${sale.id}/cancel`, { method: "POST" });
      toast.success(`${sale.saleNo} cancelled.`);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, "Could not cancel the sale"));
    } finally {
      setBusy(false);
    }
  };

  // Where the sale stands: entered → with the warehouse → dispatched (or sent back / cancelled).
  const steps = [
    { label: "Entered", note: `${formatDateTime(sale.createdAt)}${sale.createdBy ? ` · ${sale.createdBy}` : ""}`, done: true, icon: FileText },
    {
      label: sale.status === "REJECTED" ? "Sent back by the warehouse" : `Sent to ${sale.warehouse.code}`,
      note: sale.status === "REJECTED" ? `${sale.verifiedBy ?? "Warehouse"}: ${sale.rejectReason}` : sale.status === "PENDING" ? "Waiting for staff to verify and load" : "Warehouse notified",
      done: sale.status !== "CANCELLED",
      problem: sale.status === "REJECTED",
      icon: Send,
    },
    {
      label: sale.status === "CANCELLED" ? "Cancelled" : "Verified & dispatched",
      note: dispatched ? `${formatDateTime(sale.dispatchedAt)}${sale.verifiedBy ? ` · ${sale.verifiedBy}` : ""}` : sale.status === "CANCELLED" ? "Not dispatched" : "Not yet",
      done: dispatched,
      problem: sale.status === "CANCELLED",
      icon: Truck,
    },
  ];

  return (
    <div className="inventory-list-page">
      {back}

      <div className="item-details-header flex-wrap">
        <span className="warehouses-page-icon"><FileText size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            <span className="font-mono">{sale.saleNo}</span>
            <Badge tone={saleTone(sale.status)}>{SALE_STATUS_LABEL[sale.status]}</Badge>
          </h2>
          <p className="text-sm text-gray-600">
            {PARTY_LABEL[sale.partyType]} · <b>{sale.partyName}</b> · bill date {formatDate(sale.saleDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && <Button variant="outline" asChild><Link href={`/sales/${sale.id}/edit`}><Pencil size={15} /> Edit</Link></Button>}
          {editable && <Button variant="outline" className="text-red-600" disabled={busy} onClick={() => void cancel()}><Ban size={15} /> Cancel sale</Button>}
          {canReceive && <Button variant="outline" onClick={() => setReceiving(true)}><HandCoins size={15} /> Receive payment</Button>}
          {dispatched && isOffice && <Button variant="outline" onClick={() => setChallanOpen(true)}><Truck size={15} /> Delivery challan</Button>}
          {sale.status !== "CANCELLED" && <Button onClick={() => setBillOpen(true)}><Printer size={15} /> {dispatched ? "Bill" : "Proforma bill"}</Button>}
        </div>
      </div>

      {sale.status === "REJECTED" && (
        <p className="warehouses-inactive-note"><AlertTriangle size={15} className="shrink-0" /> {sale.warehouse.code} sent this back: {sale.rejectReason}. Edit it to correct and send it again, or cancel it.</p>
      )}
      {short.length > 0 && (
        <p className="warehouses-inactive-note"><AlertTriangle size={15} className="shrink-0" /> {short.length} line{short.length === 1 ? " was" : "s were"} loaded short; the bill follows what was actually loaded.</p>
      )}

      <ol className="sale-steps">
        {steps.map((step) => (
          <li key={step.label} className={cn(step.done && "is-done", step.problem && "is-problem")}>
            <span className="sale-steps__icon">{step.problem ? <AlertTriangle size={15} /> : step.done ? <Check size={15} /> : <step.icon size={15} />}</span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-gray-800">{step.label}</span>
              <span className="block text-xs text-gray-500">{step.note}</span>
            </span>
          </li>
        ))}
      </ol>

      <section className="customer-account" aria-label="Bill summary">
        <div className="customer-account__balance">
          <p className="customer-account__label">{dispatched ? "Bill total" : "Total (as entered)"}</p>
          <p className="customer-account__amount">{money(sale.totalAmount)}</p>
          <p className="customer-account__note">Taxable {money(sale.subtotal)} + GST {toNumber(sale.gstRate)}% {money(sale.gstAmount)}</p>
        </div>
        <dl className="customer-account__figures">
          {[
            { label: "Sold to", value: sale.partyName, note: [PARTY_LABEL[sale.partyType], sale.partyGst && `GSTIN ${sale.partyGst}`].filter(Boolean).join(" · "), icon: sale.partyType === "DISTRIBUTOR" ? Building2 : UserRound },
            { label: "From", value: sale.warehouse.code, note: sale.warehouse.name, icon: Package },
            { label: "Vehicle", value: sale.vehicleNo || "Not given", note: [sale.driverName, sale.driverPhone].filter(Boolean).join(" · ") || "No driver details", icon: Truck },
            { label: dispatched ? "Dispatched" : "Status", value: dispatched ? formatDate(sale.dispatchedAt) : SALE_STATUS_LABEL[sale.status], note: dispatched ? `Verified by ${sale.verifiedBy ?? "the warehouse"}` : sale.status === "PENDING" ? "With the warehouse" : "—", icon: sale.status === "PENDING" ? Clock3 : CheckCircle2 },
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

      <section className="item-details-section">
        <h3 className="text-sm font-bold text-[#1b3c55]">Items</h3>
        <div className="purchases-line-table overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Sold</th><th className="px-3 py-2 text-right">Loaded</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
            <tbody>
              {sale.items.map((item) => {
                const loaded = item.dispatchedQty === null ? null : Number(item.dispatchedQty);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <Link href={`/warehouses/item?code=${encodeURIComponent(item.itemCode)}&warehouse=${sale.warehouseId}`} className="customers-code">{item.itemCode}</Link>
                      <span className="mt-0.5 block text-xs text-gray-500">{item.itemName} · {humanize(item.category)}{item.lotNo ? ` · lot ${item.lotNo}` : ""}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{qtyText(Number(item.quantity), item.unit)}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", loaded !== null && loaded < Number(item.quantity) - 0.0005 ? "font-semibold text-amber-700" : "text-gray-700")}>{loaded === null ? "—" : qtyText(loaded, item.unit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(item.rate)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{money(item.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={4} className="px-3 py-2 text-right">Taxable value</td><td className="px-3 py-2 text-right tabular-nums">{money(sale.subtotal)}</td></tr>
              <tr><td colSpan={4} className="px-3 py-2 text-right">GST {toNumber(sale.gstRate)}%</td><td className="px-3 py-2 text-right tabular-nums">{money(sale.gstAmount)}</td></tr>
              <tr><td colSpan={4} className="px-3 py-2.5 text-right font-bold">Total</td><td className="px-3 py-2.5 text-right font-black tabular-nums">{money(sale.totalAmount)}</td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      {payment && (
        <section className="item-details-section" aria-label="Payments">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#1b3c55]">
              Payments <Badge tone={salePaymentTone(payment.status)}>{SALE_PAYMENT_LABEL[payment.status]}</Badge>
            </h3>
            {canReceive && <Button size="sm" onClick={() => setReceiving(true)}><HandCoins size={14} /> Receive payment</Button>}
          </div>
          <div className="sale-payments">
            <dl className="finance-flow">
              <div><dt>Bill total</dt><dd>{money(sale.totalAmount)}</dd></div>
              <div><dt>Received</dt><dd className="text-emerald-700">{money(payment.received)}</dd></div>
              {payment.pending > 0 && <div><dt>Cheques to clear</dt><dd className="text-blue-700">{money(payment.pending)}</dd></div>}
              <div className="is-total"><dt>{payment.due > 0.005 ? "Still to receive" : "Fully received"}</dt><dd className={payment.due > 0.005 ? "text-amber-700" : "text-emerald-700"}>{money(payment.due)}</dd></div>
            </dl>
            {!receipts.data ? (
              receipts.error ? <p className="text-sm text-red-600">{receipts.error}</p> : <Loading />
            ) : receipts.data.length === 0 ? (
              <div className="purchases-empty">No money received on this bill yet.{canReceive ? " Use “Receive payment” and choose cash, UPI, bank or cheque." : ""}</div>
            ) : (
              <div className="purchases-line-table overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[620px] text-sm">
                  <thead><tr><th className="px-3 py-2">Receipt</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Into</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                  <tbody>
                    {receipts.data.map((r) => (
                      <tr key={r.id} className={cn(r.cancelledAt && "money-row-muted")}>
                        <td className="px-3 py-2"><span className="font-mono text-xs font-semibold">{r.txnNo}</span><span className="block text-xs text-gray-400">{formatDate(r.txnDate)}{r.createdBy ? ` · ${r.createdBy}` : ""}</span></td>
                        <td className="px-3 py-2">{MODE_LABEL[r.mode]}<span className="block text-xs text-gray-400">{r.chequeNo ? `No ${r.chequeNo}${r.chequeBank ? ` · ${r.chequeBank}` : ""}` : r.referenceNo ?? ""}</span></td>
                        <td className="px-3 py-2 text-xs">{r.account?.name ?? (r.mode === "CHEQUE" ? "Not deposited" : "—")}</td>
                        <td className="px-3 py-2">
                          {r.cancelledAt ? <Badge tone="default">Cancelled</Badge> : r.mode === "CHEQUE" ? <Badge tone={chequeTone(r.chequeStatus)}>{chequeLabel(r)}</Badge> : <Badge tone="success">Received</Badge>}
                          {r.bounceReason && <span className="block text-[11px] text-red-600">{r.bounceReason}</span>}
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", r.counted ? "text-emerald-700" : "text-gray-400")}>{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-500">
            Cheques count once cleared. Deposit, clear or mark a bounced cheque on <Link href="/money?tab=cheques" className="text-[#1b3c55] underline">Money → Cheques</Link>; cancel a wrong receipt from Money → Entries.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="item-details-section">
          <h3 className="text-sm font-bold text-[#1b3c55]">Party</h3>
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            <div><dt className="erp-label">{PARTY_LABEL[sale.partyType]}</dt><dd className="font-medium">{sale.supplier ? (
              <Link href={`/masters/distributors/${sale.supplier.id}`} className="text-[#1b3c55] hover:underline">{sale.supplier.code} · {sale.partyName}</Link>
            ) : sale.textile ? (
              <Link href={`/masters/textiles/${sale.textile.id}`} className="text-[#1b3c55] hover:underline">{sale.textile.code} · {sale.partyName}</Link>
            ) : (
              sale.partyName
            )}</dd></div>
            <div><dt className="erp-label">GSTIN</dt><dd className="font-mono">{sale.partyGst || "—"}</dd></div>
            <div><dt className="erp-label">Phone</dt><dd>{sale.partyPhone ? <a href={`tel:${sale.partyPhone}`} className="text-[#1b3c55] hover:underline">{sale.partyPhone}</a> : "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="erp-label">Billing address</dt><dd className="whitespace-pre-line">{sale.partyAddress || "—"}</dd></div>
          </dl>
        </section>
        <section className="item-details-section">
          <h3 className="text-sm font-bold text-[#1b3c55]">Vehicle & dispatch</h3>
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            {dispatched && (
              <div className="sm:col-span-2">
                <dt className="erp-label">Delivery challan</dt>
                <dd>
                  {isOffice ? (
                    <button type="button" className="font-mono font-semibold text-[#1b3c55] hover:underline" onClick={() => setChallanOpen(true)}>{sale.challanNo ?? "Open"}</button>
                  ) : (
                    <span className="font-mono font-semibold">{sale.challanNo ?? "—"}</span>
                  )}
                  <span className="text-xs text-gray-500"> · dispatched {formatDateTime(sale.dispatchedAt)}</span>
                </dd>
              </div>
            )}
            <div><dt className="erp-label">Vehicle no</dt><dd className="font-mono font-semibold">{sale.vehicleNo || "—"}</dd></div>
            <div><dt className="erp-label">Transporter</dt><dd>{sale.transporter || "—"}</dd></div>
            <div><dt className="erp-label">Driver</dt><dd>{sale.driverName || "—"}{sale.driverPhone && <> · <a href={`tel:${sale.driverPhone}`} className="text-[#1b3c55] hover:underline">{sale.driverPhone}</a></>}</dd></div>
            <div><dt className="erp-label">LR no</dt><dd>{sale.lrNo || "—"}</dd></div>
            {sale.dispatchNotes && <div className="sm:col-span-2"><dt className="erp-label">Warehouse remarks</dt><dd>{sale.dispatchNotes}</dd></div>}
            {sale.notes && <div className="sm:col-span-2"><dt className="erp-label">Notes</dt><dd>{sale.notes}</dd></div>}
          </dl>
        </section>
      </div>

      {billOpen && <SaleBillDialog sale={sale} onClose={() => setBillOpen(false)} />}
      {challanOpen && <DeliveryChallanDialog saleId={sale.id} onClose={() => setChallanOpen(false)} />}
      {receiving && (
        <MoneyEntryDialog
          kind="RECEIPT"
          lockKind
          preset={{ saleId: sale.id }}
          onClose={() => setReceiving(false)}
          onSaved={() => {
            void reload();
            void receipts.reload();
          }}
        />
      )}
    </div>
  );
}
