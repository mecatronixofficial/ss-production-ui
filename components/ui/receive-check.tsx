import { CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bags / rolls as written on a DC: "12", "30+9" (two lots), spaces allowed. */
export const PACKAGES_PATTERN = /^\s*\d+(\s*\+\s*\d+)*\s*$/;

/** Their total ("30+9" is 39); null when none, or not written as numbers. */
export function packageTotal(text?: string | null) {
  if (!text?.trim() || !PACKAGES_PATTERN.test(text)) return null;
  return text.split("+").reduce((sum, part) => sum + Number(part.trim()), 0);
}

/** What a material comes packed in: yarn in bags, fabric in rolls, anything else in packages. */
export const packageUnitOf = (category?: string | null) => (category === "YARN" ? "bags" : category?.endsWith("_FABRIC") ? "rolls" : "packages");

const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/**
 * What arrived against what was sent (the DC, the challan): Matches, Short or Excess, with the difference and,
 * for weights, the share. Nothing until both are known. A shortage beyond `warnPct` is shown in red.
 */
export function ReceiveCheck({ sent, received, unit, warnPct = 1, className }: { sent: number | null | undefined; received: number | null | undefined; unit: string; warnPct?: number; className?: string }) {
  if (sent === null || sent === undefined || !(sent > 0) || received === null || received === undefined || !(received >= 0)) return null;
  const diff = Math.round((received - sent) * 1000) / 1000;
  const pct = (Math.abs(diff) / sent) * 100;
  const whole = unit === "bags" || unit === "rolls" || unit === "packages";
  const kind = Math.abs(diff) < 0.0005 ? "match" : diff < 0 ? "short" : "excess";
  const tone =
    kind === "match" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
    kind === "excess" ? "bg-sky-50 text-sky-700 ring-sky-200" :
    whole || pct > warnPct ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-800 ring-amber-200";
  const Icon = kind === "match" ? CheckCircle2 : kind === "short" ? TrendingDown : TrendingUp;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", tone, className)} title={`Sent ${fmt(sent)} ${unit} · received ${fmt(received)} ${unit}`}>
      <Icon size={12} aria-hidden />
      {kind === "match" ? "Matches" : `${kind === "short" ? "Short" : "Excess"} ${fmt(Math.abs(diff))} ${unit}${whole ? "" : ` · ${pct.toFixed(1)}%`}`}
    </span>
  );
}
