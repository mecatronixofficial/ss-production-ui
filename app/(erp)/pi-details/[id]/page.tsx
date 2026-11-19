"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, ChevronDown, ClipboardCopy, Link2, Mail, MessageCircle, Pencil, Printer, RefreshCw, Send, Share2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { confirmDialog } from "@/lib/confirm-store";
import { toast } from "@/lib/toast-store";
import { cn, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { PiRecordDetails, PiSummary, piDone, piStatus, when } from "../pi-details";
import { EditKnittingDialog } from "../edit-knitting";
import type { PiDetails, PiOne } from "../pi-types";

/** The lines a message carries about one production code. */
function summaryText(row: PiDetails) {
  return [
    `Production ${row.code}${row.piNo ? ` · PI ${row.piNo}` : ""}`,
    `Yarn: ${row.yarnCode || "Yarn allocation"} · ${row.yarnCount}`,
    row.fabric && `Fabric: ${row.fabric}`,
    `Started: ${when(row.startedAt)} · ${piStatus(row)}`,
    `Yarn given: ${kg(row.yarn.givenKg)}`,
    `Finished fabric: ${kg(row.summary.finishedKg)}`,
    `Production loss: ${kg(row.summary.productionLossKg)}`,
    `Delivered: ${kg(row.summary.deliveredKg)}`,
    `Remaining: ${kg(row.summary.remainingKg)}`,
    `Total cost: ${money(row.summary.totalCost)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`, "Copied");
  } catch {
    toast.error("This browser didn't allow copying; select the text and copy it instead.");
  }
}

function PiShareMenu({ row }: { row: PiDetails }) {
  const title = `PI details ${row.code}`;
  const link = typeof window === "undefined" ? "" : window.location.href;
  const text = summaryText(row);
  const message = `${text}\n\nOpen: ${link}`;
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  const enc = encodeURIComponent;
  const share = async () => {
    try {
      if (typeof navigator.share === "function") await navigator.share({ title, text, url: link });
      else await copy(message, "PI details");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error("Could not share the PI details");
    }
  };
  const items: Array<{ key: string; label: string; icon: typeof Share2; run: () => void; tone?: string } | "sep"> = [
    { key: "share", label: "Share…", icon: Share2, run: () => void share() },
    "sep",
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, tone: "is-whatsapp", run: () => open(`https://wa.me/?text=${enc(message)}`) },
    { key: "telegram", label: "Telegram", icon: Send, tone: "is-telegram", run: () => open(`https://t.me/share/url?url=${enc(link)}&text=${enc(text)}`) },
    { key: "email", label: "Email", icon: Mail, run: () => (window.location.href = `mailto:?subject=${enc(title)}&body=${enc(message)}`) },
    "sep",
    { key: "copy", label: "Copy details", icon: ClipboardCopy, run: () => void copy(message, "PI details") },
    { key: "link", label: "Copy link", icon: Link2, run: () => void copy(link, "Link") },
    { key: "print", label: "Print / save as PDF", icon: Printer, run: () => window.print() },
  ];
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="outline" className="share-menu__trigger" aria-label={`Share: ${title}`}>
          <Share2 size={14} /> Share <ChevronDown size={13} className="opacity-60" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="share-menu">
          <DropdownMenu.Label className="share-menu__title">{title}</DropdownMenu.Label>
          {items.map((item, index) =>
            item === "sep" ? (
              <DropdownMenu.Separator key={`sep-${index}`} className="share-menu__sep" />
            ) : (
              <DropdownMenu.Item key={item.key} className={cn("share-menu__item", item.tone)} onSelect={item.run}>
                <item.icon size={15} className="share-menu__icon" />
                <span>{item.label}</span>
              </DropdownMenu.Item>
            ),
          )}
          <p className="share-menu__note">Messages carry the summary and a link to this page. For a PDF, choose Print and save as PDF.</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default function PiDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const report = useApiQuery<PiOne>(`/dashboard/pi-details/${encodeURIComponent(id)}`);
  const { reload } = report;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const row = report.data?.data;

  if (!row) {
    return report.error ? (
      <div className="pi-page">
        <Link href="/pi-details" className="pi-back"><ArrowLeft size={14} /> All PI details</Link>
        <ErrorState message={report.error} onRetry={() => void reload()} />
      </div>
    ) : <Loading />;
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete ${row.code}?`,
      description: `Its ${kg(row.yarn.givenKg)} of yarn goes back into stock, idle machine runs are removed and their machines freed. Only a batch that is still knitting, with nothing finished, delivered, charged or on a challan, can be deleted. This can't be undone.`,
      confirmLabel: "Delete batch",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api(`/production/fabric-flows/${row.id}`, { method: "DELETE", silent: true });
      toast.success(`${row.code} was deleted and its yarn returned to stock.`, "Deleted");
      router.replace("/pi-details");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not delete the batch", "Not deleted");
      setDeleting(false);
    }
  };

  return (
    <div className="pi-page">
      <div className="pi-page-toolbar pi-no-print">
        <Link href="/pi-details" className="pi-back"><ArrowLeft size={14} /> All PI details</Link>
        <div className="pi-page-actions">
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={report.loading} aria-label="Refresh">
            <RefreshCw size={14} className={cn(report.loading && "animate-spin")} />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer size={14} /> Print</Button>
          <PiShareMenu row={row} />
          <Button size="sm" variant="danger" onClick={() => void remove()} disabled={deleting}><Trash2 size={14} /> {deleting ? "Deleting…" : "Delete"}</Button>
        </div>
      </div>

      <article className="pi-section pi-print" data-pi-print aria-label={`PI details ${row.code}`}>
        <header className="pi-page-head">
          <div>
            <p className="pi-eyebrow">PI details · yarn to delivery</p>
            <h2>{row.code}</h2>
            <p>{row.yarnCode || "Yarn allocation"} · {row.yarnCount}{row.piNo ? ` · PI ${row.piNo}` : ""} · started {when(row.startedAt)}</p>
            {row.fabric && <p>{row.fabric}</p>}
          </div>
          <span className={cn("pi-status", piDone(row) && "is-done")}>{piStatus(row)}</span>
        </header>
        <PiSummary row={row} />
        <PiRecordDetails row={row} />
        <p className="pi-print-foot">Printed {new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
      </article>

      {editing && (
        <EditKnittingDialog
          code={row.code}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
