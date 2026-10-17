"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Printer, X } from "lucide-react";
import { qty } from "@/lib/purchases";
import { PARTY_LABEL, type DeliveryChallan } from "@/lib/sales";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime, humanize, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { ChallanLetterhead, companyName, ItemSpecs, OFFICE_COPY, unitTotals } from "@/components/challan-parts";
import { ShareMenu } from "@/components/share-menu";
import { deliveryShare } from "@/lib/challan-share";

const EMPTY = 0.0005;

/** The challan as filed by the office: with rates, taxable value, GST and the bill value. */
function ChallanDocument({ challan }: { challan: DeliveryChallan }) {
  const withPrices = challan.pricesShown;
  const p = challan.party;
  const sent = challan.lines.filter((line) => line.quantity > EMPTY);

  return (
    <article className="sale-bill">
      <ChallanLetterhead company={challan.company} title="Delivery Challan" number={challan.challanNo} date={challan.dispatchedAt} copyLabel={OFFICE_COPY} />

      <div className="sale-bill__parties">
        <div>
          <p className="sale-bill__label">Consignee (deliver to)</p>
          <p className="font-bold">{p.name}</p>
          <p className="text-xs text-gray-600">{PARTY_LABEL[challan.partyType]}{p.code ? ` ${p.code}` : ""}{p.phone ? ` · ${p.phone}` : ""}</p>
          {p.address && <p className="whitespace-pre-line text-xs text-gray-600">{p.address}</p>}
          {p.gst && <p className="text-xs font-semibold text-gray-700">GSTIN {p.gst}</p>}
        </div>
        <div>
          <p className="sale-bill__label">Dispatched from</p>
          <p className="font-bold">{challan.warehouse.code} · {challan.warehouse.name}</p>
          {challan.warehouse.location && <p className="text-xs text-gray-600">{challan.warehouse.location}</p>}
          <p className="text-xs text-gray-600">Against bill <b>{challan.saleNo}</b> dated {formatDate(challan.saleDate)}</p>
        </div>
      </div>

      <dl className="challan-facts">
        <div><dt className="sale-bill__label">Vehicle no</dt><dd>{challan.vehicleNo || "—"}</dd></div>
        <div><dt className="sale-bill__label">Driver</dt><dd>{[challan.driverName, challan.driverPhone].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div><dt className="sale-bill__label">Transporter</dt><dd>{challan.transporter || "—"}</dd></div>
        <div><dt className="sale-bill__label">LR no</dt><dd>{challan.lrNo || "—"}</dd></div>
        <div><dt className="sale-bill__label">Bill no</dt><dd>{challan.saleNo}</dd></div>
        <div><dt className="sale-bill__label">Dispatched at</dt><dd>{formatDateTime(challan.dispatchedAt)}</dd></div>
        <div><dt className="sale-bill__label">Checked & loaded by</dt><dd>{challan.verifiedBy || "—"}</dd></div>
        <div><dt className="sale-bill__label">Lines</dt><dd>{sent.length} of {challan.lines.length} sent</dd></div>
      </dl>

      <div className="overflow-x-auto">
        <table className="sale-bill__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Code / lot</th>
              <th className="text-right">Ordered</th>
              <th className="text-right">Dispatched</th>
              {withPrices && <th className="text-right">Rate</th>}
              {withPrices && <th className="text-right">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {challan.lines.map((line, index) => {
              const short = line.quantity < line.sold - EMPTY;
              return (
                <tr key={line.id}>
                  <td>{index + 1}</td>
                  <td><b>{line.itemName}</b><span className="block text-[11px] text-gray-500">{humanize(line.category)}</span><ItemSpecs specs={line.specs} itemCode={line.itemCode} hide={["Lot"]} /></td>
                  <td className="font-mono text-xs">{line.itemCode}{line.lotNo ? ` · ${line.lotNo}` : ""}</td>
                  <td className="text-right">{qty(line.sold, line.unit)}</td>
                  <td className={cn("text-right font-bold", short && "text-amber-700")}>
                    {line.quantity > EMPTY ? qty(line.quantity, line.unit) : "Not sent"}
                    {short && line.quantity > EMPTY && <span className="block text-[10px] font-semibold">short {qty(line.sold - line.quantity, line.unit)}</span>}
                  </td>
                  {withPrices && <td className="text-right">{money(line.rate ?? 0)}</td>}
                  {withPrices && <td className="text-right font-semibold">{money(line.amount ?? 0)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="sale-bill__total">
              <td colSpan={4} className="text-right">Total dispatched</td>
              <td className="text-right">{unitTotals(sent, (line) => line.quantity)}</td>
              {withPrices && <td className="text-right text-xs font-semibold">Taxable</td>}
              {withPrices && <td className="text-right">{money(challan.subtotal ?? 0)}</td>}
            </tr>
            {withPrices && (
              <>
                <tr><td colSpan={6} className="text-right">GST {challan.gstRate}%</td><td className="text-right">{money(challan.gstAmount ?? 0)}</td></tr>
                <tr className="sale-bill__total"><td colSpan={6} className="text-right">Bill value</td><td className="text-right">{money(challan.total ?? 0)}</td></tr>
              </>
            )}
          </tfoot>
        </table>
      </div>
      {challan.dispatchNotes && <p className="text-xs text-gray-700"><b>Remarks:</b> {challan.dispatchNotes}</p>}
      <p className="text-[11px] text-gray-500">
        Office record of the goods dispatched against bill {challan.saleNo}; this is not a tax invoice. Dispatched {formatDateTime(challan.dispatchedAt)}
        {challan.verifiedBy ? ` by ${challan.verifiedBy}` : ""}.
      </p>

      <footer className="sale-bill__foot challan-foot">
        <div className="text-center"><div className="sale-bill__sign" />Dispatched by (godown)</div>
        <div className="text-center"><div className="sale-bill__sign" />Driver{challan.driverName ? ` (${challan.driverName})` : ""}</div>
        <div className="text-center"><div className="sale-bill__sign" />For {companyName(challan.company)}<br />Checked by (office)</div>
      </footer>
    </article>
  );
}

/**
 * The delivery challan of a dispatched sale, as saved, for office use only (admins): consignee, the warehouse it left,
 * vehicle, driver, transporter and LR, and each line as ordered and as sent, with rates and the bill value. One office
 * copy to print and file.
 */
export function DeliveryChallanDialog({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { data: challan, error, reload } = useApiQuery<DeliveryChallan>(`/sales/${saleId}/delivery-challan`);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay print:hidden" />
        <Dialog.Content data-receipt-bill className="users-dialog sale-bill-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head print:hidden">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{challan ? `Delivery challan ${challan.challanNo}` : "Delivery challan"}</Dialog.Title>
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
                  target={deliveryShare({
                    id: challan.id,
                    challanNo: challan.challanNo,
                    dispatchedAt: challan.dispatchedAt,
                    partyName: challan.party.name,
                    warehouse: challan.warehouse,
                    vehicleNo: challan.vehicleNo,
                    lines: challan.lines.filter((line) => line.quantity > EMPTY),
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
