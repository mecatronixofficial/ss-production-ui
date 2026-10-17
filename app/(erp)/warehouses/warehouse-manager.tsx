"use client";

import { useState } from "react";
import { Pencil, Plus, Power, Trash2, Warehouse as WarehouseIcon, X } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { cn, humanize } from "@/lib/utils";
import { quantity, stockText, type WarehouseSummary } from "@/lib/warehouses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineMessage } from "@/components/ui/inline-message";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

const blank = { code: "", name: "", location: "" };
/** Same rule as the API: letters, numbers and dashes, up to 30. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,29}$/;

/**
 * "View all warehouses": every warehouse with the stock it holds. Opening one shows its stock.
 * Admins can add, edit, deactivate and delete warehouses (the API enforces this too).
 */
export function WarehouseManager({ canManage, onOpen, onChanged }: { canManage: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const summary = useApiQuery<WarehouseSummary[]>("/masters/warehouses/summary");
  const [editing, setEditing] = useState<WarehouseSummary | "new" | null>(null);
  const [form, setForm] = useState(blank);
  const { message, run, reject, busy } = useApiAction();

  const openForm = (target: WarehouseSummary | "new") => {
    setEditing(target);
    setForm(target === "new" ? blank : { code: target.code, name: target.name, location: target.location ?? "" });
  };
  // Quick-create menu links here with `?warehouse=all&new=1`.
  useNewParam(() => canManage && openForm("new"));

  const changed = () => {
    void summary.reload();
    onChanged();
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return reject("Code and name are required.", "Check warehouse");
    const isNew = editing === "new";
    if (isNew && !CODE_PATTERN.test(form.code.trim())) return reject("Code can use letters, numbers and dashes only (max 30), e.g. WH-YARN-2.", "Check warehouse");
    if (isNew && summary.data?.some((w) => w.code.toUpperCase() === form.code.trim())) return reject(`${form.code.trim()} already exists.`, "Check warehouse");
    const ok = await run(
      () =>
        isNew
          ? api("/masters/warehouses", { method: "POST", body: JSON.stringify({ code: form.code.trim(), name: form.name.trim(), location: form.location.trim() || undefined }) })
          : api(`/masters/warehouses/${(editing as WarehouseSummary).id}`, { method: "PATCH", body: JSON.stringify({ name: form.name.trim(), location: form.location.trim() || null }) }),
      isNew ? `Warehouse ${form.code.trim().toUpperCase()} added.` : `${form.code} updated.`,
    );
    if (ok) {
      setEditing(null);
      changed();
    }
  };

  const toggle = async (w: WarehouseSummary) => {
    const activate = !w.active;
    const ok = await confirmDialog({
      title: activate ? `Reactivate ${w.code}?` : `Deactivate ${w.code}?`,
      description: activate
        ? "It can take goods receipts and stock entries again."
        : "It stays in the list with its history, but can't take new receipts or stock entries. A warehouse that still holds stock can't be deactivated.",
      confirmLabel: activate ? "Reactivate" : "Deactivate",
      tone: activate ? undefined : "danger",
    });
    if (ok && (await run(() => api(`/masters/warehouses/${w.id}`, { method: "PATCH", body: JSON.stringify({ active: activate }) }), `${w.code} ${activate ? "reactivated" : "deactivated"}.`))) changed();
  };

  const remove = async (w: WarehouseSummary) => {
    const ok = await confirmDialog({
      title: `Delete ${w.code}?`,
      description: "It has never held stock, so it's removed completely.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (ok && (await run(() => api(`/masters/warehouses/${w.id}`, { method: "DELETE" }), `${w.code} deleted.`))) changed();
  };

  if (!summary.data && summary.error) return <ErrorState message={summary.error} onRetry={() => void summary.reload()} />;
  if (!summary.data) return <Loading />;
  const incomingTotal = summary.data.reduce((sum, w) => sum + w.incomingOrders, 0);

  return (
    <div className="warehouses-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {summary.data.filter((w) => w.active).length} active of {summary.data.length}
          {incomingTotal > 0 && ` · ${incomingTotal} purchase order${incomingTotal === 1 ? "" : "s"} on the way`} · open a warehouse to see its stock.
        </p>
        {canManage && (
          <Button onClick={() => openForm("new")}>
            <Plus size={16} /> Add warehouse
          </Button>
        )}
      </div>

      <InlineMessage message={message} />

      {editing && (
        <form
          noValidate
          className="warehouses-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          onKeyDown={(event) => event.key === "Escape" && !busy && setEditing(null)}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">{editing === "new" ? "Add warehouse" : `Edit ${editing.code}`}</p>
            <button type="button" className="warehouses-action" aria-label="Close" onClick={() => setEditing(null)}><X size={14} /></button>
          </div>
          <div className="grid gap-2.5 md:grid-cols-[minmax(0,.7fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <Field label="Code *" hint={editing === "new" ? "e.g. WH-YARN-2" : "Can’t be changed"}>
              <Input value={form.code} disabled={editing !== "new"} maxLength={30} className="uppercase" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, "") })} autoFocus={editing === "new"} />
            </Field>
            <Field label="Name *">
              <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={editing !== "new"} />
            </Field>
            <Field label="Location" hint="Optional">
              <Input value={form.location} maxLength={120} placeholder="Building, floor or address" onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <span className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Saving..." : editing === "new" ? "Add" : "Save"}</Button>
            </span>
          </div>
        </form>
      )}

      {summary.data.length === 0 ? (
        <div className="warehouses-empty">No warehouses yet.{canManage && " Use “Add warehouse” to create the first one."}</div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" role="list">
          {summary.data.map((w) => (
            <div key={w.id} role="listitem" className={cn("warehouses-tile", !w.active && "is-inactive")}>
              <button type="button" className="warehouses-tile__select" title={`Open ${w.code} stock`} onClick={() => onOpen(w.id)}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="warehouses-card__icon"><WarehouseIcon size={15} /></span>
                    <span className="truncate text-sm font-bold text-gray-900">{w.code}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {w.incomingOrders > 0 && <Badge tone="info">{w.incomingOrders} incoming</Badge>}
                    {!w.active && <Badge tone="warning">Inactive</Badge>}
                  </span>
                </span>
                <span className="mt-1 block truncate text-xs text-gray-500">{w.name}{w.location ? ` · ${w.location}` : ""}</span>
                <span className="warehouses-tile__stock">{stockText(w)}</span>
                {Object.keys(w.byCategory).length > 0 ? (
                  <span className="mt-0.5 block space-y-0.5">
                    {Object.entries(w.byCategory).map(([category, totals]) => (
                      <span key={category} className="flex justify-between gap-2 text-[11px] text-gray-500">
                        <span className="truncate">{humanize(category)}</span>
                        <span className="shrink-0 font-semibold text-gray-600">{Object.entries(totals).map(([unit, value]) => quantity(value, unit)).join(" · ")}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="block text-[11px] text-gray-400">No stock</span>
                )}
              </button>
              {canManage && (
                <span className="warehouses-tile__actions">
                  <button type="button" className="warehouses-action" aria-label={`Edit ${w.code}`} title="Edit" onClick={() => openForm(w)}><Pencil size={13} /></button>
                  <button type="button" className={cn("warehouses-action warehouses-action--toggle", !w.active && "is-inactive")} aria-label={`${w.active ? "Deactivate" : "Reactivate"} ${w.code}`} title={w.active ? "Deactivate" : "Reactivate"} onClick={() => void toggle(w)}><Power size={13} /></button>
                  <button type="button" className="warehouses-action warehouses-action--delete" disabled={w.used} aria-label={`Delete ${w.code}`} title={w.used ? "Has stock history: deactivate it instead" : "Delete"} onClick={() => void remove(w)}><Trash2 size={13} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
