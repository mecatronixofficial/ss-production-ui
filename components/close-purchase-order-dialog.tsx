"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PackageX, X } from "lucide-react";
import { remainingText, type PurchaseOrder } from "@/lib/purchases";
import { Button } from "@/components/ui/button";

/** Closes a partly received PO short, with the reason kept in the audit log. */
export function ClosePurchaseOrderDialog({
  po,
  busy,
  onConfirm,
  onClose,
}: {
  po: PurchaseOrder;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog purchases-dialog purchases-dialog--narrow" aria-describedby="close-po-help">
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">Close {po.poNo} short?</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <form
            className="users-dialog__body"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirm(reason.trim());
            }}
          >
            <p id="close-po-help" className="text-sm text-gray-600">
              What was received stays in stock. This will no longer be expected from {po.supplier.name}:
            </p>
            <p className="purchases-message purchases-message--error">
              <PackageX size={15} className="shrink-0" /> {remainingText(po) || "Nothing"}
            </p>
            <label>
              <span className="erp-label">Reason</span>
              <textarea
                className="erp-input h-auto min-h-20 py-2"
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Distributor out of stock"
              />
              <span className="mt-1 block text-[11px] text-gray-500">Optional. Kept in the audit log.</span>
            </label>
            <div className="users-dialog__foot">
              <Button variant="outline" disabled={busy} onClick={onClose}>Keep open</Button>
              <Button type="submit" variant="danger" disabled={busy}><PackageX size={15} /> {busy ? "Closing..." : "Close PO"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
