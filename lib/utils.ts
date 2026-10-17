import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Numeric = number | string | undefined | null;

// Intl formatters are expensive to construct; build them once and reuse.
const wholeFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const moneyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const toNumber = (value: Numeric) => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
};

/**
 * A weight in KG, to the gram: 200.3 → "200kg 300g", 0.75 → "750g", 12 → "12kg".
 * Weights are stored in KG with 3 decimals (kg.grams, as they are typed: 200.300), so a gram is the smallest step.
 */
export function kg(v: Numeric) {
  const grams = Math.round(toNumber(v) * 1000);
  const sign = grams < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(grams) / 1000);
  const rest = Math.abs(grams) % 1000;
  if (!whole && rest) return `${sign}${rest}g`;
  return `${sign}${wholeFormat.format(whole)}kg${rest ? ` ${rest}g` : ""}`;
}

/** Units that are weights: shown as KG + g, and entered in KG or grams. */
export const isWeightUnit = (unit?: string | null) => ["KG", "G"].includes((unit ?? "").trim().toUpperCase());

/** A quantity in its unit; KG and G (grams) read as weights, e.g. "12kg 345g", "500g". */
export function unitQty(value: Numeric, unit: string, digits = 3) {
  const u = unit.trim().toUpperCase();
  if (u === "KG") return kg(value);
  if (u === "G") return kg(toNumber(value) / 1000);
  return `${toNumber(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

export function money(v: Numeric) {
  return `₹${moneyFormat.format(toNumber(v))}`;
}

const parseDate = (value?: string | Date | null) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function formatDate(value?: string | Date | null, fallback = "—") {
  const parsed = parseDate(value);
  return parsed ? dateFormat.format(parsed) : fallback;
}

export function formatDateTime(value?: string | Date | null, fallback = "—") {
  const parsed = parseDate(value);
  return parsed ? dateTimeFormat.format(parsed) : fallback;
}

/** Today's date as `YYYY-MM-DD` in local time (for `<input type="date">`). */
export function todayInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Fabric GSM as shown: "180" → "180 GSM"; text that already says more is kept as typed. */
export const gsmText = (gsm?: string | null) => (gsm?.trim() ? (/^\d+(\.\d+)?$/.test(gsm.trim()) ? `${gsm.trim()} GSM` : gsm.trim()) : null);

/** `PARTIALLY_RECEIVED` → `PARTIALLY RECEIVED` */
export const humanize = (value?: string | null) => (value ?? "").replaceAll("_", " ");

export const errorMessage = (error: unknown, fallback = "Something went wrong") =>
  error instanceof Error && error.message ? error.message : fallback;

/** Removes empty-string values so optional DTO fields (e.g. @IsEmail) aren't sent blank. */
export function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => !(typeof value === "string" && value.trim() === "")),
  ) as Partial<T>;
}
