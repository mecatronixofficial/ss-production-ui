"use client";
import * as React from "react";
import { cn, kg } from "@/lib/utils";
import { Input } from "./input";

/**
 * Reads a weight typed as kg.grams or with units, and returns it in KG (a string, as forms keep it):
 * "200.300" / "200.3" → 200.3, "200kg300g" / "200 kg 300 g" → 200.3, "750g" → 0.75, "12kg" → 12, "" → "".
 * Returns null when the text isn't a weight. Grams are the smallest step, so a weight has at most 3 decimals.
 */
export function parseWeight(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  if (t === "") return "";
  if (/^\d*\.?\d*$/.test(t)) return t === "." ? null : t;
  const m = /^(?:(\d+(?:\.\d+)?)(?:kg|kgs|k))?(?:(\d+(?:\.\d+)?)(?:g|gm|gms|gram|grams))?$/.exec(t);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const grams = Math.round(Number(m[1] ?? 0) * 1000 + Number(m[2] ?? 0));
  return String(grams / 1000);
}

const sameWeight = (a: string, b: string) =>
  a.trim() === "" || b.trim() === "" ? a.trim() === b.trim() : Math.abs(Number(a) - Number(b)) < 0.0005;
/** The KG value as kg.grams, e.g. 200.3 → "200.300". */
const asKgGrams = (value: string) => (value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value).toFixed(3) : value);

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "step" | "min" | "max" | "defaultValue"> & {
  /** The weight in KG, as a string (like any form field). */
  value: string;
  /** Always called with KG; with the raw text when it isn't a weight yet, so the form's own checks fail. */
  onValueChange: (kg: string) => void;
  /** Only show the "= 200kg 300g" line when something is wrong (for tight table cells). */
  compact?: boolean;
  /** Classes for the outer wrapper, e.g. flex-1 beside a button. */
  wrapperClassName?: string;
};

/**
 * A weight box in kg.grams: type 200.300 (or 200kg300g, 750g) for 200 kg 300 g. The value goes back to the form in
 * KG, and the line under the box reads it out ("= 200kg 300g") so a slip like 200.30 vs 200.030 is easy to see.
 */
export const WeightInput = React.forwardRef<HTMLInputElement, Props>(
  ({ value, onValueChange, compact, className, wrapperClassName, onBlur, placeholder = "0.000", ...rest }, ref) => {
    const [text, setText] = React.useState(() => asKgGrams(value));
    const parsed = parseWeight(text);
    // Keep what was typed unless the weight was changed from outside (a Max / All button, form reset).
    const shown = parsed !== null && sameWeight(parsed, value) ? text : parsed === null && text === value ? text : asKgGrams(value);
    const current = parseWeight(shown);
    const invalid = current === null || (current !== "" && /\.\d{4,}$/.test(current));

    return (
      <div className={cn("weight-input", wrapperClassName)}>
        <Input
          ref={ref}
          {...rest}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          className={cn("tabular-nums", invalid && "border-red-400", className)}
          value={shown}
          onChange={(e) => {
            setText(e.target.value);
            const next = parseWeight(e.target.value);
            onValueChange(next ?? e.target.value);
          }}
          onBlur={(e) => {
            // Settle on kg.grams: "200kg300g" and "200.3" both become 200.300; more than 3 decimals rounds to the gram.
            if (current !== null && current !== "") {
              const rounded = String(Math.round(Number(current) * 1000) / 1000);
              setText(Number(rounded).toFixed(3));
              if (rounded !== value) onValueChange(rounded);
            }
            onBlur?.(e);
          }}
        />
        {invalid ? (
          <p className="weight-input__hint is-error">Type kg.grams, like 200.300 or 200kg 300g</p>
        ) : (
          !compact && current !== "" && <p className="weight-input__hint">= {kg(current)}</p>
        )}
      </div>
    );
  },
);
WeightInput.displayName = "WeightInput";
