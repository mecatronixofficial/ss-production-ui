"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CornerDownLeft, PackageX, Search, Warehouse as WarehouseIcon } from "lucide-react";
import type { Warehouse } from "@/lib/types";
import { cn, kg } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Field } from "./fields";

/** One stock position that can be started: an item code (and lot) in a warehouse, with the KG there. */
export type PickableStock = { itemCode: string; itemName: string; lotNo?: string | null; warehouseId: string; balanceKg: number };

/** One warehouse and code search shared by every process on a page, shown once instead of in each picker. */
export type StockScope = { warehouseId: string; search: string; setWarehouseId: (id: string) => void };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Picks the material to start a process with (yarn for knitting, grey fabric for dyeing, dyed fabric for
 * compacting): a warehouse dropdown and a code search, then the matching stock to tap. Enter in the search selects
 * the code typed, moving to its warehouse when it is somewhere else. A warehouse with none of it says so.
 * With a `scope`, the warehouse and search come from the page's shared controls and only the stock is shown.
 */
export function StockPicker<T extends PickableStock>({
  rows,
  warehouses,
  material,
  selectedKey,
  keyOf,
  onSelect,
  loading = false,
  scope,
}: {
  /** Stock that can be used for this process (already the right category, in KG, above zero). */
  rows: T[];
  /** Every warehouse, so one without this material can be chosen and say so. */
  warehouses: Warehouse[];
  /** "yarn", "grey fabric", "dyed fabric". */
  material: string;
  selectedKey: string;
  keyOf: (row: T) => string;
  onSelect: (row: T | null) => void;
  loading?: boolean;
  /** The page's shared warehouse and search; this picker then shows no controls of its own. */
  scope?: StockScope;
}) {
  const active = warehouses.filter((w) => w.active !== false);
  const warehouseOf = new Map(warehouses.map((w) => [w.id, w]));
  const live = rows.filter((row) => warehouseOf.get(row.warehouseId)?.active !== false);
  const countIn = (id: string) => live.filter((row) => row.warehouseId === id);
  const withStock = active.filter((w) => countIn(w.id).length > 0);
  // With the material in only one warehouse, start there.
  const [ownWarehouseId, setOwnWarehouseId] = useState("");
  const [ownSearch, setSearch] = useState("");
  const [notFound, setNotFound] = useState("");
  const shownWarehouse = scope ? scope.warehouseId : ownWarehouseId || (withStock.length === 1 ? withStock[0].id : "");
  const search = scope ? scope.search : ownSearch;
  const setWarehouseId = scope ? scope.setWarehouseId : setOwnWarehouseId;

  // A shared warehouse changed elsewhere: stock picked in another warehouse is no longer chosen.
  useEffect(() => {
    if (!scope || !shownWarehouse) return;
    const selected = live.find((row) => keyOf(row) === selectedKey);
    if (selected && selected.warehouseId !== shownWarehouse) onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the shared warehouse clears the pick.
  }, [shownWarehouse]);

  const needle = search.trim().toLowerCase();
  const inWarehouse = shownWarehouse ? countIn(shownWarehouse) : [];
  // Without a warehouse, a search looks through every warehouse (a shared scope shows all of them even before one).
  const pool = shownWarehouse ? inWarehouse : needle || scope ? live : [];
  const matches = needle ? pool.filter((row) => `${row.itemCode} ${row.itemName} ${row.lotNo ?? ""}`.toLowerCase().includes(needle)) : pool;
  const sorted = [...matches].sort((a, b) => a.itemCode.localeCompare(b.itemCode) || (a.lotNo ?? "").localeCompare(b.lotNo ?? ""));
  const warehouseName = (id: string) => {
    const w = warehouseOf.get(id);
    return w ? `${w.code}${w.name ? ` · ${w.name}` : ""}` : "this warehouse";
  };

  const chooseWarehouse = (id: string) => {
    setWarehouseId(id);
    setNotFound("");
    const selected = live.find((row) => keyOf(row) === selectedKey);
    if (selected && selected.warehouseId !== id) onSelect(null);
  };

  /** Enter: the exact code first (here, then anywhere), else the only match. */
  const pickTyped = () => {
    const code = search.trim().toUpperCase();
    if (!code) return;
    const exactHere = inWarehouse.filter((row) => row.itemCode.toUpperCase() === code);
    const exactAnywhere = live.filter((row) => row.itemCode.toUpperCase() === code);
    const pick = exactHere[0] ?? exactAnywhere[0] ?? (sorted.length === 1 ? sorted[0] : undefined);
    if (!pick) {
      setNotFound(
        sorted.length > 1
          ? `${plural(sorted.length, "match")} for “${search.trim()}”; tap the one you want.`
          : `No ${material} with code “${search.trim()}”${shownWarehouse ? ` in ${warehouseName(shownWarehouse)} or any other warehouse` : " in any warehouse"}.`,
      );
      return;
    }
    setNotFound("");
    if (pick.warehouseId !== shownWarehouse) setWarehouseId(pick.warehouseId);
    onSelect(pick);
  };

  return (
    <div className="stock-pick">
      {!scope && <div className="grid gap-3 md:grid-cols-2">
        <Field label="Warehouse" hint={loading ? "Loading…" : `${withStock.length} of ${active.length} have ${material}`}>
          <span className="stock-pick__control">
            <WarehouseIcon size={15} className="text-gray-400" aria-hidden />
            <select className="erp-input" value={shownWarehouse} onChange={(e) => chooseWarehouse(e.target.value)}>
              <option value="">Select warehouse</option>
              {active.map((w) => {
                const lines = countIn(w.id);
                return (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name} — {lines.length ? `${plural(lines.length, material)} · ${kg(lines.reduce((s, r) => s + r.balanceKg, 0))}` : "no stock"}
                  </option>
                );
              })}
            </select>
          </span>
        </Field>
        <Field label={`Search ${material} code`} hint="Type the code, press Enter">
          <span className="stock-pick__control">
            <Search size={15} className="text-gray-400" aria-hidden />
            <Input
              value={search}
              placeholder="e.g. 01SS26 or 01SS26-KT01"
              autoComplete="off"
              onChange={(e) => {
                setSearch(e.target.value);
                setNotFound("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pickTyped();
                }
              }}
            />
            <button type="button" className="stock-pick__enter" onClick={pickTyped} disabled={!search.trim()} aria-label="Select this code" title="Select this code">
              <CornerDownLeft size={14} />
            </button>
          </span>
        </Field>
      </div>}
      {notFound && <p className="stock-pick__message is-error">{notFound}</p>}

      <div className={cn(!scope && "mt-3")}>
        {loading ? (
          <p className="stock-pick__message">Loading {material} stock…</p>
        ) : !shownWarehouse && (!needle || !live.length) && (!scope || !live.length) ? (
          <p className="stock-pick__message">
            {live.length ? `Select a warehouse to see its ${material}, or type a code and press Enter.` : `No ${material} in stock in any warehouse.`}
          </p>
        ) : shownWarehouse && !inWarehouse.length ? (
          <div className="stock-pick__empty">
            <PackageX size={18} className="shrink-0" />
            <span>
              <b>No {material} in stock in {warehouseName(shownWarehouse)}.</b>
              {withStock.length > 0 && (
                <span className="block text-xs">
                  {material[0].toUpperCase() + material.slice(1)} is in {withStock.map((w) => w.code).join(", ")}.
                </span>
              )}
            </span>
          </div>
        ) : !sorted.length ? (
          <p className="stock-pick__message">
            No {material} matches “{search.trim()}”{shownWarehouse ? ` in ${warehouseName(shownWarehouse)}` : ""}.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11px] font-semibold text-gray-500">
              {plural(sorted.length, material)}
              {shownWarehouse ? ` in ${warehouseName(shownWarehouse)}` : " in all warehouses"}
            </p>
            <div className="yarn-pick__list" role="radiogroup" aria-label={`${material} in stock`}>
              {sorted.map((row) => {
                const isActive = keyOf(row) === selectedKey;
                return (
                  <button
                    key={keyOf(row)}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={cn("yarn-pick__item", isActive && "is-active")}
                    onClick={() => {
                      setNotFound("");
                      // Picked from a search across warehouses: show that warehouse from now on.
                      if (row.warehouseId !== shownWarehouse) setWarehouseId(row.warehouseId);
                      onSelect(row);
                    }}
                  >
                    <span className={cn("yarn-pick__dot", isActive && "is-active")}>{isActive && <CheckCircle2 size={14} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-bold text-[#1b3c55]">{row.itemCode}</span>
                      <span className="block truncate text-[12px] text-gray-700">{row.itemName}</span>
                      {(row.lotNo || !shownWarehouse) && (
                        <span className="block text-[11px] text-gray-500">
                          {[!shownWarehouse && warehouseOf.get(row.warehouseId)?.code, row.lotNo && `Lot ${row.lotNo}`].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold text-gray-800">{kg(row.balanceKg)}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400">in stock</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
