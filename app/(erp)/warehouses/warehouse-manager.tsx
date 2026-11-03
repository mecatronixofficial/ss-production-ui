"use client";

import { useState } from "react";
import { ArrowRight, Boxes, MapPin, PackageOpen, Pencil, Plus, Power, Search, ShoppingCart, Trash2, Warehouse as WarehouseIcon, X } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { cn, humanize, kg } from "@/lib/utils";
import { kgHeld, materialColor, quantity, stockText, type WarehouseSummary } from "@/lib/warehouses";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineMessage } from "@/components/ui/inline-message";
import { ErrorState } from "@/components/page-state";
import { WarehouseMark } from "./warehouse-picker";

const blank = { code: "", name: "", location: "" };
/** Same rule as the API: letters, numbers and dashes, up to 30. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,29}$/;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * "View all warehouses": every warehouse with the stock it holds (KG, and by material as one bar), the purchase orders
 * on their way to it, found by code, name or place and narrowed to active, inactive, holding stock or empty. Opening one
 * shows its stock.
 * Admins can add, edit, deactivate and delete warehouses (the API enforces this too).
 */
export function WarehouseManager({ canManage, onOpen, onChanged }: { canManage: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const summary = useApiQuery<WarehouseSummary[]>("/masters/warehouses/summary");
  const [editing, setEditing] = useState<WarehouseSummary | "new" | null>(null);
  const [form, setForm] = useState(blank);
  const [find, setFind] = useState("");
  const [show, setShow] = useState<"all" | "active" | "inactive" | "stock" | "empty">("all");
  const [order, setOrder] = useState<"code" | "stock">("code");
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
  if (!summary.data) return <ManagerSkeleton />;
  const list = summary.data;
  const incomingTotal = list.reduce((sum, w) => sum + w.incomingOrders, 0);
  const fleetKg = list.reduce((sum, w) => sum + kgHeld(w.totals), 0);
  const holding = list.filter((w) => w.itemCount > 0 || kgHeld(w.totals) > 0);
  const q = find.trim().toUpperCase();
  const shown = list
    .filter((w) =>
      show === "active" ? w.active : show === "inactive" ? !w.active : show === "stock" ? holding.includes(w) : show === "empty" ? !holding.includes(w) : true,
    )
    .filter((w) => !q || [w.code, w.name, w.location].some((v) => v?.toUpperCase().includes(q)))
    .sort((a, b) => (order === "stock" ? kgHeld(b.totals) - kgHeld(a.totals) : 0) || Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
  const filters: Array<[typeof show, string, number]> = [
    ["all", "All", list.length],
    ["active", "Active", list.filter((w) => w.active).length],
    ["stock", "Holding stock", holding.length],
    ["empty", "Empty", list.length - holding.length],
    ["inactive", "Inactive", list.filter((w) => !w.active).length],
  ];

  return (
    <div className="warehouses-page whm">
      <div className="whm-stats">
        <div><span className="whm-stats__icon"><WarehouseIcon size={16} /></span><p>Warehouses</p><strong>{list.filter((w) => w.active).length}<small> / {list.length}</small></strong><span>active of all</span></div>
        <div><span className="whm-stats__icon is-stock"><Boxes size={16} /></span><p>Stock held</p><strong>{kg(fleetKg)}</strong><span>in KG, across {plural(holding.length, "warehouse")}</span></div>
        <div><span className="whm-stats__icon is-incoming"><ShoppingCart size={16} /></span><p>On the way</p><strong>{incomingTotal}</strong><span>{incomingTotal === 1 ? "purchase order" : "purchase orders"} to receive</span></div>
        <div><span className="whm-stats__icon is-empty"><PackageOpen size={16} /></span><p>Empty</p><strong>{list.length - holding.length}</strong><span>holding no stock</span></div>
      </div>

      <div className="whm-toolbar">
        <label className="whm-find">
          <Search size={15} aria-hidden />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by code, name or place" aria-label="Find a warehouse" />
        </label>
        <div className="whm-chips" role="group" aria-label="Show">
          {filters.map(([value, label, count]) => (
            <button key={value} type="button" aria-pressed={show === value} onClick={() => setShow(value)}>
              {label} <b>{count}</b>
            </button>
          ))}
        </div>
        <select className="erp-input w-auto" value={order} onChange={(e) => setOrder(e.target.value as typeof order)} aria-label="Order">
          <option value="code">By code</option>
          <option value="stock">Most stock first</option>
        </select>
        {canManage && (
          <Button className="ml-auto" onClick={() => openForm("new")}>
            <Plus size={16} /> Add warehouse
          </Button>
        )}
      </div>

      <InlineMessage message={message} />

      {editing && (
        <form
          noValidate
          className="warehouses-form whm-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          onKeyDown={(event) => event.key === "Escape" && !busy && setEditing(null)}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-bold">
              {editing === "new" ? <><Plus size={15} /> Add warehouse</> : <><WarehouseMark code={editing.code} /> Edit {editing.code}</>}
            </p>
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

      {list.length === 0 ? (
        <div className="warehouses-empty">No warehouses yet.{canManage && " Use “Add warehouse” to create the first one."}</div>
      ) : shown.length === 0 ? (
        <div className="warehouses-empty">No warehouse matches. <button type="button" className="font-bold underline" onClick={() => { setFind(""); setShow("all"); }}>Show all</button></div>
      ) : (
        <div className="whm-grid" role="list">
          {shown.map((w) => {
            const held = kgHeld(w.totals);
            const mix = Object.entries(w.byCategory)
              .map(([category, totals]) => ({ category, totals, kg: kgHeld(totals) }))
              .sort((a, b) => b.kg - a.kg);
            return (
              <article key={w.id} role="listitem" className={cn("whm-card", !w.active && "is-inactive")}>
                <button type="button" className="whm-card__main" title={`Open ${w.code}`} onClick={() => onOpen(w.id)}>
                  <span className="flex items-start gap-3">
                    <WarehouseMark code={w.code} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <b className="truncate text-base text-gray-900">{w.code}</b>
                        <span className={cn("whm-status", w.active ? "is-active" : "is-inactive")}>{w.active ? "Active" : "Inactive"}</span>
                      </span>
                      <span className="block truncate text-xs text-gray-500">{w.name}</span>
                      <span className="whm-card__place">{w.location ? <><MapPin size={11} /> {w.location}</> : "No location set"}</span>
                    </span>
                  </span>

                  <span className="whm-card__stock">
                    <span>
                      <span className="whm-card__label">In stock</span>
                      <b>{held > 0 ? kg(held) : stockText(w)}</b>
                      {held > 0 && Object.keys(w.totals).some((unit) => unit.toUpperCase() !== "KG") && <span className="whm-card__other">+ {Object.entries(w.totals).filter(([unit]) => unit.toUpperCase() !== "KG").map(([unit, value]) => quantity(value, unit)).join(" · ")}</span>}
                    </span>
                    <span className="text-right">
                      <span className="whm-card__label">Items</span>
                      <b>{w.itemCount}</b>
                    </span>
                  </span>

                  {mix.length > 0 ? (
                    <>
                      <span className="whm-card__mix" aria-hidden>
                        {mix.filter((m) => m.kg > 0).map((m) => <span key={m.category} style={{ width: `${held ? (m.kg / held) * 100 : 0}%`, background: materialColor(m.category) }} />)}
                      </span>
                      <span className="whm-card__legend">
                        {mix.map((m) => (
                          <span key={m.category}>
                            <i style={{ background: materialColor(m.category) }} />
                            <span className="truncate">{humanize(m.category)}</span>
                            <b>{Object.entries(m.totals).map(([unit, value]) => quantity(value, unit)).join(" · ")}</b>
                          </span>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span className="whm-card__nothing">Holds nothing right now</span>
                  )}

                  {fleetKg > 0 && held > 0 && (
                    <span className="whm-card__share">{Math.round((held / fleetKg) * 100)}% of all stock</span>
                  )}
                </button>

                <footer className="whm-card__foot">
                  {w.incomingOrders > 0 ? (
                    <span className="whm-card__incoming"><ShoppingCart size={12} /> {plural(w.incomingOrders, "PO")} on the way</span>
                  ) : (
                    <span className="text-[11px] text-gray-400">Nothing on the way</span>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    {canManage && (
                      <>
                        <button type="button" className="warehouses-action" aria-label={`Edit ${w.code}`} title="Edit" onClick={() => openForm(w)}><Pencil size={13} /></button>
                        <button type="button" className={cn("warehouses-action warehouses-action--toggle", !w.active && "is-inactive")} aria-label={`${w.active ? "Deactivate" : "Reactivate"} ${w.code}`} title={w.active ? "Deactivate" : "Reactivate"} onClick={() => void toggle(w)}><Power size={13} /></button>
                        <button type="button" className="warehouses-action warehouses-action--delete" disabled={w.used} aria-label={`Delete ${w.code}`} title={w.used ? "Has stock history: deactivate it instead" : "Delete"} onClick={() => void remove(w)}><Trash2 size={13} /></button>
                      </>
                    )}
                    <Button size="sm" variant="outline" onClick={() => onOpen(w.id)}>Open <ArrowRight size={13} /></Button>
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The list's shape while the warehouses load for the first time. */
function ManagerSkeleton() {
  return (
    <div className="warehouses-page whm" role="status" aria-label="Loading warehouses">
      <div className="whm-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[86px] animate-pulse bg-gray-100" />)}</div>
      <div className="whm-grid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-60 animate-pulse rounded-2xl bg-gray-100" />)}</div>
    </div>
  );
}
