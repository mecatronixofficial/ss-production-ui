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

/** "1,250kg 500g", "40.000 CONE". */
export const quantity = (value: number, unit: string) => unitQty(value, unit);

/** "1,250kg 500g · 40.000 CONE", or "Empty". */
export const stockText = (w: Pick<WarehouseSummary, "totals">) =>
  Object.entries(w.totals).map(([unit, value]) => quantity(value, unit)).join(" · ") || "Empty";
