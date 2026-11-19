"use client";

import { useState } from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { Ban, Printer, X } from "lucide-react";
import { api, apiBlob } from "@/lib/api";
import { warehouseShare } from "@/lib/challan-share";
import { BRAND } from "@/lib/brand";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { formatDateTime, humanize, money, unitQty } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { ShareMenu } from "@/components/share-menu";
import { ItemSpecs, type ItemSpec } from "@/components/challan-parts";
import { YarnReceivedNote } from "@/components/yarn-received-note";

export type StockBillKind = "RECEIVED" | "EXPORT";
export type StockBill = {
  id: string;
  billNo: string;
  kind: StockBillKind;
  referenceType: string;
  referenceId: string;
  partyName: string | null;
  vehicleNo: string | null;
  notes: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  warehouse: { id: string; code: string; name: string; location: string | null };
  source: {
    label: string;
    partyName: string | null;
    vehicleNo: string | null;
    driverName?: string | null;
    transporter?: string | null;
    lrNo?: string | null;
    partyAddress?: string | null;
    partyGst?: string | null;
    partyPhone?: string | null;
    references?: Array<{ label: string; value: string }>;
  };
  company: Record<string, string | undefined>;
  lines: Array<{
    id: string;
    category: string;
    txnType: string;
    itemCode: string;
    itemName: string;
    lotNo: string | null;
    unit: string;
    quantity: number;
    createdAt: string;
    /** The item's full details: fabric type, dia, GSM, GG, LL, colour, rolls, batch… */
    specs?: ItemSpec[];
    /** Admins only, where the source has a rate (PO, sale, yarn issue). */
    rate?: number | null;
    amount?: number | null;
  }>;
  /** Total value of the priced lines; null when prices aren't shown. */
  value?: number | null;
};

export const BILL_TITLE: Record<StockBillKind, string> = { RECEIVED: "Material Received Challan", EXPORT: "Material Export Challan" };
export const BILL_SHORT: Record<StockBillKind, string> = { RECEIVED: "Received challan", EXPORT: "Export challan" };

const fileName = (bill: Pick<StockBill, "billNo">) => `${bill.billNo}.pdf`;
const pdfPath = (id: string) => `/inventory/bills/${id}/pdf`;

/** Totals per unit: "286kg 50g · 12.000 PCS". */
export function challanTotals(lines: StockBill["lines"]) {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.unit, (totals.get(line.unit) ?? 0) + line.quantity);
  return [...totals.entries()].map(([unit, quantity]) => unitQty(quantity, unit)).join(" · ");
}

