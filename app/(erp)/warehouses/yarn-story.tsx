"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, GitBranch, Table2, CheckCircle2, Droplets, Factory, PackageCheck, Sparkles, TrendingDown, TrendingUp, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, formatDate, gsmText, kg } from "@/lib/utils";
import { YarnTree } from "./yarn-tree";

type Check = { inKg: number; outKg: number; diffKg: number; pct: number; result: "LOSS" | "EQUAL" | "GAIN" };
type Delivery = { to: string; toParty: boolean; kg: number; date: string };
type Stage = "NOT_DYED" | "DYEING" | "DYED" | "COMPACTING" | "TO_DELIVER" | "DELIVERED";
type Colour = {
  flowNo: string;
  ownBatch: boolean;
  color: string | null;
  stage: Stage;
  dyeingMill: string | null;
  compactingMill: string | null;
  dyeingDate: string | null;
  greyKg: number;
  dyedKg: number | null;
  finishedKg: number | null;
  deliveredKg: number;
  /** Where its fabric was delivered: a party or a warehouse. */
  deliveries: Delivery[];
  /** Delivered straight from dyeing to a party. */
  soldAtDyeing?: boolean;
  /** Fabric dyeing / compacting didn't use, back in a warehouse. */
  dyeingBalanceKg?: number | null;
  compactingBalanceKg?: number | null;
  dyeing: Check | null;
  compacting: Check | null;
  overall: Check | null;
};
type Batch = {
  flowNo: string;
  status: string;
  fabric: { type: string | null; diameter: string | null; gsm: string | null };
  millType: "OWN" | "OTHER";
  mill: string | null;
  startedAt: string;
  finishedAt: string | null;
  knitting: boolean;
  /** The fabric the knitting was started to make. */
  plannedFabricKg: number | null;
  yarnGivenKg: number;
  yarnUsedKg: number;
  yarnReturnedKg: number;
  greyKg: number | null;
  knittingCheck: Check | null;
  greyLeftKg: number | null;
  /** Grey fabric delivered straight from knitting to a party. */
  soldAtKnitting?: boolean;
  deliveries: Delivery[];
  colours: Colour[];
};
/** `yarnStory` of `/inventory/item`: one yarn from receipt to every knitting batch and colour, weights checked. */
export type YarnStory = {
  code: string;
  focus: string;
  yarn: { code: string; name: string | null; receivedKg: number; toKnittingKg: number; returnedKg: number; otherOutKg: number; inStockKg: number };
  /** The delivery it came in on: the yarn received register (or a purchase order). */
  received: Array<{ receiptNo: string; date: string; dcNo: string | null; mill: string; agent: string | null; bags: string | null; bagCount: number | null; weightKg: number; poNo: string | null }>;
  batches: Batch[];
  /** The yarn by the fabric made from it. */
  byFabric: Array<{ fabric: string; batches: number; yarnUsedKg: number; greyKg: number; finishedKg: number; colors: string[] }>;
  totals: {
    knittingBatches: number;
    colours: number;
    colors: string[];
    yarnUsedKg: number;
    greyKg: number;
    dyedKg: number;
    finishedKg: number;
    deliveredKg: number;
    greyLeftKg: number;
    knitting: Check | null;
    dyeing: Check | null;
    compacting: Check | null;
    final: Check | null;
  };
};

const STAGE: Record<Stage, { label: string; tone: string }> = {
  NOT_DYED: { label: "Not dyed", tone: "bg-gray-100 text-gray-600" },
  DYEING: { label: "Dyeing", tone: "bg-violet-100 text-violet-700" },
  DYED: { label: "Dyed", tone: "bg-violet-50 text-violet-700" },
  COMPACTING: { label: "Compacting", tone: "bg-amber-100 text-amber-800" },
  TO_DELIVER: { label: "To deliver", tone: "bg-sky-100 text-sky-800" },
  DELIVERED: { label: "Delivered", tone: "bg-emerald-100 text-emerald-800" },
};
const batchHref = (code: string) => `/production?batch=${encodeURIComponent(code)}`;
/** A code's own item page (its stock and movements). */
const itemHref = (code: string) => `/warehouses/item?code=${encodeURIComponent(code)}`;

