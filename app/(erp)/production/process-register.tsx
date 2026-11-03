"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2, ChevronDown, Clock3, Droplets, Factory, Hourglass, Layers, PackageOpen, Search, Sparkles } from "lucide-react";
import { cn, gsmText, kg, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { itemHref } from "../warehouses/item-details";
import { greyLeft, isCompacting, isDyeing, isKnitting, leftToDeliver, shortDate, warehouseDelivery, type FabricFlow, type FlowDelivery, type StageKey } from "./types";
import type { CardKey } from "./process-cards";

const EMPTY = 0.0005;

/**
 * Where a process record is: material waiting for it (`TO_START`), at the mill now (`RUNNING`), done with its output
 * not all sent on yet (`WAITING`: at the mill, in a warehouse, or not yet received there), or done with everything
 * sent on (`SENT`: to the next process, a warehouse that used it, or a party).
 */
export type RecordState = "TO_START" | "RUNNING" | "WAITING" | "SENT";

/** Where some of a process's output went. */
type Out = { label: string; kg: number; tone: "next" | "warehouse" | "party" | "back" };

/** One process record: a batch at knitting, dyeing or compacting, with its material, mill, dates and weights. */
export type ProcessRecord = {
  flow: FabricFlow;
  stage: StageKey;
  state: RecordState;
  /** The yarn the material came from, for grouping. */
  yarnCode: string | null;
  material: string;
  fabric: string;
  color: string | null;
  mill: string;
  startedAt: string | null;
  dueAt: string | null;
  finishedAt: string | null;
  inLabel: string;
  inKg: number | null;
  outLabel: string;
  outKg: number | null;
  lossKg: number | null;
  packages: string | null;
  /** Where the output went. */
  outs: Out[];
  /** Output not sent on yet, and where it is. */
  pendingKg: number;
  pendingWhere: string | null;
  /** The entry that moves it on, if there is one. */
  action: { label: string; record: CardKey } | null;
};

const fabricOf = (f: FabricFlow) => [f.fabricType, f.fabricDiameter && `${f.fabricDiameter} dia`, gsmText(f.fabricGsm)].filter(Boolean).join(" · ") || "—";
const yarnOf = (f: FabricFlow) => f.yarnItemCode ?? (f.parent ? f.parent.flowNo.split("-")[0] : null);
const round = (v: number) => Math.round(v * 1000) / 1000;
/** Where fabric sent to a warehouse is: received there, or still on its way. */
const inWarehouse = (d: FlowDelivery | null, fallback: string) => (d ? `${d.receivedAt ? "In" : "Sent to"} ${d.warehouse?.code ?? "warehouse"}${d.receivedAt ? "" : ", not received yet"}` : fallback);
const partyOuts = (f: FabricFlow): Out[] => f.deliveries.filter((d) => d.destination === "CUSTOMER").map((d) => ({ label: d.partyName ?? "Party", kg: toNumber(d.weightKg), tone: "party" }));
const knitterOf = (f: FabricFlow) => {
  const machines = f.knittingMillDetails && f.knittingMillDetails !== "Pending machine selection" ? f.knittingMillDetails : null;
  return f.knittingMillType === "OWN" ? `Own mill${machines ? ` · ${machines}` : ""}` : f.knittingMillDetails || f.knittingPartyDetails || "Other mill";
};

/** Each knitting batch: yarn in, grey fabric out, and where the grey fabric went (dyeing lots, a warehouse, a party). */
function knittingRecords(flows: FabricFlow[]): ProcessRecord[] {
  return flows
    .filter((f) => !f.parentId && (f.knittingDate !== null || f.knittingFinishedAt !== null || f.status === "PURCHASED" || isKnitting(f)))
    .map((f) => {
      const running = isKnitting(f);
      const done = !running && f.status !== "PURCHASED";
      const grey = f.knittingDeliveryKg;
      const outs: Out[] = [];
      if ((f.metrics.yarnReturnedKg ?? 0) > EMPTY) outs.push({ label: "Yarn back to warehouse", kg: f.metrics.yarnReturnedKg ?? 0, tone: "back" });
      if (f.lots.length) {
        const colours = f.lots.map((l) => l.color).filter(Boolean).join(", ");
        outs.push({ label: `${f.lots.length} dyeing lot${f.lots.length === 1 ? "" : "s"}${colours ? ` (${colours})` : ""}`, kg: f.metrics.lots?.allocatedKg ?? 0, tone: "next" });
      } else if (f.dyeingDate !== null || f.dyeingIssueTxnId) {
        outs.push({ label: "Dyeing", kg: f.dyeingDeliveryKg ?? grey ?? 0, tone: "next" });
      }
      outs.push(...(f.knittingDestination === "PARTY" ? partyOuts(f) : []));
      // Grey fabric not in a dyeing lot (or sold) yet.
      let pending = 0;
      if (done && grey !== null && f.knittingDestination !== "PARTY") {
        pending = f.lots.length ? greyLeft(f) ?? 0 : f.dyeingDate !== null || f.dyeingIssueTxnId ? 0 : grey;
      }
      const toWarehouse = warehouseDelivery(f, "KNITTING");
      const state: RecordState = f.status === "PURCHASED" ? "TO_START" : running ? "RUNNING" : pending > EMPTY ? "WAITING" : "SENT";
      return {
        flow: f,
        stage: "knitting" as const,
        state,
        yarnCode: yarnOf(f),
        material: `${f.yarnItemCode ? `${f.yarnItemCode} · ` : ""}${f.yarnCount}${f.yarnLotNo ? ` · lot ${f.yarnLotNo}` : ""}`,
        fabric: fabricOf(f),
        color: null,
        mill: knitterOf(f),
        startedAt: f.knittingDate ?? f.purchaseDate,
        dueAt: running ? f.knittingExpectedFinishDate : null,
        finishedAt: f.knittingFinishedAt,
        inLabel: running ? "Yarn given" : "Yarn used",
        inKg: running ? f.yarnReceivedKg ?? f.purchasedWeightKg : f.purchasedWeightKg,
        outLabel: "Grey fabric",
        outKg: grey,
        lossKg: done ? f.metrics.knittingLossKg : null,
        packages: f.knittingBagCount ? `${f.knittingBagCount} rolls` : null,
        outs,
        pendingKg: round(pending),
        pendingWhere: pending > EMPTY ? (toWarehouse ? inWarehouse(toWarehouse, "") : "Ready for dyeing") : null,
        action: running ? { label: f.knittingMillType === "OTHER" ? "Enter knitting record" : "Finish knitting", record: "knitting" } : pending > EMPTY ? { label: "Dye a colour", record: "dyeing" } : f.status === "PURCHASED" ? { label: "Start knitting", record: "knitting" } : null,
      };
    });
}

/** Each colour dyed (a dyeing lot, or an older batch dyed on itself): grey in, dyed out, where the dyed fabric went. */
function dyeingRecords(flows: FabricFlow[]): ProcessRecord[] {
  return flows
    .filter((f) => f.dyeingDate !== null || f.dyeingOutputWeightKg !== null || (!!f.parentId && !!f.dyeingIssueTxnId))
    .map((f) => {
      const running = isDyeing(f) || f.dyeingOutputWeightKg === null;
      const dyed = f.dyeingOutputWeightKg;
      const outs: Out[] = [];
      if ((f.dyeingBalanceKg ?? 0) > EMPTY) outs.push({ label: "Grey back to warehouse", kg: f.dyeingBalanceKg ?? 0, tone: "back" });
      const compacting = f.compactingDate !== null || !!f.compactingIssueTxnId || f.officeDeliveryKg !== null;
      if (compacting) outs.push({ label: "Compacting", kg: f.compactingReceivedKg ?? f.compactingDeliveryKg ?? dyed ?? 0, tone: "next" });
      if (f.dyeingDestination === "PARTY") outs.push(...partyOuts(f));
      const pending = !running && dyed !== null && !compacting && f.dyeingDestination !== "PARTY" ? f.compactingDeliveryKg ?? dyed : 0;
      const state: RecordState = running ? "RUNNING" : pending > EMPTY ? "WAITING" : "SENT";
      return {
        flow: f,
        stage: "dyeing" as const,
        state,
        yarnCode: yarnOf(f),
        material: f.parent ? `Grey of ${f.parent.flowNo}` : `${f.yarnItemCode ? `${f.yarnItemCode} · ` : ""}${f.yarnCount}`,
        fabric: fabricOf(f),
        color: f.color,
        mill: f.dyeingMillDetails || f.dyeingPartyDetails || "Dyeing mill",
        startedAt: f.dyeingDate,
        dueAt: null,
        finishedAt: f.dyeingFinishedAt ?? (dyed !== null ? f.dyeingDate : null),
        inLabel: "Grey in",
        inKg: f.fabricReceivedKg ?? f.dyeingDeliveryKg ?? (f.parent ? f.purchasedWeightKg : null),
        outLabel: "Dyed",
        outKg: dyed,
        lossKg: running ? null : f.metrics.dyeingLossKg,
        packages: f.rollCount ? `${f.rollCount} rolls` : null,
        outs,
        pendingKg: round(pending),
        pendingWhere: pending > EMPTY ? (f.dyeingDestination === "WAREHOUSE" ? inWarehouse(warehouseDelivery(f, "DYEING"), "In warehouse") : "Ready for compacting") : null,
        action: running ? { label: "Complete dyeing", record: "dyeing" } : pending > EMPTY ? { label: "Start compacting", record: "compacting" } : null,
      };
    });
}

/** Each colour compacted: dyed in, finished out, and where the finished fabric was delivered. */
function compactingRecords(flows: FabricFlow[]): ProcessRecord[] {
  return flows
    .filter((f) => f.compactingDate !== null || f.officeDeliveryKg !== null || !!f.compactingIssueTxnId)
    .map((f) => {
      const running = isCompacting(f) || f.officeDeliveryKg === null;
      const outs: Out[] = [];
      if ((f.compactingBalanceKg ?? 0) > EMPTY) outs.push({ label: "Dyed back to warehouse", kg: f.compactingBalanceKg ?? 0, tone: "back" });
      for (const d of f.deliveries) outs.push({ label: d.destination === "CUSTOMER" ? d.partyName ?? "Party" : `${d.warehouse?.code ?? "Warehouse"}${d.receivedAt ? "" : " (not received)"}`, kg: toNumber(d.weightKg), tone: d.destination === "CUSTOMER" ? "party" : "warehouse" });
      if (!f.deliveries.length && (f.finalDeliveredKg ?? 0) > EMPTY) outs.push({ label: "Delivered", kg: f.finalDeliveredKg ?? 0, tone: "party" });
      const pending = running ? 0 : leftToDeliver(f) ?? 0;
      const state: RecordState = running ? "RUNNING" : pending > EMPTY ? "WAITING" : "SENT";
      return {
        flow: f,
        stage: "compacting" as const,
        state,
        yarnCode: yarnOf(f),
        material: `Dyed ${f.color ?? "fabric"} of ${f.flowNo}`,
        fabric: fabricOf(f),
        color: f.color,
        mill: [f.compactingMillDetails || f.compactingPartyDetails || "Compacting mill", f.compactingInwardNo && `in ${f.compactingInwardNo}`, f.compactingOutwardNo && `out ${f.compactingOutwardNo}`].filter(Boolean).join(" · "),
        startedAt: f.compactingDate,
        dueAt: null,
        finishedAt: f.compactingFinishedAt ?? (f.officeDeliveryKg !== null ? f.compactingDate : null),
        inLabel: "Dyed in",
        inKg: f.compactingReceivedKg ?? f.compactingDeliveryKg,
        outLabel: "Finished",
        outKg: f.officeDeliveryKg,
        lossKg: running ? null : f.metrics.compactingLossKg,
        packages: null,
        outs,
        pendingKg: round(pending),
        pendingWhere: pending > EMPTY ? "Finished, not delivered yet" : null,
        action: running ? { label: "Complete compacting", record: "compacting" } : pending > EMPTY ? { label: "Deliver", record: "delivery" } : null,
      };
    });
}

/** Material waiting to start a process: the output the process before it hasn't sent on. */
const waitingFor = (before: ProcessRecord[], stage: StageKey): ProcessRecord[] =>
  before.filter((r) => r.state === "WAITING").map((r) => ({ ...r, stage, state: "TO_START" as const }));

/** The records of one process, with the material waiting for it from the process before. */
export function processRecords(flows: FabricFlow[], stage: StageKey): ProcessRecord[] {
  if (stage === "knitting") return knittingRecords(flows);
  if (stage === "dyeing") return [...waitingFor(knittingRecords(flows), "dyeing"), ...dyeingRecords(flows)];
  return [...waitingFor(dyeingRecords(flows), "compacting"), ...compactingRecords(flows)];
}

const STAGE: Record<StageKey, { title: string; icon: LucideIcon; toStart: string; waiting: string; sent: string; blurb: string }> = {
  knitting: {
    title: "Knitting",
    icon: Factory,
    toStart: "Yarn in hand",
    waiting: "Done · grey not dyed",
    sent: "Done · all sent on",
    blurb: "Every knitting batch: the yarn, the mill or machines, start and end dates, the grey fabric made, and where it went — dyeing lots, a warehouse or a party. Grey fabric not in a dyeing lot yet is pending.",
  },
  dyeing: {
    title: "Dyeing",
    icon: Droplets,
    toStart: "Grey ready to dye",
    waiting: "Dyed · not compacted",
    sent: "Done · all sent on",
    blurb: "Every colour dyed: the knitting batch it came from, the dyeing mill, dates, grey in and dyed out. Grey fabric still to be dyed and dyed fabric not sent to compacting are pending.",
  },
  compacting: {
    title: "Compacting",
    icon: Sparkles,
    toStart: "Dyed ready to compact",
    waiting: "Done · not delivered",
    sent: "Done · delivered",
    blurb: "Every colour compacted: the compacting mill, inward and outward numbers, dates, dyed in and finished out, and who it was delivered to. Dyed fabric waiting and finished fabric not delivered are pending.",
  },
};

const STATE_ORDER: RecordState[] = ["TO_START", "RUNNING", "WAITING", "SENT"];
const stateLabel = (stage: StageKey, s: RecordState) => (s === "TO_START" ? STAGE[stage].toStart : s === "RUNNING" ? `${STAGE[stage].title} now` : s === "WAITING" ? STAGE[stage].waiting : STAGE[stage].sent);
const STATE_ICON: Record<RecordState, LucideIcon> = { TO_START: PackageOpen, RUNNING: Clock3, WAITING: Hourglass, SENT: CheckCircle2 };
/** The weight a record holds in its state: waiting material, what is at the mill, or what came out. */
const stateKg = (r: ProcessRecord) => (r.state === "TO_START" || r.state === "WAITING" ? r.pendingKg : r.state === "RUNNING" ? r.inKg ?? 0 : r.outKg ?? 0);

/**
 * One process's register (a tab of the Production page): what is waiting for it, running at the mills, done but not
 * sent on, and done — each with its material, mill, dates, weights and where its output went. Grouped by yarn, it shows
 * what each yarn became and what is still pending at this step.
 */
export function ProcessRegister({ flows, stage, onOpen, onRecord }: { flows: FabricFlow[]; stage: StageKey; onOpen: (flow: FabricFlow) => void; onRecord: (flow: FabricFlow, record: CardKey) => void }) {
  const records = useMemo(() => processRecords(flows, stage), [flows, stage]);
  const [state, setState] = useState<RecordState | "OPEN" | "ALL">("OPEN");
  const [byYarn, setByYarn] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const meta = STAGE[stage];
  const Icon = meta.icon;

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATE_ORDER.map((s) => [s, { n: 0, kg: 0 }])) as Record<RecordState, { n: number; kg: number }>;
    for (const r of records) {
      c[r.state].n++;
      c[r.state].kg += stateKg(r);
    }
    return c;
  }, [records]);
  const loss = useMemo(() => records.filter((r) => r.state !== "TO_START").reduce((t, r) => t + (r.lossKg ?? 0), 0), [records]);

  const q = search.trim().toUpperCase();
  const shown = useMemo(() => {
    const pool = records.filter((r) => (state === "ALL" ? true : state === "OPEN" ? r.state !== "SENT" : r.state === state));
    const found = q ? pool.filter((r) => [r.flow.flowNo, r.yarnCode, r.material, r.fabric, r.color, r.mill].some((v) => v?.toUpperCase().includes(q))) : pool;
    return [...found].sort(
      (a, b) =>
        (byYarn ? (a.yarnCode ?? "~").localeCompare(b.yarnCode ?? "~", undefined, { numeric: true }) : 0) ||
        STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
        (b.startedAt ?? "").localeCompare(a.startedAt ?? "") ||
        a.flow.flowNo.localeCompare(b.flow.flowNo, undefined, { numeric: true }),
    );
  }, [records, state, q, byYarn]);

  // A yarn's records together, with what is pending at this step.
  const groups = useMemo(() => {
    if (!byYarn) return [{ key: "", rows: shown }];
    const map = new Map<string, ProcessRecord[]>();
    for (const r of shown) map.set(r.yarnCode ?? "—", [...(map.get(r.yarnCode ?? "—") ?? []), r]);
    return [...map].map(([key, rows]) => ({ key, rows }));
  }, [shown, byYarn]);

  const cols = 9;
  return (
    <section className="preg space-y-3">
      <div className="preg__intro">
        <span className={cn("preg__icon", `is-${stage}`)}><Icon size={18} /></span>
        <div className="min-w-0">
          <p className="text-base font-black text-[#123f35]">{meta.title} register</p>
          <p className="text-xs text-gray-500">{meta.blurb}</p>
        </div>
      </div>

      <nav className="preg__states" aria-label={`${meta.title} by state`}>
        {(["OPEN", ...STATE_ORDER, "ALL"] as const).map((s) => {
          if (s === "TO_START" && stage === "knitting" && counts.TO_START.n === 0) return null;
          const n = s === "OPEN" ? records.length - counts.SENT.n : s === "ALL" ? records.length : counts[s].n;
          const weight = s === "OPEN" ? counts.TO_START.kg + counts.RUNNING.kg + counts.WAITING.kg : s === "ALL" ? null : counts[s].kg;
          const SIcon = s === "OPEN" ? Hourglass : s === "ALL" ? Layers : STATE_ICON[s];
          return (
            <button key={s} type="button" aria-pressed={state === s} className={cn("preg__state", `is-${s.toLowerCase()}`)} onClick={() => setState(s)}>
              <span className="preg__state-label"><SIcon size={13} aria-hidden /> {s === "OPEN" ? "Pending & running" : s === "ALL" ? "All" : stateLabel(stage, s)}</span>
              <strong>{n}</strong>
              <span className="preg__state-note">{weight === null ? (loss > EMPTY ? `loss ${kg(loss)}` : "every record") : weight > EMPTY ? kg(weight) : "—"}</span>
            </button>
          );
        })}
      </nav>

      <div className="production-list-tools">
        <div className="production-search">
          <Search size={17} aria-hidden />
          <Input placeholder="Find a code, yarn, fabric, colour or mill" aria-label={`Find in ${meta.title}`} value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <div className="production-order" role="group" aria-label="Group">
          <button type="button" aria-pressed={!byYarn} onClick={() => setByYarn(false)}>By state</button>
          <button type="button" aria-pressed={byYarn} onClick={() => setByYarn(true)}>By yarn</button>
        </div>
        <p className="text-sm text-gray-500">{shown.length} record{shown.length === 1 ? "" : "s"}</p>
      </div>

      {shown.length === 0 ? (
        <div className="production-empty">
          <span className="production-empty__icon"><Icon size={24} /></span>
          <p className="text-base font-bold text-gray-900">{q ? `Nothing matches ${search.trim()}` : `No ${meta.title.toLowerCase()} records here`}</p>
          <p className="text-sm text-gray-500">{state === "OPEN" ? "Nothing is pending or running at this step." : "Try another state, or All."}</p>
        </div>
      ) : (
        <div className="preg__table-wrap">
          <table className="preg__table">
            <thead>
              <tr>
                <th>Code · state</th>
                <th>Material</th>
                <th>Mill</th>
                <th>Started</th>
                <th>Finished</th>
                <th className="num">In</th>
                <th className="num">Out · loss</th>
                <th>Sent to</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key || "all"}>
                  {byYarn && <YarnGroupRow code={g.key} rows={g.rows} cols={cols} />}
                  {g.rows.map((r) => {
                    const key = `${r.state}-${r.flow.id}`;
                    const expanded = open === key;
                    return (
                      <Fragment key={key}>
                        <tr className={cn("preg__row", `is-${r.state.toLowerCase()}`, expanded && "is-open")} onClick={() => setOpen(expanded ? null : key)}>
                          <td>
                            <span className="flex items-center gap-1.5">
                              <ChevronDown size={14} className={cn("shrink-0 text-gray-400 transition-transform", !expanded && "-rotate-90")} aria-hidden />
                              <span className="font-mono text-[13px] font-black text-[#123f35]">{r.flow.flowNo}</span>
                            </span>
                            <span className={cn("preg__badge", `is-${r.state.toLowerCase()}`)}>{stateLabel(stage, r.state)}</span>
                          </td>
                          <td>
                            <span className="block font-semibold text-gray-800">{r.color ? <><span className="preg__dot" aria-hidden />{r.color} · </> : null}{r.fabric}</span>
                            <span className="block text-[11px] text-gray-500">{r.material}</span>
                          </td>
                          <td className="text-xs text-gray-700">{r.state === "TO_START" ? <span className="text-gray-400">not started</span> : r.mill}</td>
                          <td className="whitespace-nowrap text-xs">{r.state === "TO_START" ? "—" : shortDate(r.startedAt) ?? "—"}{r.dueAt && <span className={cn("block text-[10px]", r.dueAt.slice(0, 10) < new Date().toISOString().slice(0, 10) ? "font-bold text-rose-600" : "text-gray-400")}>due {shortDate(r.dueAt)}</span>}</td>
                          <td className="whitespace-nowrap text-xs">{r.state === "TO_START" ? "—" : r.finishedAt ? shortDate(r.finishedAt) : <span className="text-amber-700">running</span>}</td>
                          <td className="num">{r.state === "TO_START" ? "—" : r.inKg === null ? "—" : kg(r.inKg)}<span className="block text-[10px] text-gray-400">{r.state === "TO_START" ? "" : r.inLabel}</span></td>
                          <td className="num">
                            {r.state === "TO_START" ? "—" : r.outKg === null ? "—" : kg(r.outKg)}
                            {r.state !== "TO_START" && r.lossKg !== null && r.lossKg > EMPTY && <span className="block text-[10px] font-semibold text-rose-600">loss {kg(r.lossKg)}</span>}
                            {r.state !== "TO_START" && r.packages && <span className="block text-[10px] text-gray-400">{r.packages}</span>}
                          </td>
                          <td className="text-xs">
                            {r.state === "TO_START" ? "—" : r.outs.length ? r.outs.map((o, i) => <span key={i} className={cn("preg__out", `is-${o.tone}`)}>{o.label} <b>{kg(o.kg)}</b></span>) : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="text-xs">
                            {r.pendingKg > EMPTY ? <><b className="text-amber-800">{kg(r.pendingKg)}</b><span className="block text-[10px] text-gray-500">{r.pendingWhere}</span></> : <span className="text-gray-400">—</span>}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="preg__detail-row">
                            <td colSpan={cols}><RecordDetail r={r} onOpen={() => onOpen(r.flow)} onRecord={(rec) => onRecord(r.flow, rec)} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** A yarn's heading in the register: how many records it has at this step and what is pending. */
function YarnGroupRow({ code, rows, cols }: { code: string; rows: ProcessRecord[]; cols: number }) {
  const pending = rows.reduce((t, r) => t + r.pendingKg, 0);
  const by = (s: RecordState) => rows.filter((r) => r.state === s).length;
  const parts = [by("TO_START") && `${by("TO_START")} to start`, by("RUNNING") && `${by("RUNNING")} running`, by("WAITING") && `${by("WAITING")} done, not sent`, by("SENT") && `${by("SENT")} sent on`].filter(Boolean);
  const colours = new Set(rows.map((r) => r.color).filter(Boolean));
  return (
    <tr className="preg__group">
      <td colSpan={cols}>
        {code !== "—" ? <Link href={itemHref(code)} className="font-mono font-black text-[#123f35] hover:underline" onClick={(e) => e.stopPropagation()}>Yarn {code}</Link> : <b>No yarn code</b>}
        <span className="ml-2 text-xs text-gray-600">{rows.length} record{rows.length === 1 ? "" : "s"}{colours.size ? ` · ${colours.size} colour${colours.size === 1 ? "" : "s"}` : ""} · {parts.join(" · ")}</span>
        {pending > EMPTY && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{kg(pending)} pending</span>}
        {code !== "—" && <Link href={itemHref(code)} className="ml-2 text-[11px] font-semibold text-gray-500 underline-offset-2 hover:underline">yarn tree</Link>}
      </td>
    </tr>
  );
}

/** A record in full: its material, mill, dates, weights, where its output went, and the step that moves it on. */
function RecordDetail({ r, onOpen, onRecord }: { r: ProcessRecord; onOpen: () => void; onRecord: (record: CardKey) => void }) {
  const f = r.flow;
  const facts: Array<[string, React.ReactNode]> = [
    ["Code", <span key="c" className="font-mono">{f.flowNo}{f.parent ? <span className="text-gray-500"> · from {f.parent.flowNo}</span> : null}</span>],
    ["Yarn", r.yarnCode ? <Link key="y" href={itemHref(r.yarnCode)} className="font-mono text-[#123f35] hover:underline">{r.yarnCode}</Link> : f.yarnCount],
    ["Material", r.material],
    ["Fabric", r.fabric],
    ["Colour", r.color ?? "—"],
    ["Mill", r.state === "TO_START" ? "Not started" : r.mill],
    ["Started", r.state === "TO_START" ? "—" : shortDate(r.startedAt) ?? "—"],
    ["Finished", r.state === "TO_START" ? "—" : shortDate(r.finishedAt) ?? (r.dueAt ? `running · due ${shortDate(r.dueAt)}` : "running")],
  ];
  if (r.stage === "knitting" && f.knittingGg) facts.push(["Gauge · loop", [f.knittingGg && `GG ${f.knittingGg}`, f.knittingLl && `LL ${f.knittingLl}`].filter(Boolean).join(" · ")]);
  if (r.stage === "knitting" && f.knittingRuns?.length) facts.push(["Machines", f.knittingRuns.map((run) => run.machine.code).join(", ")]);
  const notes = r.stage === "knitting" ? f.knittingNotes : r.stage === "dyeing" ? f.dyeingNotes : f.compactingNotes;
  const challans = (f.challans ?? []).filter((c) => !c.cancelledAt).length;
  return (
    <div className="preg__detail">
      <dl className="preg__facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {notes && <div className="sm:col-span-2"><dt>Notes</dt><dd>{notes}</dd></div>}
      </dl>
      {r.state !== "TO_START" && (
        <div className="preg__flow">
          <span><small>{r.inLabel}</small><b>{r.inKg === null ? "—" : kg(r.inKg)}</b></span>
          <ArrowRight size={14} className="text-gray-300" aria-hidden />
          <span><small>{r.outLabel}</small><b>{r.outKg === null ? "—" : kg(r.outKg)}</b></span>
          {r.lossKg !== null && <span className={cn(r.lossKg > EMPTY ? "text-rose-700" : "text-emerald-700")}><small>Loss</small><b>{r.lossKg > EMPTY ? kg(r.lossKg) : "none"}</b></span>}
          {r.outs.map((o, i) => <span key={i} className={cn("preg__out", `is-${o.tone}`)}>{o.label} <b>{kg(o.kg)}</b></span>)}
          {r.pendingKg > EMPTY && <span className="preg__out is-pending">{r.pendingWhere} <b>{kg(r.pendingKg)}</b></span>}
        </div>
      )}
      {r.state === "TO_START" && (
        <p className="text-sm text-gray-700"><b>{kg(r.pendingKg)}</b> {r.pendingWhere?.toLowerCase()} from {f.flowNo}{r.color ? ` (${r.color})` : ""}: start {r.stage} from it.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[11px] text-gray-500">{challans ? `${challans} delivery challan${challans === 1 ? "" : "s"} on this batch` : "No delivery challan yet"}</span>
        <Button size="sm" variant="outline" onClick={onOpen}>Open batch <ArrowRight size={14} /></Button>
        {r.action && <Button size="sm" onClick={() => onRecord(r.action!.record)}>{r.action.label} <ArrowRight size={14} /></Button>}
      </div>
    </div>
  );
}
