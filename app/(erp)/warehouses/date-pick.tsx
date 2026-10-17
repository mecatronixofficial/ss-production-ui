"use client";

import { useRef } from "react";
import { CalendarDays } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

/**
 * A date as a calendar icon (no "mm/dd/yyyy" text): clicking it opens the browser's date picker. Once a date is
 * chosen it shows next to the icon. `value` is `YYYY-MM-DD` or "".
 */
export function DatePick({ value, onChange, label, min, max }: { value: string; onChange: (value: string) => void; label: string; min?: string; max?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  return (
    <span className={cn("wh-datepick", value && "is-set")}>
      <button type="button" onClick={open} title={value ? `${label}: ${formatDate(`${value}T00:00:00`)}` : `Choose ${label.toLowerCase()}`} aria-label={value ? `${label}: ${formatDate(`${value}T00:00:00`)}` : `Choose ${label.toLowerCase()}`}>
        <CalendarDays size={15} />
        {value && <span>{formatDate(`${value}T00:00:00`)}</span>}
      </button>
      {/* The real input stays invisible; it only supplies the picker. */}
      <input ref={input} type="date" tabIndex={-1} aria-hidden className="wh-datepick__input" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
