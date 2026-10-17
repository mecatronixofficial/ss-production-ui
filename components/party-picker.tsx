"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Building2, Check, ChevronDown, Plus, Search, Shirt, X } from "lucide-react";
import { api, ApiError, post } from "@/lib/api";
import { GSTIN_PATTERN } from "@/lib/india";
import { cn, errorMessage } from "@/lib/utils";
import { toast } from "@/lib/toast-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** A distributor or textile to pick, with its details for a bill. */
export type PickParty = { id: string; code: string; name: string; gst: string | null; mobile: string | null; address: string | null; city?: string | null };
export type PartyKind = "DISTRIBUTOR" | "TEXTILE";

const LABEL: Record<PartyKind, { one: string; list: string; icon: typeof Shirt; endpoint: string }> = {
  DISTRIBUTOR: { one: "distributor", list: "Distributors", icon: Building2, endpoint: "/masters/suppliers" },
  TEXTILE: { one: "textile", list: "Textiles", icon: Shirt, endpoint: "/masters/textiles" },
};
const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Searchable dropdown of distributors or textiles. When the one you need isn't on the list, "Add new" opens a short
 * form; the new party is saved to its list and picked straight away.
 */
export function PartyPicker({
  kind,
  parties,
  value,
  onChange,
  onCreated,
  invalid,
}: {
  kind: PartyKind;
  parties: PickParty[];
  value: string;
  onChange: (party: PickParty | null) => void;
  /** Called with a party just added, so the caller can reload its list. */
  onCreated?: (party: PickParty) => void;
  invalid?: boolean;
}) {
  const label = LABEL[kind];
  const selected = parties.find((p) => p.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const matches = useMemo(() => {
    const q = key(query);
    const list = q
      ? parties.filter((p) => [p.name, p.code, p.city, p.gst, p.mobile].some((v) => v && v.toLowerCase().includes(q)))
      : parties;
    return list.slice(0, 50);
  }, [parties, query]);
  const exact = parties.find((p) => key(p.name) === key(query));
  // The "Add new" row comes after the matches.
  const addIndex = matches.length;
  const rows = matches.length + 1;

  const choose = (party: PickParty) => {
    onChange(party);
    setQuery("");
    setOpen(false);
  };
  const startAdd = () => {
    setOpen(false);
    setAdding(query.trim());
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(rows - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!open) return setOpen(true);
      if (active < matches.length) choose(matches[active]);
      else startAdd();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className={cn("party-picker", open && "is-open", invalid && "is-invalid")} onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <Search size={14} className="shrink-0 text-gray-400" aria-hidden />
        <input
          ref={inputRef}
          className="party-picker__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={`Choose ${label.one}`}
          value={open ? query : selected ? `${selected.name}` : ""}
          placeholder={selected ? selected.name : `Search ${label.list.toLowerCase()} by name, code, city…`}
          autoComplete="off"
          onFocus={() => { setOpen(true); setActive(0); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={onKey}
        />
        {selected && !open && <span className="party-picker__code">{selected.code}</span>}
        {selected && !open ? (
          <button type="button" className="party-picker__clear" aria-label={`Clear ${label.one}`} onClick={(e) => { e.stopPropagation(); onChange(null); setQuery(""); }}>
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={14} className="shrink-0 text-gray-400" aria-hidden />
        )}
      </div>

      {open && (
        <ul id={listId} role="listbox" className="party-picker__list">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-xs text-gray-500">{parties.length ? `No ${label.one} matches “${query.trim()}”.` : `No ${label.list.toLowerCase()} yet.`}</li>
          )}
          {matches.map((p, index) => (
            <li
              key={p.id}
              role="option"
              aria-selected={p.id === value}
              className={cn("party-picker__option", index === active && "is-active")}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-gray-800">{p.name}</span>
                <span className="block truncate text-[11px] text-gray-500">{[p.code, p.city, p.gst, p.mobile].filter(Boolean).join(" · ")}</span>
              </span>
              {p.id === value && <Check size={14} className="shrink-0 text-emerald-600" aria-hidden />}
            </li>
          ))}
          <li
            role="option"
            aria-selected={false}
            className={cn("party-picker__option party-picker__add", active === addIndex && "is-active")}
            onMouseEnter={() => setActive(addIndex)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startAdd}
          >
            <Plus size={14} aria-hidden />
            {query.trim() && !exact ? <span>Add “{query.trim()}” as a new {label.one}</span> : <span>Add a new {label.one}</span>}
          </li>
        </ul>
      )}

      {adding !== null && (
        <QuickAddParty
          kind={kind}
          name={adding}
          existing={parties}
          onClose={() => setAdding(null)}
          onCreated={(party) => {
            onCreated?.(party);
            onChange(party);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const TERMS = ["Advance", "Immediate", "7 Days", "15 Days", "30 Days", "45 Days", "60 Days", "90 Days"];

/** Short "add" form for a distributor or textile, opened from the picker; more details can be added on its list later. */
function QuickAddParty({
  kind,
  name,
  existing,
  onClose,
  onCreated,
}: {
  kind: PartyKind;
  name: string;
  existing: PickParty[];
  onClose: () => void;
  onCreated: (party: PickParty) => void;
}) {
  const label = LABEL[kind];
  const Icon = label.icon;
  const [form, setForm] = useState({ name, gst: "", mobile: "", city: "", address: "", paymentTerms: "30 Days", contactPerson: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: e.target.value });

  const submit = async () => {
    setError("");
    const gst = form.gst.trim().toUpperCase();
    const twin = existing.find((p) => key(p.name) === key(form.name));
    const problem =
      !form.name.trim() ? `Enter the ${label.one}'s name.` :
      twin ? `${twin.code} · ${twin.name} is already on the list; pick it instead.` :
      gst && !GSTIN_PATTERN.test(gst) ? "Enter a valid 15-character GSTIN, e.g. 33ABCDE1234F1Z5." :
      form.mobile.trim() && !PHONE.test(form.mobile.trim()) ? "Enter a valid phone number, e.g. 98765 43210." :
      "";
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        gst: gst || undefined,
        mobile: form.mobile.trim() || undefined,
        address: form.address.trim() || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
        paymentTerms: form.paymentTerms || undefined,
        ...(kind === "TEXTILE" ? { city: form.city.trim() || undefined } : {}),
      };
      const created = await api<PickParty>(label.endpoint, { ...post(body), silent: true });
      toast.success(`${created.code} · ${created.name} added to ${label.list}.`);
      onCreated({ id: created.id, code: created.code, name: created.name, gst: created.gst ?? null, mobile: created.mobile ?? null, address: created.address ?? null, city: created.city ?? null });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e, "Could not add"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog money-dialog" aria-describedby="quick-party-help">
          <div className="users-dialog__head">
            <div className="flex min-w-0 items-center gap-3">
              <span className="master-dialog__icon"><Icon size={17} aria-hidden /></span>
              <Dialog.Title className="master-dialog__title">Add {label.one}</Dialog.Title>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <form className="users-dialog__body" noValidate onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
            <p id="quick-party-help" className="text-xs text-gray-500">
              Saved to your {label.list} list with the next code, and picked for this sale. Add more details there any time.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${kind === "TEXTILE" ? "Textile" : "Distributor"} name *`} className="sm:col-span-2">
                <Input value={form.name} maxLength={160} autoFocus onChange={set("name")} />
              </Field>
              <Field label="GSTIN" hint="Optional">
                <Input value={form.gst} maxLength={15} className="uppercase tracking-wide" placeholder="33ABCDE1234F1Z5" onChange={(e) => setForm({ ...form, gst: e.target.value.toUpperCase().replace(/\s/g, "") })} />
              </Field>
              <Field label="Mobile" hint="Optional">
                <Input type="tel" value={form.mobile} maxLength={30} placeholder="98765 43210" onChange={set("mobile")} />
              </Field>
              <Field label="Contact person" hint="Optional">
                <Input value={form.contactPerson} maxLength={120} onChange={set("contactPerson")} />
              </Field>
              {kind === "TEXTILE" ? (
                <Field label="City / town" hint="Optional">
                  <Input value={form.city} maxLength={80} onChange={set("city")} />
                </Field>
              ) : (
                <span className="hidden sm:block" />
              )}
              <Field label="Payment terms">
                <select className="erp-input" value={form.paymentTerms} onChange={set("paymentTerms")}>
                  {TERMS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Billing address" hint="Optional" className="sm:col-span-2">
                <Input value={form.address} maxLength={500} onChange={set("address")} />
              </Field>
            </div>
            {error && <p className="purchases-message purchases-message--error" role="alert">{error}</p>}
            <div className="users-dialog__foot">
              <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}><Plus size={15} /> {busy ? "Adding..." : `Add ${label.one}`}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
