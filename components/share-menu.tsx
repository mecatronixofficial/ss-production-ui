"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ClipboardCopy, FileDown, Link2, Loader2, Mail, MessageCircle, MessageSquareText, Printer, Send, Share2 } from "lucide-react";
import { apiBlob } from "@/lib/api";
import { toast } from "@/lib/toast-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** What a challan shares as: its PDF, a text summary, and a link that opens it in the ERP. */
export type ShareTarget = {
  /** e.g. "Delivery challan DC-2026-000009". */
  title: string;
  /** The PDF's API path and file name. */
  pdfPath: string;
  fileName: string;
  /** A few lines a message can carry: number, date, party, items, totals. */
  text: string;
  /** Opens this challan in the ERP (after signing in). */
  link: string;
};

/** The summary lines for a challan message. */
export function challanSummary(s: {
  title: string;
  date: string;
  party?: [string, string | null | undefined];
  place?: [string, string | null | undefined];
  vehicle?: string | null;
  lines?: string[];
  total?: string | null;
  value?: string | null;
  company?: string;
}) {
  return [
    s.title,
    `Date: ${s.date}`,
    s.party && `${s.party[0]}: ${s.party[1] || "—"}`,
    s.place && `${s.place[0]}: ${s.place[1] || "—"}`,
    s.vehicle && `Vehicle: ${s.vehicle}`,
    ...(s.lines ?? []).map((line, i) => `${i + 1}. ${line}`),
    s.total && `Total: ${s.total}`,
    s.value && `Value: ${s.value}`,
    s.company,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A link into this ERP, e.g. "/challans?tab=warehouse&open=…". */
export const appLink = (path: string) => (typeof window === "undefined" ? path : `${window.location.origin}${path}`);

async function pdfFile(target: ShareTarget) {
  const blob = await apiBlob(target.pdfPath);
  return new File([blob], target.fileName, { type: "application/pdf" });
}

function save(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`, "Copied");
  } catch {
    toast.error("This browser didn't allow copying; select the text and copy it instead.");
  }
}

const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
const enc = encodeURIComponent;

/**
 * Every way to send a challan: the PDF itself through the device's share sheet (WhatsApp, email, Drive… on phones),
 * WhatsApp, Telegram, email or SMS with its details and link, copy the details or the link, download the PDF, or print.
 * Messaging apps opened by link can't take a file, so those carry the details and the link; the PDF goes with
 * "Share PDF" or as a download to attach.
 */
export function ShareMenu({
  target,
  onPrint,
  label = "Share",
  size = "sm",
  className,
}: {
  target: ShareTarget;
  /** Shows a Print item (e.g. the open challan window). */
  onPrint?: () => void;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [busy, setBusy] = useState<"share" | "pdf" | null>(null);
  const message = `${target.text}\n\nOpen: ${target.link}`;

  const sharePdf = async () => {
    setBusy("share");
    try {
      const file = await pdfFile(target);
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: target.title, text: target.text });
      } else if (typeof navigator.share === "function") {
        // The device shares links but not files: send the details and link, and keep the PDF here.
        save(file);
        await navigator.share({ title: target.title, text: target.text, url: target.link });
      } else {
        save(file);
        await navigator.clipboard?.writeText(message).catch(() => undefined);
        toast.info("This browser can't share files, so the PDF was downloaded and the details copied: attach the PDF and paste the details.", "PDF downloaded");
      }
    } catch (error) {
      // Closing the share sheet is not an error.
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error(error instanceof Error ? error.message : "Could not share the challan");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("pdf");
    try {
      save(await pdfFile(target));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not get the PDF");
    } finally {
      setBusy(null);
    }
  };

  const items: Array<{ key: string; label: string; hint?: string; icon: typeof Share2; run: () => void; tone?: string } | "sep"> = [
    { key: "share", label: "Share PDF…", hint: "WhatsApp, email, Drive… with the file", icon: Share2, run: () => void sharePdf() },
    "sep",
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, tone: "is-whatsapp", run: () => open(`https://wa.me/?text=${enc(message)}`) },
    { key: "telegram", label: "Telegram", icon: Send, tone: "is-telegram", run: () => open(`https://t.me/share/url?url=${enc(target.link)}&text=${enc(target.text)}`) },
    { key: "email", label: "Email", icon: Mail, run: () => (window.location.href = `mailto:?subject=${enc(target.title)}&body=${enc(message)}`) },
    { key: "sms", label: "SMS", icon: MessageSquareText, run: () => (window.location.href = `sms:?&body=${enc(message)}`) },
    "sep",
    { key: "copy", label: "Copy details", icon: ClipboardCopy, run: () => void copy(message, "Challan details") },
    { key: "link", label: "Copy link", icon: Link2, run: () => void copy(target.link, "Link") },
    { key: "pdf", label: "Download PDF", icon: FileDown, run: () => void download() },
    ...(onPrint ? [{ key: "print", label: "Print", icon: Printer, run: onPrint }] : []),
  ];

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button size={size === "sm" ? "sm" : undefined} variant="outline" className={cn("share-menu__trigger", className)} disabled={busy !== null} aria-label={`${label}: ${target.title}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
          {label}
          <ChevronDown size={13} className="opacity-60" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="share-menu">
          <DropdownMenu.Label className="share-menu__title">{target.title}</DropdownMenu.Label>
          {items.map((item, index) =>
            item === "sep" ? (
              <DropdownMenu.Separator key={`sep-${index}`} className="share-menu__sep" />
            ) : (
              <DropdownMenu.Item key={item.key} className={cn("share-menu__item", item.tone)} onSelect={item.run}>
                <item.icon size={15} className="share-menu__icon" />
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {item.hint && <span className="block text-[11px] font-normal text-gray-400">{item.hint}</span>}
                </span>
              </DropdownMenu.Item>
            ),
          )}
          <p className="share-menu__note">WhatsApp, Telegram, email and SMS send the details and link; for the PDF file use Share PDF, or download it and attach.</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
