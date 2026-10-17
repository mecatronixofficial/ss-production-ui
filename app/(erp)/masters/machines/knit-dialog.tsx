"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The window every Machines-page form opens in: a coloured icon, title and caption, a scrolling body and a sticky footer. */
export function KnitDialog({
  icon: Icon,
  tone = "green",
  title,
  caption,
  wide = false,
  busy = false,
  onClose,
  onSubmit,
  footer,
  children,
}: {
  icon: LucideIcon;
  tone?: "green" | "blue" | "gold";
  title: React.ReactNode;
  caption?: string;
  wide?: boolean;
  busy?: boolean;
  onClose: () => void;
  /** Makes the body a form; Enter in a field submits it. */
  onSubmit?: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const body = (
    <>
      {children}
      {footer && <div className="users-dialog__foot items-center">{footer}</div>}
    </>
  );
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className={cn("users-dialog knit-dialog", wide && "knit-dialog--wide")} aria-describedby={caption ? "knit-dialog-caption" : undefined}>
          <div className="users-dialog__head">
            <div className="flex min-w-0 items-center gap-3">
              <span className={cn("knit-dialog__icon", `is-${tone}`)}><Icon size={17} /></span>
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-bold text-[#123f35]">{title}</Dialog.Title>
                {caption && <Dialog.Description id="knit-dialog-caption" className="text-xs text-gray-500">{caption}</Dialog.Description>}
              </div>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          {onSubmit ? (
            <form
              noValidate
              className="users-dialog__body"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            <div className="users-dialog__body">{body}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A figure in a dialog's summary strip. */
export function Figure({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: string }) {
  return (
    <div className="knit-figure">
      <p className="knit-figure__label">{label}</p>
      <p className={cn("knit-figure__value", tone)}>{value}</p>
      {note && <p className="knit-figure__note">{note}</p>}
    </div>
  );
}
