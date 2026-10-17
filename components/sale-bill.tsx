"use client";

import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { Printer, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { amountInWords, billQty, PARTY_LABEL, type Sale } from "@/lib/sales";
import { useApiQuery } from "@/lib/use-api-query";
import { formatDate, humanize, money, toNumber } from "@/lib/utils";
import { ItemSpecs } from "@/components/challan-parts";
import { Button } from "@/components/ui/button";

type Company = { name?: string; legalName?: string; gst?: string; pan?: string; email?: string; phone?: string; address?: string; city?: string; state?: string; pincode?: string };

const qtyText = (value: number, unit: string) => `${value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${unit}`;

/**
 * The sale's bill, ready to print: company letterhead (from Settings), the party, items with rates, GST, the total in
 * words and the vehicle. Before dispatch it is marked as a proforma; after, it follows what was actually loaded.
 */
export function SaleBillDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { data } = useApiQuery<{ value: Company }>("/admin/settings/company");
  const c = data?.value ?? {};
  const dispatched = sale.status === "DISPATCHED";
  const lines = sale.items.filter((item) => billQty(item) > 0.0005);
  const subtotal = toNumber(sale.subtotal);
  const gstRate = toNumber(sale.gstRate);
  const gst = toNumber(sale.gstAmount);
  const total = toNumber(sale.totalAmount);
  // Same state for seller and buyer (GSTIN prefixes) means CGST + SGST; otherwise IGST.
  const intraState = !!c.gst && !!sale.partyGst && c.gst.slice(0, 2) === sale.partyGst.slice(0, 2);
  const place = [c.address, c.city, [c.state, c.pincode].filter(Boolean).join(" – ")].filter(Boolean).join(", ");

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay print:hidden" />
        <Dialog.Content data-receipt-bill className="users-dialog sale-bill-dialog print:rounded-none print:shadow-none" aria-describedby={undefined}>
          <div className="users-dialog__head print:hidden">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">Bill {sale.saleNo}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <div className="users-dialog__body">
            <article className="sale-bill">
              <header className="sale-bill__head">
                <span className="sale-bill__logo"><Image src={BRAND.logo} alt="" width={56} height={56} className="h-full w-full object-cover" /></span>
                <div className="min-w-0 flex-1">
                  <p className="sale-bill__company">{c.name || BRAND.name}</p>
                  {c.legalName && c.legalName !== c.name && <p className="text-xs font-semibold text-gray-600">{c.legalName}</p>}
                  {place && <p className="text-xs text-gray-600">{place}</p>}
                  <p className="text-xs text-gray-600">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs font-semibold text-gray-700">{[c.gst && `GSTIN ${c.gst}`, c.pan && `PAN ${c.pan}`].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="text-right">
                  <p className="sale-bill__title">{dispatched ? "Tax Invoice" : "Proforma Invoice"}</p>
                  <p className="text-sm font-bold">{sale.saleNo}</p>
                  <p className="text-xs text-gray-600">Date {formatDate(sale.saleDate)}</p>
                </div>
              </header>

              <div className="sale-bill__parties">
                <div>
                  <p className="sale-bill__label">Bill to · {PARTY_LABEL[sale.partyType]}</p>
                  <p className="font-bold">{sale.partyName}</p>
                  {sale.partyAddress && <p className="whitespace-pre-line text-xs text-gray-600">{sale.partyAddress}</p>}
                  {sale.partyPhone && <p className="text-xs text-gray-600">Phone {sale.partyPhone}</p>}
                  {sale.partyGst && <p className="text-xs font-semibold">GSTIN {sale.partyGst}</p>}
                </div>
                <div>
                  <p className="sale-bill__label">Dispatch</p>
                  <p className="text-xs">From <b>{sale.warehouse.code}</b> · {sale.warehouse.name}</p>
                  <p className="text-xs">Vehicle <b>{sale.vehicleNo || "—"}</b>{sale.transporter ? ` · ${sale.transporter}` : ""}</p>
                  <p className="text-xs">Driver {sale.driverName || "—"}{sale.driverPhone ? ` · ${sale.driverPhone}` : ""}</p>
                  {sale.lrNo && <p className="text-xs">LR no {sale.lrNo}</p>}
                  {sale.dispatchedAt && <p className="text-xs">Dispatched {formatDate(sale.dispatchedAt)}</p>}
                </div>
              </div>

              <table className="sale-bill__table">
                <thead>
                  <tr><th>#</th><th>Item</th><th>Code / lot</th><th className="text-right">Quantity</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {lines.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td><b>{item.itemName}</b><span className="block text-[11px] text-gray-500">{humanize(item.category)}</span><ItemSpecs specs={item.specs} itemCode={item.itemCode} hide={["Lot"]} /></td>
                      <td className="font-mono text-xs">{item.itemCode}{item.lotNo ? ` · ${item.lotNo}` : ""}</td>
                      <td className="text-right">{qtyText(billQty(item), item.unit)}</td>
                      <td className="text-right">{money(item.rate)}</td>
                      <td className="text-right font-semibold">{money(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5} className="text-right">Taxable value</td><td className="text-right">{money(subtotal)}</td></tr>
                  {gstRate > 0 &&
                    (intraState ? (
                      <>
                        <tr><td colSpan={5} className="text-right">CGST {gstRate / 2}%</td><td className="text-right">{money(gst / 2)}</td></tr>
                        <tr><td colSpan={5} className="text-right">SGST {gstRate / 2}%</td><td className="text-right">{money(gst - gst / 2)}</td></tr>
                      </>
                    ) : (
                      <tr><td colSpan={5} className="text-right">{c.gst && sale.partyGst ? "IGST" : "GST"} {gstRate}%</td><td className="text-right">{money(gst)}</td></tr>
                    ))}
                  <tr className="sale-bill__total"><td colSpan={5} className="text-right">Total</td><td className="text-right">{money(total)}</td></tr>
                </tfoot>
              </table>
              <p className="text-xs"><b>Amount in words:</b> {amountInWords(total)}</p>
              {sale.notes && <p className="text-xs text-gray-600"><b>Notes:</b> {sale.notes}</p>}

              <footer className="sale-bill__foot">
                <div className="text-center"><div className="sale-bill__sign" />Receiver&apos;s signature</div>
                <div className="text-center"><div className="sale-bill__sign" />For {c.legalName || c.name || BRAND.name}<br />Authorised signatory</div>
              </footer>
            </article>
          </div>
          <div className="users-dialog__foot print:hidden">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button onClick={() => window.print()}><Printer size={16} /> Print bill</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
