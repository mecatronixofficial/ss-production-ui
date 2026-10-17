"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  ClipboardCheck,
  CornerDownLeft,
  Factory,
  FileText,
  Gauge,
  Layers,
  Loader2,
  PackageCheck,
  ReceiptIndianRupee,
  Search,
  Truck,
  UsersRound,
  Warehouse as WarehouseIcon,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { api, qs } from "@/lib/api";
import { ADMIN_ROLES, navFor } from "@/lib/navigation";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type Kind = "item" | "batch" | "run" | "machine" | "sale" | "purchase" | "receipt" | "challan" | "distributor" | "textile" | "warehouse";
type Hit = { kind: Kind; key: string; title: string; subtitle: string | null };
type Result = { group: string; icon: LucideIcon; title: string; subtitle: string | null; href: string };

const GROUP: Record<Kind, { label: string; icon: LucideIcon }> = {
  item: { label: "Yarn, fabric & item codes", icon: Boxes },
  batch: { label: "Production batches", icon: Factory },
  run: { label: "Knitting runs", icon: Layers },
  machine: { label: "Machines", icon: Wrench },
  sale: { label: "Sales & delivery challans", icon: ReceiptIndianRupee },
  purchase: { label: "Purchase orders", icon: PackageCheck },
  receipt: { label: "Goods received", icon: ClipboardCheck },
  challan: { label: "Warehouse challans", icon: FileText },
  distributor: { label: "Distributors", icon: Truck },
  textile: { label: "Textiles", icon: UsersRound },
  warehouse: { label: "Warehouses", icon: WarehouseIcon },
};

/** Where each result opens. Yarn and fabric codes (batches too) open their full story on the item page. */
function hrefFor(hit: Hit, admin: boolean) {
  const code = encodeURIComponent(hit.key);
  switch (hit.kind) {
    case "item":
    case "batch":
      return `/warehouses/item?code=${code}`;
    case "run":
      return `/masters/machines/run?code=${code}`;
    case "machine":
      return `/masters/machines/${hit.key}`;
    case "sale":
      return `/sales/${hit.key}`;
    case "purchase":
      return `/purchases/${hit.key}`;
    case "receipt":
      return `/challans?tab=received&open=${hit.key}`;
    case "challan":
      return admin ? `/challans?tab=warehouse&open=${hit.key}` : "/warehouses?view=bills";
    case "distributor":
      return `/masters/distributors/${hit.key}`;
    case "textile":
      return `/masters/textiles/${hit.key}`;
    case "warehouse":
      return `/warehouses${qs({ warehouse: hit.key })}`;
  }
}

/**
 * The search box in the top bar: pages, and anything with a code or a name: yarn and fabric codes (opening their full
 * story), production batches, knitting runs, machines, sales, purchase orders, goods receipts, warehouse challans,
 * distributors, textiles and warehouses. Ctrl+K (or ⌘K) jumps to it; arrows and Enter pick; Enter on a typed code
 * with no match opens that code's details.
 */
export function GlobalSearch({ role }: { role: Role }) {
  const router = useRouter();
  const admin = ADMIN_ROLES.includes(role);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const q = query.trim();

  // Ctrl+K / ⌘K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Ask the server a moment after typing stops; a newer query cancels the older one.
  useEffect(() => {
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Hit[]>(`/search${qs({ q })}`, { signal: controller.signal, silent: true })
        .then((rows) => {
          setHits(rows);
          setActive(0);
        })
        .catch(() => undefined)
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const pages = useMemo<Result[]>(() => {
    if (!q) return [];
    const needle = q.toLowerCase();
    return navFor(role)
      .flatMap((section) => section.items)
      .filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((item) => ({ group: "Pages", icon: item.icon, title: item.label, subtitle: item.description, href: item.href }));
  }, [q, role]);

  const results = useMemo<Result[]>(
    () => [
      ...hits.map((hit) => ({ group: GROUP[hit.kind].label, icon: GROUP[hit.kind].icon, title: hit.title, subtitle: hit.subtitle, href: hrefFor(hit, admin) })),
      ...pages,
    ],
    [hits, pages, admin],
  );

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    setHits([]);
    input.current?.blur();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active] ?? results[0];
      if (pick) go(pick.href);
      // A full code typed with no match yet (e.g. still loading): open its details.
      else if (q.length >= 2) go(`/warehouses/item?code=${encodeURIComponent(q)}`);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  // Results in their groups, numbered in display order for the keyboard.
  let index = -1;
  const groups = results.reduce<Array<{ name: string; rows: Array<Result & { index: number }> }>>((all, row) => {
    index += 1;
    const group = all.find((g) => g.name === row.group);
    if (group) group.rows.push({ ...row, index });
    else all.push({ name: row.group, rows: [{ ...row, index }] });
    return all;
  }, []);

  return (
    <div ref={box} className={cn("global-search", open && "is-open")}>
      <button type="button" className="global-search__toggle" aria-label="Search" onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }}>
        <Search size={18} />
      </button>
      <div className="global-search__field">
        <Search size={16} className="global-search__icon" aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search code, page, party…"
          aria-label="Search the ERP"
          role="combobox"
          aria-expanded={open && q.length > 0}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? <Loader2 size={15} className="global-search__spin animate-spin" /> : query ? (
          <button type="button" className="global-search__clear" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }}>
            <X size={14} />
          </button>
        ) : (
          <kbd className="global-search__kbd">Ctrl K</kbd>
        )}
      </div>

      {open && q.length > 0 && (
        <div id="global-search-results" className="global-search__panel" role="listbox">
          {q.length < 2 ? (
            <p className="global-search__hint">Type at least 2 letters of a code, page or name.</p>
          ) : groups.length === 0 ? (
            loading ? (
              <p className="global-search__hint">Searching…</p>
            ) : (
              <div className="global-search__empty">
                <p>Nothing found for “{q}”.</p>
                <button type="button" onClick={() => go(`/warehouses/item?code=${encodeURIComponent(q)}`)}>
                  <Gauge size={14} /> Look up item code {q.toUpperCase()}
                </button>
              </div>
            )
          ) : (
            groups.map((group) => (
              <div key={group.name} className="global-search__group">
                <p className="global-search__group-title">{group.name}</p>
                {group.rows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <button
                      key={`${row.href}-${row.index}`}
                      type="button"
                      role="option"
                      aria-selected={row.index === active}
                      className={cn("global-search__row", row.index === active && "is-active")}
                      onMouseEnter={() => setActive(row.index)}
                      onClick={() => go(row.href)}
                    >
                      <span className="global-search__row-icon"><Icon size={15} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-[#1b3c55]">{row.title}</span>
                        {row.subtitle && <span className="block truncate text-[11px] text-gray-500">{row.subtitle}</span>}
                      </span>
                      {row.index === active && <CornerDownLeft size={13} className="shrink-0 text-gray-400" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          <p className="global-search__foot">↑ ↓ to move · Enter to open · Esc to close</p>
        </div>
      )}
    </div>
  );
}
