import { kg } from "@/lib/utils";
import { weightCheck, WEIGHT_TOLERANCE_KG } from "./types";

/** A process's weight change in one tile: a gain or a loss (either is normal up to the tolerance). */
export function WeightChange({ input, output, label }: { input: number; output: number; label: string }) {
  const check = weightCheck(input, output);
  const pct = input ? (Math.abs(check.diff) / input) * 100 : 0;
  if (check.kind === "none") {
    return (
      <div>
        <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label} weight change</p>
        <p className="mt-1 text-base font-bold text-gray-800">{output ? kg(0) : "—"}</p>
      </div>
    );
  }
  const gained = check.diff > 0;
  return (
    <div>
      <p className={gained ? "text-[9px] font-bold uppercase tracking-wider text-emerald-600" : "text-[9px] font-bold uppercase tracking-wider text-rose-400"}>
        {label} {gained ? "weight gain" : "loss"}
      </p>
      <p className={gained ? "mt-1 text-base font-bold text-emerald-700" : "mt-1 text-base font-bold text-rose-700"}>
        {gained ? "+" : ""}{kg(Math.abs(check.diff))} <span className="text-[10px] font-medium">({pct.toFixed(2)}%)</span>
      </p>
      <p className={check.kind === "over" ? "text-[10px] font-semibold text-red-600" : check.kind === "bigLoss" ? "text-[10px] font-semibold text-amber-700" : "text-[10px] text-gray-400"}>
        {check.kind === "over" ? `Over the +${WEIGHT_TOLERANCE_KG} KG allowed` : check.kind === "bigLoss" ? `More than ${WEIGHT_TOLERANCE_KG} KG lost — check` : `Within ±${WEIGHT_TOLERANCE_KG} KG`}
      </p>
    </div>
  );
}
