import { unitQty } from "@/lib/utils";

/** A warehouse with the stock it holds now, from `/masters/warehouses/summary`. */
export type WarehouseSummary = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  active: boolean;
  /** Net stock per unit, e.g. { KG: 1250.5 }. */
  totals: Record<string, number>;
  /** The same per material, e.g. { YARN: { KG: 2000 } }. */
  byCategory: Record<string, Record<string, number>>;
  itemCount: number;
  /** Open purchase orders being delivered here. */
  incomingOrders: number;
  /** Has stock movements or receipts, so it can only be deactivated, not deleted. */
  used: boolean;
};

/** Each material's colour, the same on every warehouse view (tiles, stock bars, the picker and the list). */
export const MATERIAL_COLORS: Record<string, string> = {
  YARN: "#059669",
  GREY_FABRIC: "#64748b",
  DYED_FABRIC: "#2563eb",
  FINISHED_FABRIC: "#d97706",
  RAW_MATERIAL: "#0d9488",
  CHEMICAL: "#7c3aed",
  PACKING: "#be185d",
};
export const materialColor = (category: string) => MATERIAL_COLORS[category] ?? "#94a3b8";
/** KG held (only positive KG: cones, bags and other units can't be added to it). */
export const kgHeld = (totals: Record<string, number>) => Object.entries(totals).reduce((sum, [unit, value]) => sum + (unit.toUpperCase() === "KG" && value > 0 ? value : 0), 0);

/** "1,250kg 500g", "40.000 CONE". */
export const quantity = (value: number, unit: string) => unitQty(value, unit);

/** "1,250kg 500g · 40.000 CONE", or "Empty". */
export const stockText = (w: Pick<WarehouseSummary, "totals">) =>
  Object.entries(w.totals).map(([unit, value]) => quantity(value, unit)).join(" · ") || "Empty";
