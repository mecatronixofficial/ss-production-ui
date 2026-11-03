"use client";

import { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowRight, Check, ChevronDown, LayoutGrid, MapPin, Search, ShoppingCart, Warehouse as WarehouseIcon } from "lucide-react";
import type { Warehouse } from "@/lib/types";
import { prefetchApi, useApiQuery } from "@/lib/use-api-query";
import { kgHeld, materialColor, stockText, type WarehouseSummary } from "@/lib/warehouses";
import { cn, kg } from "@/lib/utils";

const SUMMARY_PATH = "/masters/warehouses/summary";
/** With more warehouses than this, the menu gets a search box. */
const SEARCH_FROM = 5;

/** A warehouse's two-letter mark from its code ("WH-YARN" → "YA", "GODOWN2" → "GO"), on a colour of its own. */
const markOf = (code: string) => {
  const parts = code.split(/[-_\s]+/).filter(Boolean);
  const word = parts.length > 1 && /^WH$/i.test(parts[0]) ? parts[1] : parts[0] ?? code;
  return word.slice(0, 2).toUpperCase();
};
const HUES = [152, 210, 28, 262, 190, 340, 96, 46];
const hueOf = (code: string) => HUES[[...code].reduce((sum, c) => sum + c.charCodeAt(0), 0) % HUES.length];

function Mark({ code, current }: { code: string; current?: boolean }) {
  const hue = hueOf(code);
  return (
    <span className={cn("wh-mark", current && "is-current")} style={{ "--mark-hue": hue } as React.CSSProperties} aria-hidden>
      {markOf(code)}
    </span>
  );
}

/**
 * Which warehouse the page shows. The menu finds a warehouse by code, name or place, lists the active ones and then
 * the inactive ones, and shows what each holds (KG, by material) and the purchase orders on their way to it — loaded
 * when the menu is pointed at or opened, not with the page. "All" opens the list of every warehouse.
 * `value` is a warehouse id, or null on the list.
 */
export function WarehousePicker({ warehouses, value, onSelect, onAll }: { warehouses: Warehouse[]; value: string | null; onSelect: (id: string) => void; onAll: () => void }) {
  const current = warehouses.find((w) => w.id === value);
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const { data: summary } = useApiQuery<WarehouseSummary[]>(open ? SUMMARY_PATH : null);
  const byId = useMemo(() => new Map((summary ?? []).map((w) => [w.id, w])), [summary]);
  const maxKg = useMemo(() => Math.max(0, ...(summary ?? []).map((w) => kgHeld(w.totals))), [summary]);

  const q = find.trim().toUpperCase();
  const matches = warehouses.filter((w) => !q || [w.code, w.name, w.location].some((v) => v?.toUpperCase().includes(q)));
  const groups = [
    { label: "Active", rows: matches.filter((w) => w.active !== false) },
    { label: "Inactive", rows: matches.filter((w) => w.active === false) },
  ].filter((g) => g.rows.length);

  return (
    <div className="wh-picker">
      <DropdownMenu.Root
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFind("");
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button type="button" className={cn("wh-picker__trigger", current && "is-chosen")} aria-label="Choose warehouse" onPointerEnter={() => prefetchApi(SUMMARY_PATH)}>
            {current ? <Mark code={current.code} current /> : <span className="wh-picker__icon"><WarehouseIcon size={17} /></span>}
            <span className="min-w-0 text-left">
              <span className="wh-picker__eyebrow">{current ? "Warehouse" : "Choose a warehouse"}</span>
              <span className="wh-picker__name">{current ? <><b>{current.code}</b> · {current.name}</> : `${warehouses.length} warehouses`}</span>
            </span>
            <ChevronDown size={16} className="wh-picker__chevron" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={8} className="wh-picker__menu" onCloseAutoFocus={(e) => e.preventDefault()}>
            <div className="wh-picker__menu-head">
              <span>Show stock of</span>
              <b>{warehouses.filter((w) => w.active !== false).length} active</b>
            </div>
            {warehouses.length > SEARCH_FROM && (
              <label className="wh-picker__find">
                <Search size={14} aria-hidden />
                <input
                  autoFocus
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  // Typing stays in the box (the menu would otherwise jump to an item starting with that letter).
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowDown" && e.key !== "Escape") e.stopPropagation();
                  }}
                  placeholder="Find by code, name or place"
                  aria-label="Find a warehouse"
                />
              </label>
            )}
            <div className="wh-picker__list">
              {groups.map((group) => (
                <DropdownMenu.Group key={group.label}>
                  {groups.length > 1 && <DropdownMenu.Label className="wh-picker__menu-label">{group.label}</DropdownMenu.Label>}
                  {group.rows.map((w) => {
                    const s = byId.get(w.id);
                    const held = s ? kgHeld(s.totals) : 0;
                    const mix = s ? Object.entries(s.byCategory).map(([category, totals]) => [category, kgHeld(totals)] as const).filter(([, v]) => v > 0) : [];
                    return (
                      <DropdownMenu.Item key={w.id} className={cn("wh-picker__item", w.id === value && "is-current", w.active === false && "is-inactive")} onSelect={() => onSelect(w.id)}>
                        <Mark code={w.code} current={w.id === value} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <b className="truncate text-sm text-gray-900">{w.code}</b>
                            {s && s.incomingOrders > 0 && <span className="wh-picker__tag" title={`${s.incomingOrders} purchase orders on the way`}><ShoppingCart size={10} /> {s.incomingOrders}</span>}
                          </span>
                          <span className="block truncate text-[11px] text-gray-500">
                            {w.name}
                            {w.location ? <> · <MapPin size={10} className="inline" /> {w.location}</> : null}
                          </span>
                          {s && (
                            <span className="wh-picker__stock">
                              <span className="wh-picker__bar" aria-hidden>
                                {mix.map(([category, v]) => (
                                  <span key={category} style={{ width: `${maxKg ? (v / maxKg) * 100 : 0}%`, background: materialColor(category) }} />
                                ))}
                              </span>
                              <span className="wh-picker__kg">{held > 0 ? kg(held) : stockText(s) === "Empty" ? "Empty" : stockText(s)}</span>
                            </span>
                          )}
                        </span>
                        {w.id === value && <Check size={15} className="shrink-0 text-emerald-600" />}
                      </DropdownMenu.Item>
                    );
                  })}
                </DropdownMenu.Group>
              ))}
              {warehouses.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">No warehouses yet.</p>}
              {warehouses.length > 0 && matches.length === 0 && <p className="px-3 py-3 text-xs text-gray-500">No warehouse matches “{find.trim()}”.</p>}
            </div>
            <DropdownMenu.Separator className="wh-picker__sep" />
            <DropdownMenu.Item className="wh-picker__item wh-picker__all-item" onSelect={onAll}>
              <span className="wh-picker__item-icon"><LayoutGrid size={15} /></span>
              <span className="flex-1 text-sm font-semibold">All warehouses</span>
              <ArrowRight size={14} className="text-gray-400" />
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button type="button" className={cn("wh-picker__all", !value && "is-active")} onClick={onAll} aria-pressed={!value} title="Every warehouse, with its stock">
        <LayoutGrid size={16} /> All
      </button>
    </div>
  );
}

export { Mark as WarehouseMark };
