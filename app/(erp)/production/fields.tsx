import { useState } from "react";
import { CheckCircle2, CircleDashed, Warehouse as WarehouseIcon, ArrowRight, UserRound, type LucideIcon } from "lucide-react";
import { cn, kg } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { BadgeTone } from "@/components/ui/badge";
import type { ProcessDeliveryDestination } from "./types";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  warning?: string | null;
  /** Marks the label as needed to save. */
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

function FieldLabel({ label, hint, required }: Pick<FieldProps, "label" | "hint" | "required">) {
  return (
    <span className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-gray-500">
      <span>
        {label}
        {required && <span className="production-required" aria-label="required">*</span>}
      </span>
      {hint && <span className="font-medium normal-case tracking-normal text-gray-400">{hint}</span>}
    </span>
  );
}

function FieldMessages({ error, warning }: Pick<FieldProps, "error" | "warning">) {
  return (
    <>
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
      {!error && warning && <span className="mt-1 block text-[11px] text-amber-700">{warning}</span>}
    </>
  );
}

/** A labelled input for the stage forms; `error` blocks saving, `warning` only asks for a second look. */
export function Field({ label, hint, error, warning, required, className, children }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <FieldLabel label={label} hint={hint} required={required} />
      {children}
      <FieldMessages error={error} warning={warning} />
    </label>
  );
}

/** The same as Field for a group of buttons (a <label> would pass every click to its first button). */
export function FieldGroup({ label, hint, error, warning, required, className, children }: FieldProps) {
  return (
    <div className={cn("block", className)} role="group" aria-label={label}>
      <FieldLabel label={label} hint={hint} required={required} />
      {children}
      <FieldMessages error={error} warning={warning} />
    </div>
  );
}

/**
 * A process's charges, typed either as a rate per KG (the total follows from the weight) or as the total itself
 * (the rate per KG is shown from it). `value` is the total in rupees, as the form keeps it.
 */
export function ChargeInput({ label, value, onChange, weightKg }: { label: string; value: string; onChange: (total: string) => void; weightKg: number }) {
  const [rate, setRate] = useState("");
  const total = Number(value || 0);
  const shownRate = rate !== "" ? rate : weightKg > 0 && total > 0 ? String(Math.round((total / weightKg) * 100) / 100) : "";
  return (
    <FieldGroup label={label} hint={weightKg > 0 ? `₹ per KG × ${kg(weightKg)}` : "₹"}>
      <span className="charge-input">
        <Input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          aria-label={`${label}, rupees per KG`}
          placeholder="₹ / KG"
          disabled={!(weightKg > 0)}
          value={shownRate}
          onChange={(e) => {
            setRate(e.target.value);
            onChange(String(Math.round(Number(e.target.value || 0) * weightKg * 100) / 100));
          }}
        />
        <span aria-hidden>=</span>
        <Input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          aria-label={`${label}, total rupees`}
          placeholder="Total ₹"
          value={value}
          onChange={(e) => {
            setRate("");
            onChange(e.target.value);
          }}
        />
      </span>
    </FieldGroup>
  );
}

/** Where a finished process sends its fabric: on to the next process, or into a warehouse as stock. */
export function DestinationToggle({
  value,
  next,
  onChange,
  disabled,
}: {
  value: ProcessDeliveryDestination;
  /** The next process, e.g. "dyeing"; none after the last process. */
  next?: string;
  onChange: (value: ProcessDeliveryDestination) => void;
  disabled?: boolean;
}) {
  const options = [
    ...(next ? [{ value: "NEXT_PROCESS" as const, icon: ArrowRight, title: `On to ${next}`, text: `Straight to the ${next} mill` }] : []),
    { value: "WAREHOUSE" as const, icon: WarehouseIcon, title: "Into a warehouse", text: next ? `Kept as stock; start ${next} from it later` : "Kept as finished fabric stock" },
    { value: "PARTY" as const, icon: UserRound, title: "To a party", text: next ? "Delivered to a customer; the batch ends here" : "Delivered to a customer, with what they paid" },
  ];
  return (
    <div className={cn("production-destination", options.length === 3 && "is-three")} role="radiogroup" aria-label="Deliver to">
      {options.map(({ value: option, icon: Icon, title, text }) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} disabled={disabled} className={cn(value === option && "is-active")} onClick={() => onChange(option)}>
          <Icon size={16} className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-[13px] font-bold">{title}</span>
            <span className="block text-[11px] opacity-75">{text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Beside a save button: how much of the form is filled in and what is still needed, so a greyed-out button
 * always says why. `problems` are entries that are filled in but wrong.
 */
export function SaveChecklist({ total, missing, problems = [] }: { total: number; missing: string[]; problems?: string[] }) {
  const filled = Math.max(0, total - missing.length);
  const ready = !missing.length && !problems.length;
  return (
    <div className={cn("production-checklist", ready && "is-ready")} aria-live="polite">
      <div className="flex items-center gap-2">
        {ready ? <CheckCircle2 size={15} className="shrink-0" /> : <CircleDashed size={15} className="shrink-0" />}
        <span className="text-xs font-bold">{ready ? "Ready to save" : `${filled} of ${total} filled`}</span>
      </div>
      <span className="production-checklist__bar" aria-hidden>
        <span style={{ width: `${total ? (filled / total) * 100 : 100}%` }} />
      </span>
      {!ready && (
        <p className="text-[11px] leading-4">
          {problems.length > 0 && <span className="font-semibold text-red-600">{problems.join(" · ")}</span>}
          {problems.length > 0 && missing.length > 0 && <span className="text-gray-400"> · </span>}
          {missing.length > 0 && <span>Still needed: {missing.join(", ")}</span>}
        </p>
      )}
    </div>
  );
}

export function SectionHeading({ icon: Icon, title, caption }: { icon: LucideIcon; title: string; caption?: string }) {
  return (
    <div className="production-section-heading">
      <span><Icon size={14} /></span>
      <div><h4>{title}</h4>{caption && <p>{caption}</p>}</div>
    </div>
  );
}

/** The header strip of a production card: a small gold eyebrow over its title, with optional actions on the right. */
export function CardHead({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="production-card__head">
      <div className="min-w-0">
        <p className="production-card__eyebrow">{eyebrow}</p>
        <h3 className="production-card__title">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** A status pill with a dot; `live` makes the dot pulse while a process is running. */
export function Pill({ tone = "default", live = false, children }: { tone?: BadgeTone; live?: boolean; children: React.ReactNode }) {
  return <span className={cn("production-pill", `tone-${tone}`, live && "is-live")}>{children}</span>;
}

/** One read-only fact in a stage summary. */
export function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold text-gray-800", tone)}>{value || "—"}</p>
    </div>
  );
}