/** Loss, equal or gain between what went in and what came out, as a chip. */
export function CheckChip({ check, big = false }: { check: Check | null; big?: boolean }) {
  if (!check) return <span className="text-xs text-gray-400">—</span>;
  const tone = check.result === "LOSS" ? "bg-rose-50 text-rose-700 ring-rose-200" : check.result === "EQUAL" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-sky-50 text-sky-700 ring-sky-200";
  const Icon = check.result === "LOSS" ? TrendingDown : check.result === "EQUAL" ? CheckCircle2 : TrendingUp;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold ring-1", tone, big ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]")} title={`${kg(check.inKg)} in → ${kg(check.outKg)} out`}>
      <Icon size={big ? 15 : 12} aria-hidden />
      {check.result === "EQUAL" ? "Equal" : `${check.result === "LOSS" ? "Loss" : "Gain"} ${kg(Math.abs(check.diffKg))} · ${Math.abs(check.pct).toFixed(1)}%`}
    </span>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className={cn("min-w-0 rounded-2xl border bg-white px-3 py-2.5", tone)}>
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-black tabular-nums text-[#1b3c55]">{value}</p>
      {note && <p className="truncate text-[11px] text-gray-500">{note}</p>}
    </div>
  );
}

/** One step of the chain: its weight, and the check against the step before. */
function Node({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: number; note?: string; tone: string }) {
  return (
    <div className={cn("min-w-[8.5rem] flex-1 rounded-2xl border px-3 py-2.5", tone)}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide opacity-80"><Icon size={13} aria-hidden /> {label}</p>
      <p className="text-lg font-black tabular-nums">{kg(value)}</p>
      {note && <p className="text-[11px] opacity-75">{note}</p>}
    </div>
  );
}

function Link2({ check }: { check: Check | null }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1">
      <ArrowRight size={16} className="text-gray-300" aria-hidden />
      <CheckChip check={check} />
    </div>
  );
}

/**
 * A yarn's whole story on its item page (and on any code made from it): the yarn received, given to knitting,
 * returned and still in stock; the weight at every step from yarn to delivered fabric with loss, equal or gain; and
 * each knitting batch with every colour (sub-code) it was dyed in, their weights and where each is now.
 */
