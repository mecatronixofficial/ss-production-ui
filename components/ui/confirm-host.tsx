"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { settleConfirm, subscribeConfirm, type ConfirmRequest } from "@/lib/confirm-store";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Renders requests made through `confirmDialog()`. Mounted once in the root layout. */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  useEffect(() => subscribeConfirm(setRequest), []);
  const danger = request?.tone === "danger";

  return (
    <Dialog.Root open={Boolean(request)} onOpenChange={(open) => !open && settleConfirm(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl focus:outline-none"
          onOpenAutoFocus={(event) => {
            // Focus the safe action first for destructive confirmations.
            if (danger) {
              event.preventDefault();
              (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
            }
          }}
        >
          <div className="flex gap-4">
            <div
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
                danger ? "bg-red-50 text-red-600" : "bg-primary/10 text-primary",
              )}
            >
              {danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
            </div>
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-gray-900">{request?.title}</Dialog.Title>
              {request?.description ? (
                <Dialog.Description className="mt-1.5 text-sm leading-6 text-gray-500">
                  {request.description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Confirm this action</Dialog.Description>
              )}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" data-cancel onClick={() => settleConfirm(false)}>
              {request?.cancelLabel || "Cancel"}
            </Button>
            <Button variant={danger ? "danger" : "default"} onClick={() => settleConfirm(true)}>
              {request?.confirmLabel || "Confirm"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