/** Downloads the challan's PDF. */
export async function downloadChallanPdf(bill: Pick<StockBill, "id" | "billNo">) {
  const blob = await apiBlob(pdfPath(bill.id));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName(bill);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A warehouse's received / export challan, ready to print or share: letterhead, challan number, from / to with
 * address, GSTIN and phone, the warehouse and vehicle, the source documents, every line, totals and signatures.
 * Admins can cancel it.
 */
export function StockBillDialog({ billId, canManage, onClose, onChanged }: { billId: string; canManage: boolean; onClose: () => void; onChanged?: () => void }) {
  const { data: bill, error, reload } = useApiQuery<StockBill>(`/inventory/bills/${billId}`);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const { message, run, busy } = useApiAction();
  const c = bill?.company ?? {};
  const place = [c.address, c.city, [c.state, c.pincode].filter(Boolean).join(" – ")].filter(Boolean).join(", ");
  const received = bill?.kind === "RECEIVED";
  // Rate and value columns only for admins, when the source has rates.
  const priced = bill?.value !== null && bill?.value !== undefined;
  const span = priced ? 6 : 4;

  const cancel = async () => {
    if (!bill) return;
    const ok = await run(
      () => api(`/inventory/bills/${bill.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() || undefined }) }),
      `${bill.billNo} cancelled; its movements wait for a new challan.`,
    );
    if (ok) {
      setCancelling(false);
      await reload();
      onChanged?.();
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay print:hidden" />
        <Dialog.Content data-receipt-bill className="users-dialog sale-bill-dialog print:rounded-none print:shadow-none" aria-describedby={undefined}>
          <div className="users-dialog__head print:hidden">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{bill ? `${BILL_SHORT[bill.kind]} ${bill.billNo}` : "Challan"}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <div className="users-dialog__body">
            {!bill ? (
              error ? <ErrorState message={error} onRetry={() => void reload()} /> : <Loading />
            ) : (
              <>
                <div className="print:hidden"><InlineMessage message={message} /></div>
                {bill.cancelledAt && (
                  <p className="warehouses-inactive-note print:hidden">
                    Cancelled {formatDateTime(bill.cancelledAt)}{bill.cancelledBy ? ` by ${bill.cancelledBy}` : ""}{bill.cancelReason ? `: ${bill.cancelReason}` : ""}.
                  </p>
                )}
                {bill.referenceType === "YARN_RECEIPT" && bill.kind === "RECEIVED" ? (
                  <YarnReceivedNote bill={bill} />
                ) : (
                <article className={`sale-bill challan-doc${bill.cancelledAt ? " is-cancelled" : ""}`}>
                  <header className="sale-bill__head">
                    <span className="sale-bill__logo"><Image src={BRAND.logo} alt="" width={56} height={56} className="h-full w-full object-cover" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="sale-bill__company">{c.name || BRAND.name}</p>
                      {place && <p className="text-xs text-gray-600">{place}</p>}
                      <p className="text-xs text-gray-600">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                      {c.gst && <p className="text-xs font-semibold text-gray-700">GSTIN {c.gst}</p>}
                    </div>
                    <div className="text-right">
                      <p className="sale-bill__title">{BILL_TITLE[bill.kind]}{bill.cancelledAt ? " · Cancelled" : ""}</p>
                      <p className="text-base font-extrabold">{bill.billNo}</p>
                      <p className="text-xs text-gray-600">{formatDateTime(bill.createdAt)}</p>
                    </div>
                  </header>

                  <div className="sale-bill__parties">
                    <div>
                      <p className="sale-bill__label">{received ? "Received from" : "Sent to"}</p>
                      <p className="font-bold">{bill.partyName || "—"}</p>
                      {bill.source.partyAddress && <p className="text-xs text-gray-600">{bill.source.partyAddress}</p>}
                      {(bill.source.partyGst || bill.source.partyPhone) && (
                        <p className="text-xs text-gray-600">{[bill.source.partyGst && `GSTIN ${bill.source.partyGst}`, bill.source.partyPhone && `Phone ${bill.source.partyPhone}`].filter(Boolean).join(" · ")}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">{bill.source.label}</p>
                    </div>
                    <div>
                      <p className="sale-bill__label">{received ? "Received into" : "Sent from"}</p>
                      <p className="font-bold">{bill.warehouse.code} · {bill.warehouse.name}</p>
                      {bill.warehouse.location && <p className="text-xs text-gray-600">{bill.warehouse.location}</p>}
                      <p className="text-xs">Vehicle <b>{bill.vehicleNo || "—"}</b>{bill.source.transporter ? ` · ${bill.source.transporter}` : ""}</p>
                      {bill.source.driverName && <p className="text-xs">Driver {bill.source.driverName}</p>}
                      {bill.source.lrNo && <p className="text-xs">LR no {bill.source.lrNo}</p>}
                    </div>
                  </div>

                  {!!bill.source.references?.length && (
                    <dl className="challan-doc__refs">
                      {bill.source.references.map((r) => (
                        <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
                      ))}
                    </dl>
                  )}

                  <table className="sale-bill__table">
                    <thead>
                      <tr>
                        <th>#</th><th>Item</th><th>Code / lot</th><th>Material</th><th className="text-right">Quantity</th>
                        {priced && <th className="text-right">Rate</th>}
                        {priced && <th className="text-right">Value</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {bill.lines.length === 0 ? (
                        <tr><td colSpan={span + 1} className="text-center text-gray-400">No lines: the challan was cancelled and its movements released.</td></tr>
                      ) : (
                        bill.lines.map((line, index) => (
                          <tr key={line.id}>
                            <td>{index + 1}</td>
                            <td>
                              <b>{line.itemName}</b>
                              <span className="block text-[11px] text-gray-500">{humanize(line.txnType).toLowerCase().replace(/^./, (ch) => ch.toUpperCase())} · {formatDateTime(line.createdAt)}</span>
                              <ItemSpecs specs={line.specs} itemCode={line.itemCode} />
                            </td>
                            <td className="font-mono text-xs">{line.itemCode}{line.lotNo && <span className="block">Lot {line.lotNo}</span>}</td>
                            <td className="text-xs">{humanize(line.category)}</td>
                            <td className="whitespace-nowrap text-right font-semibold">{unitQty(line.quantity, line.unit)}</td>
                            {priced && <td className="whitespace-nowrap text-right">{line.rate === null || line.rate === undefined ? "—" : money(line.rate)}</td>}
                            {priced && <td className="whitespace-nowrap text-right font-semibold">{line.amount === null || line.amount === undefined ? "—" : money(line.amount)}</td>}
                          </tr>
                        ))
                      )}
                    </tbody>
                    {bill.lines.length > 0 && (
                      <tfoot>
                        <tr className="sale-bill__total">
                          <td colSpan={4} className="text-right">Total · {bill.lines.length} line{bill.lines.length === 1 ? "" : "s"}</td>
                          <td className="whitespace-nowrap text-right">{challanTotals(bill.lines)}</td>
                          {priced && <td />}
                          {priced && <td className="whitespace-nowrap text-right">{money(bill.value ?? 0)}</td>}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  {bill.notes && <p className="text-xs text-gray-600"><b>Notes:</b> {bill.notes}</p>}
                  <p className="text-[11px] text-gray-400">Issued {formatDateTime(bill.createdAt)}{bill.createdBy ? ` by ${bill.createdBy}` : ""} · computer-generated challan</p>

                  <footer className="sale-bill__foot challan-doc__signs">
                    <div className="text-center"><div className="sale-bill__sign" />{received ? "Delivered by" : "Received by"}</div>
                    <div className="text-center"><div className="sale-bill__sign" />Checked by</div>
                    <div className="text-center"><div className="sale-bill__sign" />For {c.legalName || c.name || BRAND.name}<br />Warehouse in-charge</div>
                  </footer>
                </article>
                )}

                {cancelling && (
                  <label className="block print:hidden">
                    <span className="erp-label">Why cancel?</span>
                    <textarea className="erp-input h-auto min-h-16 py-2" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional, e.g. issued for the wrong entry" />
                  </label>
                )}
              </>
            )}
          </div>
          <div className="users-dialog__foot print:hidden">
            {bill && canManage && !bill.cancelledAt && (
              cancelling ? (
                <>
                  <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => setCancelling(false)}>Keep challan</Button>
                  <Button variant="danger" disabled={busy} onClick={() => void cancel()}><Ban size={15} /> {busy ? "Cancelling…" : "Cancel challan"}</Button>
                </>
              ) : (
                <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setCancelling(true)}><Ban size={15} /> Cancel</Button>
              )
            )}
            {!cancelling && <Button variant="outline" onClick={onClose}>Close</Button>}
            {bill && !cancelling && (
              <>
                <ShareMenu
                  size="md"
                  onPrint={() => window.print()}
                  target={warehouseShare({ ...bill, cancelled: !!bill.cancelledAt, lines: bill.lines })}
                />
                <Button onClick={() => window.print()}><Printer size={16} /> Print</Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
