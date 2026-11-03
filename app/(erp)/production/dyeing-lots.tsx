"use client";

import { Plus, Trash2 } from "lucide-react";
import { kg } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** One colour the grey fabric is dyed in, as typed: it becomes a dyeing lot with its own code. */
export type LotLine = { color: string; kg: string };

export const firstLines = (color = ""): LotLine[] => [{ color, kg: "" }];

const EMPTY = 0.0005;
const two = (n: number) => String(n).padStart(2, "0");
const typedKg = (lines: LotLine[]) => lines.reduce((sum, line) => sum + (line.kg.trim() ? Number(line.kg) : 0), 0);

/** Why the colours can't be saved yet, or "" when they can. */
export function lotsProblem(lines: LotLine[], available: number | null) {
  if (lines.some((line) => !line.color.trim())) return lines.length > 1 ? "Enter the colour of every lot." : "Enter the colour.";
  if (lines.some((line) => line.kg.trim() && !(Number(line.kg) > 0))) return "Enter each colour's KG as a number above 0.";
  if (lines.filter((line) => !line.kg.trim()).length > 1) return "Enter the KG of every colour but one; that one takes the rest.";
  if (available !== null) {
    const typed = typedKg(lines);
    if (typed > available + EMPTY) return `Only ${kg(available)} of grey fabric is left to dye.`;
    if (lines.some((line) => !line.kg.trim()) && available - typed < 0.001) return "No grey fabric is left for the colour without a KG.";
  }
  return "";
}

/** The colours as the API takes them: a colour without a KG takes all the grey fabric left. */
export const lotsPayload = (lines: LotLine[]) => lines.map((line) => ({ color: line.color.trim(), kg: line.kg.trim() ? Number(line.kg) : undefined }));

/**
 * The colours a knitting batch's grey fabric is dyed in, each a dyeing lot of its own (KT01-DY01, -DY02…) that is
 * compacted and delivered under its code. One colour can leave its KG out to take the rest; with one colour that is
 * all of it.
 */
export function DyeingLotsInput({
  lines,
  onChange,
  available,
  batchCode,
  lotsSoFar = 0,
}: {
  lines: LotLine[];
  onChange: (lines: LotLine[]) => void;
  /** Grey fabric that can go into lots (null while unknown). */
  available: number | null;
  batchCode: string;
  /** Lots the batch already has, for the codes the new ones will get. */
  lotsSoFar?: number;
}) {
  const typed = typedKg(lines);
  const rest = available === null ? null : Math.max(0, available - typed);
  const blank = lines.findIndex((line) => !line.kg.trim());
  const set = (index: number, changes: Partial<LotLine>) => onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));

  return (
    <div className="plots-input">
      <div className="plots-input__head" aria-hidden>
        <span>Colour</span>
        <span>KG</span>
        <span>Lot code</span>
        <span />
      </div>
      {lines.map((line, index) => (
        <div key={index} className="plots-input__row">
          <Input aria-label={`Colour ${index + 1}`} maxLength={80} placeholder="e.g. Navy blue" value={line.color} onChange={(e) => set(index, { color: e.target.value })} />
          <Input
            aria-label={`KG for colour ${index + 1}`}
            inputMode="decimal"
            placeholder={index === blank && rest !== null ? `Rest · ${kg(rest)}` : "KG"}
            value={line.kg}
            onChange={(e) => set(index, { kg: e.target.value.replace(/[^\d.]/g, "") })}
          />
          <span className="plots-input__code" title="Given when dyeing starts">{batchCode}-DY{two(lotsSoFar + index + 1)}</span>
          {lines.length > 1 ? (
            <button type="button" className="pform__icon-btn" aria-label={`Remove colour ${index + 1}`} onClick={() => onChange(lines.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <div className="plots-input__foot">
        {lines.length < 20 && (
          <button type="button" className="plots-input__add" onClick={() => onChange([...lines, { color: "", kg: "" }])}><Plus size={14} /> Add a colour</button>
        )}
        <span className="text-xs text-gray-500">
          {available === null ? "Each colour becomes a dyeing lot with its own code." : <>{kg(available)} grey fabric · {lines.length === 1 && !lines[0].kg.trim() ? "all of it to this colour" : `${kg(Math.min(typed, available))} typed${blank >= 0 ? `, the rest (${kg(rest ?? 0)}) to colour ${blank + 1}` : rest ? `, ${kg(rest)} stays for later` : ""}`}</>}
        </span>
      </div>
    </div>
  );
}
