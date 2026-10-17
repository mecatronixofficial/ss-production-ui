"use client";

import { useRef, useState } from "react";
import { Eye, FileText, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { toast } from "@/lib/toast-store";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AttachmentStage, FlowAttachment } from "./types";

/** What the API accepts (StorageService.ALLOWED_UPLOAD_TYPES), up to 10 MB each. */
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,text/csv,.xls,.xlsx";
const MAX_BYTES = 10 * 1024 * 1024;

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Documents and photos for one process of a batch: upload several at once, open, delete (or only open, `readOnly`). */
export function Attachments({
  flowId,
  stage,
  attachments,
  onChanged = () => undefined,
  readOnly = false,
}: {
  flowId: string;
  stage: AttachmentStage;
  attachments: FlowAttachment[];
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const mine = attachments.filter((a) => a.stage === stage);
  const base = `/production/fabric-flows/${flowId}/attachments`;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const tooBig = [...files].filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast.warning(`${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 10 MB and not added.`, "File too large");
    const ok = [...files].filter((f) => f.size <= MAX_BYTES);
    setUploading(true);
    let added = 0;
    try {
      for (const file of ok) {
        const body = new FormData();
        body.append("stage", stage);
        body.append("file", file);
        try {
          await api(base, { method: "POST", body });
          added++;
        } catch {
          // api() already showed why this file was refused; carry on with the rest.
        }
      }
      if (added) {
        toast.success(`${added} file${added === 1 ? "" : "s"} attached.`);
        onChanged();
      }
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  /** Fetched with the signed-in session and opened in a new tab; storage is never exposed directly. */
  const open = async (attachment: FlowAttachment) => {
    const tab = window.open("", "_blank");
    try {
      const res = await api<Response>(`${base}/${attachment.id}`);
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
    }
  };

  const remove = async (attachment: FlowAttachment) => {
    const ok = await confirmDialog({ title: `Delete ${attachment.fileName}?`, description: "The file is removed from this batch for good.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await api(`${base}/${attachment.id}`, { method: "DELETE" });
      toast.success(`${attachment.fileName} deleted.`);
      onChanged();
    } catch {
      // api() already showed the error.
    }
  };

  if (readOnly && mine.length === 0) return <p className="text-xs text-gray-400">No documents or photos.</p>;

  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">Challans, bills or photos: images, PDF or Excel, up to 10 MB each.</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => void upload(e.target.files)} aria-label="Attach documents or photos" />
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
            <Paperclip size={14} /> {uploading ? "Uploading…" : "Attach files"}
          </Button>
        </div>
      )}
      {mine.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">No documents or photos yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border">
          {mine.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500">
                {a.mimeType.startsWith("image/") ? <ImageIcon size={15} /> : <FileText size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-800">{a.fileName}</span>
                <span className="block text-[11px] text-gray-400">{size(a.sizeBytes)} · {formatDateTime(a.createdAt)}</span>
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => void open(a)} aria-label={`Open ${a.fileName}`}><Eye size={14} /></Button>
              {!readOnly && <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => void remove(a)} aria-label={`Delete ${a.fileName}`}><Trash2 size={14} /></Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