export function YarnStorySection({ story }: { story: YarnStory }) {
  const { yarn, totals } = story;
  const final = totals.final;
  // The yarn's way through every process as a tree, or as tables by fabric and batch.
  const [view, setView] = useState<"tree" | "tables">("tree");
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Yarn received" value={kg(yarn.receivedKg)} note={yarn.name ?? undefined} />
        <Tile label="Given to knitting" value={kg(yarn.toKnittingKg)} note={`${totals.knittingBatches} knitting batch${totals.knittingBatches === 1 ? "" : "es"}`} />
        <Tile label="Came back unused" value={kg(yarn.returnedKg)} note="returned by knitting" />
        <Tile label="Yarn used" value={kg(totals.yarnUsedKg)} note="in knitting so far" />
        <Tile label="Yarn in stock" value={kg(yarn.inStockKg)} note={yarn.otherOutKg > 0 ? `${kg(yarn.otherOutKg)} went out otherwise` : "not yet knitted"} tone={yarn.inStockKg > 0.0005 ? "border-emerald-200 bg-emerald-50/50" : undefined} />
        <Tile label="Colours" value={String(totals.colours)} note={totals.colors.join(", ") || "not dyed yet"} />
      </div>

      {story.received.map((r) => (
        <p key={r.receiptNo} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-sm text-gray-700">
          <b className="text-amber-900">Received {formatDate(r.date)}</b>
          <span>DC <b>{r.dcNo || "—"}</b></span>
          <span>· {r.mill.toUpperCase()}</span>
          <span>· {(r.agent ?? "Direct").toUpperCase()}</span>
          {r.bags || r.bagCount ? <span>· {r.bags ?? r.bagCount} bags</span> : null}
          <span>· <b>{kg(r.weightKg)}</b></span>
          <Link href="/yarn-received" className="ml-auto text-xs font-semibold text-[#1b3c55] underline underline-offset-2">{r.poNo ? `${r.poNo} · ${r.receiptNo}` : r.receiptNo}</Link>
        </p>
      ))}

      <div className="flex flex-wrap items-stretch gap-1 overflow-x-auto rounded-2xl border bg-gradient-to-br from-slate-50 to-white p-2">
        <Node icon={Boxes} label="Yarn used" value={totals.yarnUsedKg} tone="border-amber-200 bg-amber-50 text-amber-900" />
        <Link2 check={totals.knitting} />
        <Node icon={Factory} label="Grey fabric" value={totals.greyKg} note={totals.greyLeftKg > 0.0005 ? `${kg(totals.greyLeftKg)} not dyed yet` : undefined} tone="border-emerald-200 bg-emerald-50 text-emerald-900" />
        <Link2 check={totals.dyeing} />
        <Node icon={Droplets} label="Dyed" value={totals.dyedKg} tone="border-violet-200 bg-violet-50 text-violet-900" />
        <Link2 check={totals.compacting} />
        <Node icon={Sparkles} label="Finished" value={totals.finishedKg} tone="border-sky-200 bg-sky-50 text-sky-900" />
        <div className="flex shrink-0 items-center px-1"><ArrowRight size={16} className="text-gray-300" aria-hidden /></div>
        <Node icon={Truck} label="Delivered" value={totals.deliveredKg} note={totals.finishedKg > 0 ? `${kg(Math.max(0, totals.finishedKg - totals.deliveredKg))} left to deliver` : undefined} tone="border-teal-200 bg-teal-50 text-teal-900" />
      </div>

      <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3", !final ? "bg-gray-50" : final.result === "LOSS" ? "border-rose-200 bg-rose-50/60" : final.result === "EQUAL" ? "border-emerald-200 bg-emerald-50/60" : "border-sky-200 bg-sky-50/60")}>
        <PackageCheck size={20} className="text-gray-500" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-gray-700">
          {final ? (
            <>
              <b>Final check:</b> {kg(final.outKg)} finished fabric from {kg(final.inKg)} of yarn{totals.colours > 1 ? " (the colours finished so far, by their share of the yarn)" : ""}.
            </>
          ) : (
            <><b>Final check</b> after compacting: the finished fabric is compared with the yarn it was made from.</>
          )}
        </p>
        <CheckChip check={final} big />
      </div>

      {story.batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-bold text-[#1b3c55]">How this yarn was used</p>
          <div className="ytree-switch" role="tablist" aria-label="Show as">
            <button type="button" role="tab" aria-selected={view === "tree"} className={cn(view === "tree" && "is-on")} onClick={() => setView("tree")}><GitBranch size={13} /> Tree</button>
            <button type="button" role="tab" aria-selected={view === "tables"} className={cn(view === "tables" && "is-on")} onClick={() => setView("tables")}><Table2 size={13} /> Tables</button>
          </div>
        </div>
      )}

      {view === "tree" && story.batches.length > 0 && <YarnTree story={story} />}

      {view === "tables" && story.byFabric.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Fabric made from this yarn</th>
                <th className="px-3 py-2 text-right">Yarn used</th>
                <th className="px-3 py-2 text-right">Fabric knitted</th>
                <th className="px-3 py-2">Knitting</th>
                <th className="px-3 py-2 text-right">Finished</th>
                <th className="px-3 py-2">Colours</th>
              </tr>
            </thead>
            <tbody>
              {story.byFabric.map((r) => (
                <tr key={r.fabric} className="border-t">
                  <td className="px-4 py-2"><b className="text-gray-900">{r.fabric}</b><span className="block text-[11px] text-gray-500">{r.batches} knitting batch{r.batches === 1 ? "" : "es"}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{kg(r.yarnUsedKg)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.greyKg > 0 ? kg(r.greyKg) : "knitting…"}</td>
                  <td className="px-3 py-2">{r.greyKg > 0 ? <CheckChip check={{ inKg: r.yarnUsedKg, outKg: r.greyKg, diffKg: Math.round((r.greyKg - r.yarnUsedKg) * 1000) / 1000, pct: r.yarnUsedKg ? Math.round(((r.greyKg - r.yarnUsedKg) / r.yarnUsedKg) * 10000) / 100 : 0, result: Math.abs(r.greyKg - r.yarnUsedKg) < 0.001 ? "EQUAL" : r.greyKg < r.yarnUsedKg ? "LOSS" : "GAIN" }} /> : <span className="text-xs text-gray-400">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.finishedKg > 0 ? kg(r.finishedKg) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{r.colors.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-amber-50/50 font-bold">
              <tr>
                <td className="px-4 py-2">All fabrics · yarn left in stock {kg(yarn.inStockKg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{kg(totals.yarnUsedKg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{kg(totals.greyKg)}</td>
                <td className="px-3 py-2"><CheckChip check={totals.knitting} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.finishedKg > 0 ? kg(totals.finishedKg) : "—"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className={cn("space-y-3", view === "tree" && "hidden")}>
        {story.batches.map((b) => {
          const focusBatch = b.flowNo === story.focus || b.colours.some((c) => c.flowNo === story.focus);
          return (
            <article key={b.flowNo} className={cn("overflow-hidden rounded-2xl border bg-white", focusBatch && "ring-2 ring-emerald-300")}>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-amber-50/40 px-4 py-2.5">
                <Link href={batchHref(b.flowNo)} className="font-mono text-sm font-black text-[#1b3c55] hover:underline">{b.flowNo}</Link>
                <span className="text-xs text-gray-600">{[b.fabric.type, b.fabric.diameter && `${b.fabric.diameter} dia`, gsmText(b.fabric.gsm)].filter(Boolean).join(" · ") || "Fabric"}</span>
                <span className="text-xs text-gray-500">{b.mill ?? "Knitting"} · {formatDate(b.startedAt)}{b.finishedAt ? ` → ${formatDate(b.finishedAt)}` : ""}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold", b.knitting ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>{b.knitting ? "Knitting" : "Knitted"}</span>
              </header>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
                {b.plannedFabricKg !== null && <span><span className="text-xs text-gray-500">Planned fabric</span> <b className="tabular-nums">{kg(b.plannedFabricKg)}</b></span>}
                <span><span className="text-xs text-gray-500">Yarn given</span> <b className="tabular-nums">{kg(b.yarnGivenKg)}</b></span>
                {!b.knitting && <span><span className="text-xs text-gray-500">used</span> <b className="tabular-nums">{kg(b.yarnUsedKg)}</b>{b.yarnReturnedKg > 0.0005 && <span className="text-xs text-gray-500"> · {kg(b.yarnReturnedKg)} back to stock</span>}</span>}
                <ArrowRight size={14} className="text-gray-300" aria-hidden />
                <span><span className="text-xs text-gray-500">Grey fabric</span> <b className="tabular-nums">{b.greyKg === null ? "knitting…" : kg(b.greyKg)}</b></span>
                <CheckChip check={b.knittingCheck} />
                {b.greyLeftKg !== null && b.greyLeftKg > 0.0005 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{kg(b.greyLeftKg)} not dyed yet</span>}
              </div>
              {b.colours.length > 0 && (
                <div className="overflow-x-auto border-t">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-2">Colour · code</th>
                        <th className="px-3 py-2 text-right">Grey in</th>
                        <th className="px-3 py-2 text-right">Dyed</th>
                        <th className="px-3 py-2 text-right">Finished</th>
                        <th className="px-3 py-2 text-right">Delivered</th>
                        <th className="px-3 py-2">Weight check</th>
                        <th className="px-3 py-2">Now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.colours.map((c) => (
                        <tr key={c.flowNo} className={cn("border-t", c.flowNo === story.focus && "bg-emerald-50/70")}>
                          <td className="px-4 py-2">
                            <span className="block font-semibold text-gray-900">{c.color ?? "No colour yet"}</span>
                            <Link href={batchHref(c.flowNo)} className="font-mono text-[11px] text-[#1b3c55] hover:underline">{c.flowNo}</Link>
                            <Link href={itemHref(c.flowNo)} className="ml-2 text-[11px] text-gray-400 hover:underline">stock</Link>
                            {c.dyeingMill && <span className="block text-[11px] text-gray-500">{c.dyeingMill}{c.compactingMill ? ` → ${c.compactingMill}` : ""}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(c.greyKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.dyedKg === null ? "—" : kg(c.dyedKg)}<span className="block"><CheckChip check={c.dyeing} /></span></td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.finishedKg === null ? "—" : kg(c.finishedKg)}{c.compacting && <span className="block"><CheckChip check={c.compacting} /></span>}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.deliveredKg > 0 ? kg(c.deliveredKg) : "—"}</td>
                          <td className="px-3 py-2"><CheckChip check={c.overall} /><span className="block text-[10px] text-gray-400">grey → {c.finishedKg !== null ? "finished" : "dyed"}</span></td>
                          <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", STAGE[c.stage].tone)}>{STAGE[c.stage].label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
