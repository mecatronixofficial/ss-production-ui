"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Printer, X } from "lucide-react";
import type { ReceivedChallan } from "@/lib/purchases";
import { useApiQuery } from "@/lib/use-api-query";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { ShareMenu } from "@/components/share-menu";
import { receivedShare } from "@/lib/challan-share";
import { GrnReceivedNote } from "@/components/yarn-received-note";

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
              <GrnReceivedNote challan={challan} />
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
