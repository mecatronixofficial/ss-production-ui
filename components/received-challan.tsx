"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Printer, X } from "lucide-react";
import { qty, STATUS_LABEL, type ReceivedChallan } from "@/lib/purchases";
import { useApiQuery } from "@/lib/use-api-query";
import { formatDate, formatDateTime, humanize, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { ShareMenu } from "@/components/share-menu";
import { receivedShare } from "@/lib/challan-share";
import { ChallanLetterhead, companyName, ItemSpecs, OFFICE_COPY, unitTotals } from "@/components/challan-parts";

/** The challan as filed by the office: with rates and the value at PO rates. */
function ChallanDocument({ challan }: { challan: ReceivedChallan }) {
  const withPrices = challan.pricesShown;
  const s = challan.supplier;
  const po = challan.purchaseOrder;

  return (
    <article className="sale-bill">
      <ChallanLetterhead company={challan.company} title="Material Received Challan" number={challan.receiptNo} date={challan.receivedAt} copyLabel={OFFICE_COPY} />

      <div className="sale-bill__parties">
        <div>
          <p className="sale-bill__label">Received from</p>
          <p className="font-bold">{s.name}</p>
          {s.company && s.company !== s.name && <p className="text-xs text-gray-600">{s.company}</p>}
          <p className="text-xs text-gray-600">{s.partyType === "MILL" ? "Mill" : "Distributor"} {s.code}{s.contactPerson ? ` · ${s.contactPerson}` : ""}{s.mobile ? ` · ${s.mobile}` : ""}</p>
          {s.address && <p className="text-xs text-gray-600">{s.address}</p>}
          {s.gst && <p className="text-xs font-semibold text-gray-700">GSTIN {s.gst}</p>}
        </div>
        <div>
          <p className="sale-bill__label">Received into</p>
          <p className="font-bold">{challan.warehouse.code} · {challan.warehouse.name}</p>
          {challan.warehouse.location && <p className="text-xs text-gray-600">{challan.warehouse.location}</p>}
          {po.warehouse && po.warehouse.id !== challan.warehouse.id && (
            <p className="text-xs text-amber-700">Ordered for {po.warehouse.code} · {po.warehouse.name}</p>
          )}
        </div>
      </div>

      <dl className="challan-facts">
        <div><dt className="sale-bill__label">Purchase order</dt><dd>{po.poNo}</dd></div>
        <div><dt className="sale-bill__label">PO date</dt><dd>{formatDate(po.orderDate)}</dd></div>
        <div><dt className="sale-bill__label">Supplier challan / invoice</dt><dd>{challan.challanNo || "—"}</dd></div>
        <div><dt className="sale-bill__label">Vehicle no</dt><dd>{challan.vehicleNo || "—"}</dd></div>
        <div><dt className="sale-bill__label">Supplier lot</dt><dd>{challan.lotNo || "—"}</dd></div>
        <div><dt className="sale-bill__label">Received at</dt><dd>{formatDateTime(challan.receivedAt)}</dd></div>
        <div><dt className="sale-bill__label">Received by</dt><dd>{challan.receivedBy || "—"}</dd></div>
        <div><dt className="sale-bill__label">PO status now</dt><dd>{STATUS_LABEL[po.status]}</dd></div>
      </dl>

      <div className="overflow-x-auto">
        <table className="sale-bill__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Code</th>
              <th className="text-right">Ordered</th>
              <th className="text-right">Earlier received</th>
              <th className="text-right">Received now</th>
              <th className="text-right">Balance to come</th>
              {withPrices && <th className="text-right">Rate</th>}
              {withPrices && <th className="text-right">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {challan.lines.map((line, index) => (
              <tr key={line.id}>
                <td>{index + 1}</td>
                <td><b>{line.itemName}</b><span className="block text-[11px] text-gray-500">{humanize(line.category)}</span><ItemSpecs specs={line.specs} itemCode={line.itemCode} hide={["Material", "PO"]} /></td>
                <td className="font-mono text-xs">{line.itemCode ?? "—"}</td>
                <td className="text-right">{qty(line.ordered, line.unit)}</td>
                <td className="text-right">{qty(line.receivedBefore, line.unit)}</td>
                <td className="text-right font-bold">{qty(line.quantity, line.unit)}</td>
                <td className="text-right">{line.balance > 1e-9 ? qty(line.balance, line.unit) : "Complete"}</td>
                {withPrices && <td className="text-right">{money(line.rate ?? 0)}</td>}
                {withPrices && <td className="text-right font-semibold">{money(line.amount ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sale-bill__total">
              <td colSpan={5} className="text-right">Total received</td>
              <td className="text-right">{unitTotals(challan.lines, (line) => line.quantity)}</td>
              <td className="text-right text-xs font-semibold">{unitTotals(challan.lines, (line) => line.balance)}</td>
              {withPrices && <td />}
              {withPrices && <td className="text-right">{money(challan.total ?? 0)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      {withPrices && <p className="text-right text-xs text-gray-500">Value at purchase-order rates, before tax.</p>}
      {challan.notes && <p className="text-xs text-gray-700"><b>Remarks:</b> {challan.notes}</p>}
      <p className="text-[11px] text-gray-400">Material checked and taken into stock. Posted {formatDateTime(challan.receivedAt)}{challan.receivedBy ? ` by ${challan.receivedBy}` : ""}.</p>

      <footer className="sale-bill__foot challan-foot">
        <div className="text-center"><div className="sale-bill__sign" />Delivered by (driver)</div>
        <div className="text-center"><div className="sale-bill__sign" />Received by (godown)</div>
        <div className="text-center"><div className="sale-bill__sign" />For {companyName(challan.company)}<br />Checked by (office)</div>
      </footer>
    </article>
  );
}

/**
 * The received challan of one goods receipt, as saved, for office use only (admins): letterhead, distributor,
 * warehouse, PO, the distributor's challan and vehicle, and each line with ordered, received now, the balance still
 * to come, rates and value. One office copy to print and file.
 */
export function ReceivedChallanDialog({ receiptId, title, onClose }: { receiptId: string; title?: string; onClose: () => void }) {
  const { data: challan, error, reload } = useApiQuery<ReceivedChallan>(`/procurement/receipts/${receiptId}`);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay print:hidden" />
        <Dialog.Content data-receipt-bill className="users-dialog sale-bill-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head print:hidden">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{title ?? (challan ? `Received challan ${challan.receiptNo}` : "Received challan")}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <div className="users-dialog__body">
            {!challan ? (
              error ? <ErrorState message={error} onRetry={() => void reload()} /> : <Loading />
            ) : (
              <ChallanDocument challan={challan} />
            )}
            <div className="users-dialog__foot flex-wrap items-center print:hidden">
              <p className="mr-auto text-xs text-gray-500">For office use only.</p>
              <Button variant="outline" onClick={onClose}>Close</Button>
              {challan && (
                <ShareMenu
                  size="md"
                  onPrint={() => window.print()}
                  target={receivedShare({
                    id: challan.id,
                    receiptNo: challan.receiptNo,
                    receivedAt: challan.receivedAt,
                    supplierName: challan.supplier.name,
                    warehouse: challan.warehouse,
                    vehicleNo: challan.vehicleNo,
                    poNo: challan.purchaseOrder.poNo,
                    lines: challan.lines,
                    value: challan.total,
                    company: challan.company,
                  })}
                />
              )}
              <Button disabled={!challan} onClick={() => window.print()}><Printer size={16} /> Print</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
