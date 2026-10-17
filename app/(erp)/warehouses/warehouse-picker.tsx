"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, LayoutGrid, MapPin, Warehouse as WarehouseIcon } from "lucide-react";
import type { Warehouse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Which warehouse the page shows: a picker with each warehouse's icon, code and name, and a separate "All warehouses"
 * button for the list (where admins add and edit them). `value` is a warehouse id, or null on the list.
 */
export function WarehousePicker({ warehouses, value, onSelect, onAll }: { warehouses: Warehouse[]; value: string | null; onSelect: (id: string) => void; onAll: () => void }) {
  const current = warehouses.find((w) => w.id === value);
  return (
    <div className="wh-picker">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={cn("wh-picker__trigger", current && "is-chosen")} aria-label="Choose warehouse">
            <span className="wh-picker__icon"><WarehouseIcon size={17} /></span>
            <span className="min-w-0 text-left">
              <span className="wh-picker__eyebrow">{current ? "Warehouse" : "Choose a warehouse"}</span>
              <span className="wh-picker__name">{current ? <><b>{current.code}</b> · {current.name}</> : `${warehouses.length} warehouses`}</span>
            </span>
            <ChevronDown size={16} className="wh-picker__chevron" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={8} className="wh-picker__menu">
            <DropdownMenu.Label className="wh-picker__menu-label">Show stock of</DropdownMenu.Label>
            {warehouses.map((w) => (
              <DropdownMenu.Item key={w.id} className={cn("wh-picker__item", w.id === value && "is-current", w.active === false && "is-inactive")} onSelect={() => onSelect(w.id)}>
                <span className="wh-picker__item-icon"><WarehouseIcon size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm"><b>{w.code}</b> · {w.name}</span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {w.location ? <><MapPin size={10} className="mr-0.5 inline" />{w.location}</> : "No location set"}
                    {w.active === false ? " · inactive" : ""}
                  </span>
                </span>
                {w.id === value && <Check size={15} className="shrink-0 text-emerald-600" />}
              </DropdownMenu.Item>
            ))}
            {warehouses.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">No warehouses yet.</p>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button type="button" className={cn("wh-picker__all", !value && "is-active")} onClick={onAll} aria-pressed={!value} title="Every warehouse, with its stock">
        <LayoutGrid size={16} /> All
      </button>
    </div>
  );
}
