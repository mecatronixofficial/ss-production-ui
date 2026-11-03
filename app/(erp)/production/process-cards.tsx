"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Droplets, Factory, FileText, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, gsmText, kg, money, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "./fields";
import { challansFor, dyesInLots, greyLeft, isCompacting, isDyeing, isKnitting, leftToDeliver, lotStage, shortDate, warehouseDelivery, type FabricFlow, type FlowChallan, type StageKey } from "./types";

export type CardKey = StageKey | "delivery";
type Line = { label: string; value: React.ReactNode; note?: React.ReactNode; strong?: boolean };

const per = (amount: number, weight: number | null) => (weight && weight > 0 && amount > 0 ? `${money(amount / weight)} / KG` : null);

/** A weight change as a chip: "+12 KG" / "−20 KG (2.0%)". */
function Change({ input, output }: { input: number | null; output: number | null }) {
  if (input === null || output === null || !(input > 0)) return null;
  const diff = output - input;
  if (Math.abs(diff) < 0.0005) return <span className="production-change is-flat is-sm">±0</span>;
  return <span className={cn("production-change is-sm", diff > 0 ? "is-gain" : "is-loss")}>{diff > 0 ? "+" : "−"}{kg(Math.abs(diff))} <small>{((Math.abs(diff) / input) * 100).toFixed(1)}%</small></span>;
}

function ChallanChips({ challans, onOpen }: { challans: FlowChallan[]; onOpen: (id: string) => void }) {
  if (!challans.length) return null;
  return (
    <div className="pcard__challans">
      {challans.map((c) => (
        <button key={c.id} type="button" className={cn("pcard__challan", c.cancelledAt && "is-cancelled")} onClick={() => onOpen(c.id)} title={c.cancelledAt ? "Cancelled" : `Open ${c.challanNo}`}>
          <FileText size={12} aria-hidden />
          <span className="font-mono">{c.challanNo}</span>
          <span className="truncate">→ {c.toName}</span>
          <b>{kg(toNumber(c.weightKg))}</b>
        </button>
      ))}
    </div>
  );
}

/**
 * One process of a batch as a card: who does it and when, the material that went in, how much, its price and
 * charges, what came out, and the delivery challans of the fabric leaving it. Its button opens the entry window.
 */
function ProcessCard({
  accent,
  icon: Icon,
  title,
  state,
  live,
  who,
  material,
  input,
  output,
  outputLabel,
  compare = true,
  lines,
  challans,
  action,
  disabled,
  onAction,
  onChallan,
}: {
  accent: string;
  icon: LucideIcon;
  title: string;
  state: string;
  live: boolean;
  who: string | null;
  material: string;
  input: number | null;
  output: number | null;
  outputLabel: string;
  /** Show the weight change between in and out (not while a process is still making its output). */
  compare?: boolean;
  lines: Line[];
  challans: FlowChallan[];
  action: string;
  disabled: boolean;
  onAction: () => void;
  onChallan: (id: string) => void;
}) {
  const done = state.startsWith("Done");
  return (
    <article className={cn("pcard", accent, done && "is-done", live && "is-live")}>
      <header className="pcard__head">
        <span className="pcard__icon"><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="pcard__title">{title}</h3>
          <p className="pcard__who">{who ?? "Not started"}</p>
        </div>
        <Pill tone={done ? "success" : live ? "warning" : state === "Waiting" ? "default" : "info"} live={live}>{state}</Pill>
      </header>

      <div className="pcard__flow">
        <div className="min-w-0"><p>In · {material}</p><strong>{input !== null ? kg(input) : "—"}</strong></div>
        <ArrowRight size={16} aria-hidden className="shrink-0 text-gray-300" />
        <div className="min-w-0"><p>Out · {outputLabel}</p><strong>{output !== null ? kg(output) : "—"}</strong></div>
        {compare && <Change input={input} output={output} />}
      </div>

      {lines.length > 0 && (
        <dl className="pcard__lines">
          {lines.map((l) => (
            <div key={l.label} className={cn(l.strong && "is-strong")}>
              <dt>{l.label}</dt>
              <dd>{l.value}{l.note && <small>{l.note}</small>}</dd>
            </div>
          ))}
        </dl>
      )}

      <ChallanChips challans={challans} onOpen={onChallan} />

      <footer className="pcard__foot">
        <Button size="sm" className={cn(!done && "pcard__cta")} variant={done ? "outline" : "default"} disabled={disabled} onClick={onAction}>
          {action} <ArrowRight size={14} />
        </Button>
      </footer>
    </article>
  );
}

const STAGE_TONE: Record<string, "success" | "warning" | "info"> = { Delivered: "success", "To deliver": "info", Compacting: "warning", Dyed: "info", Dyeing: "warning" };

/**
 * A knitting batch's dyeing: the colours its grey fabric went into, each a lot with its own code that is compacted
 * and delivered by itself, and the grey fabric left for another colour.
 */
function LotsCard({ flow, prices, state, action, disabled, onAction }: { flow: FabricFlow; prices: boolean; state: string; action: string; disabled: boolean; onAction: () => void }) {
  const knitted = flow.knittingDeliveryKg ?? flow.dyeingDeliveryKg;
  const inLots = flow.metrics.lots?.allocatedKg ?? 0;
  const left = greyLeft(flow);
  const allocated = flow.lots.length > 0 && left !== null && left <= 0.0005;
  const delivered = flow.lots.filter((lot) => lotStage(lot) === "Delivered").length;
  const done = allocated && delivered === flow.lots.length;
  return (
    <article className={cn("pcard pcard--lots is-dyeing", done && "is-done", flow.lots.some((lot) => lotStage(lot) === "Dyeing") && "is-live")}>
      <header className="pcard__head">
        <span className="pcard__icon"><Droplets size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="pcard__title">Dyeing lots</h3>
          <p className="pcard__who">{flow.lots.length ? `${flow.lots.length} colour${flow.lots.length === 1 ? "" : "s"} · each lot has its own code, then compacting and delivery` : "Each colour becomes a lot of its own"}</p>
        </div>
        <Pill tone={done ? "success" : flow.lots.length ? "warning" : state === "Waiting" ? "default" : "info"} live={!done && flow.lots.length > 0}>{done ? "All delivered" : allocated ? `${flow.lots.length - delivered} pending` : left !== null ? `${kg(left)} left` : state}</Pill>
      </header>

      <div className="pcard__flow">
        <div className="min-w-0"><p>In · grey fabric</p><strong>{knitted !== null ? kg(knitted) : "—"}</strong></div>
        <ArrowRight size={16} aria-hidden className="shrink-0 text-gray-300" />
        <div className="min-w-0"><p>Into lots</p><strong>{flow.lots.length ? kg(inLots) : "—"}</strong></div>
        <div className="min-w-0"><p>Left to dye</p><strong>{left !== null ? kg(left) : knitted !== null ? kg(knitted) : "—"}</strong></div>
      </div>

      {flow.lots.length ? (
        <ul className="plots">
          {flow.lots.map((lot) => {
            const stage = lotStage(lot);
            return (
              <li key={lot.id}>
                <Link href={`/production?batch=${encodeURIComponent(lot.flowNo)}`} className="plots__row" title={`Open ${lot.flowNo}`}>
                  <span className="plots__code">{lot.flowNo.slice(flow.flowNo.length + 1)}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm text-gray-900">{lot.color ?? "No colour"}</b>
                    <span className="block truncate text-[11px] text-gray-500">{[lot.flowNo, lot.dyeingMillDetails].filter(Boolean).join(" · ")}</span>
                  </span>
                  <b className="shrink-0 text-sm tabular-nums">{kg(toNumber(lot.purchasedWeightKg))}</b>
                  <Pill tone={STAGE_TONE[stage] ?? "info"} live={stage === "Dyeing" || stage === "Compacting"}>{stage}</Pill>
                  <ArrowRight size={14} className="shrink-0 text-gray-300" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl bg-white/70 px-3 py-2.5 text-xs text-gray-600">
          After knitting, dye the grey fabric in one colour or several. Each colour gets its own code (<span className="font-mono">{flow.flowNo}-DY01</span>, <span className="font-mono">-DY02</span>…) and goes on to compacting and delivery under it.
        </p>
      )}
      {prices && flow.metrics.lots && (
        <dl className="pcard__lines">
          <div><dt>Grey fabric cost</dt><dd>{money(flow.metrics.costPerKg)} / KG<small>yarn, knitting and expenses ÷ KG knitted</small></dd></div>
          <div><dt>Gone into lots</dt><dd>{money(flow.metrics.lots.allocatedCost)}</dd></div>
        </dl>
      )}

      {flow.lots.length > 0 && (
        <p className="rounded-xl bg-white/70 px-3 py-2 text-xs text-gray-600">
          <b className="text-gray-900">{delivered} of {flow.lots.length} colours delivered.</b>{" "}
          Each colour remains open under its own code until dyeing, compacting, and delivery are finished.
        </p>
      )}

      {!allocated && <footer className="pcard__foot">
        <Button size="sm" className={cn(!done && "pcard__cta")} variant={done ? "outline" : "default"} disabled={disabled} onClick={onAction}>
          {action} <ArrowRight size={14} />
        </Button>
      </footer>}
    </article>
  );
}

/**
 * Every process of a batch as a card, in order: knitting, dyeing, compacting and delivery. Prices only for admins.
 * A knitting batch shows its dyeing lots instead of dyeing on; a dyeing lot shows the knitting batch it came from.
 */
export function ProcessCards({
  flow,
  managerMode,
  stateOf,
  openable,
  actionOf,
  onOpen,
  onChallan,
}: {
  flow: FabricFlow;
  managerMode: boolean;
  stateOf: (key: StageKey) => string;
  openable: Record<CardKey, boolean>;
  actionOf: (key: CardKey) => string;
  onOpen: (key: CardKey) => void;
  onChallan: (id: string) => void;
}) {
  const router = useRouter();
  const prices = !managerMode;
  const knitOut = flow.knittingDeliveryKg ?? flow.dyeingDeliveryKg ?? (warehouseDelivery(flow, "KNITTING") ? toNumber(warehouseDelivery(flow, "KNITTING")!.weightKg) : null);
  // Knitting is weighed against the yarn it used, once finished; the yarn it didn't use is back in the warehouse.
  const knitDone = !isKnitting(flow);
  const yarnGiven = flow.yarnReceivedKg ?? flow.purchasedWeightKg;
  const yarnIn = knitDone ? flow.purchasedWeightKg : yarnGiven;
  const yarnBack = knitDone && flow.yarnItemCode ? Math.max(0, yarnGiven - flow.purchasedWeightKg) : 0;
  const dyeIn = flow.fabricReceivedKg ?? flow.dyeingDeliveryKg;
  const compactIn = flow.compactingReceivedKg ?? flow.compactingDeliveryKg;
  const left = leftToDeliver(flow);
  const join = (...parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(" · ") || null;
  // Where the fabric was delivered when a process ended the batch (a party), or after compacting.
  const deliveredLines = (): Line[] => {
    const sold = flow.deliveries;
    if (!sold.length) return [];
    const to = [...new Set(sold.map((d) => (d.destination === "CUSTOMER" ? d.partyName ?? "a party" : d.warehouse?.code ?? "a warehouse")))].join(", ");
    const collected = sold.reduce((t, d) => t + toNumber(d.amount), 0);
    return [
      { label: "Delivered", value: kg(flow.finalDeliveredKg ?? 0), note: to, strong: true },
      ...(prices && collected > 0 ? [{ label: "Collected", value: money(collected), note: flow.otherExpense > 0 ? `costs ${money(flow.otherExpense)}` : null }] : []),
    ];
  };
  const soldAt = flow.knittingDestination === "PARTY" ? "knitting" : flow.dyeingDestination === "PARTY" ? "dyeing" : flow.deliveries.length ? "compacting" : null;

  const knitting = (
    <ProcessCard
      key="knitting"
      accent="is-knitting"
      icon={Factory}
      title="Knitting"
      state={stateOf("knitting")}
      live={isKnitting(flow)}
      who={join(flow.knittingMillType === "OWN" ? `Own mill${flow.knittingMillDetails && flow.knittingMillDetails !== "Pending machine selection" ? ` · ${flow.knittingMillDetails}` : ""}` : flow.knittingMillDetails ?? flow.knittingPartyDetails, flow.knittingDate && `from ${shortDate(flow.knittingDate)}`, flow.knittingFinishedAt && `done ${shortDate(flow.knittingFinishedAt)}`)}
      material={knitDone ? "yarn used" : "yarn given"}
      input={yarnIn}
      output={knitOut}
      outputLabel={knitDone ? "grey fabric" : "knitted so far"}
      compare={knitDone}
      lines={[
        ...(yarnBack > 0.0005 ? [{ label: "Back to warehouse", value: kg(yarnBack), note: `of ${kg(yarnGiven)} given · not a loss` }] : []),
        { label: "Material", value: <span className="font-mono">{flow.yarnItemCode ?? "Yarn"}</span>, note: join(flow.yarnCount, flow.yarnLotNo && `lot ${flow.yarnLotNo}`, flow.yarnWarehouse?.code) },
        { label: "Fabric", value: join(flow.fabricType, flow.fabricDiameter && `${flow.fabricDiameter} dia`, gsmText(flow.fabricGsm), flow.knittingGg && `${flow.knittingGg} GG`, flow.knittingLl && `LL ${flow.knittingLl}`) ?? "—" },
        ...(flow.plannedFabricKg !== null
          ? [{ label: "Planned fabric", value: kg(flow.plannedFabricKg), note: knitOut !== null ? `${kg(knitOut)} knitted · ${knitOut >= flow.plannedFabricKg - 0.0005 ? "done" : `${kg(flow.plannedFabricKg - knitOut)} to go`}` : `from ${kg(yarnIn)} yarn` }]
          : []),
        ...(prices
          ? [
              { label: "Yarn price", value: money(flow.metrics.yarnAmount), note: `${kg(flow.purchasedWeightKg)} × ${money(flow.yarnRatePerKg)}` },
              { label: "Knitting charges", value: money(flow.knittingExpense), note: per(flow.knittingExpense, knitOut) },
            ]
          : []),
        ...(flow.knittingBagCount ? [{ label: "Rolls", value: `${flow.knittingBagCount} roll${flow.knittingBagCount === 1 ? "" : "s"}`, note: flow.knittingMillType === "OWN" && (flow.knittingRuns ?? []).length ? "as entered on Machines" : undefined }] : []),
        ...(soldAt === "knitting" ? deliveredLines() : []),
      ]}
      challans={managerMode ? [] : [...challansFor(flow, "knitting"), ...(soldAt === "knitting" ? challansFor(flow, "delivery") : [])]}
      action={actionOf("knitting")}
      disabled={!openable.knitting}
      onAction={() => onOpen("knitting")}
      onChallan={onChallan}
    />
  );
  if (managerMode) return <div className="pcards">{knitting}</div>;

  const parent = flow.parent;
  const fromKnitting = parent && (
    <ProcessCard
      key="from-knitting"
      accent="is-knitting"
      icon={Factory}
      title={`Knitting · ${parent.flowNo}`}
      state="Done"
      live={false}
      who={join(flow.knittingMillType === "OWN" ? "Own mill" : flow.knittingMillDetails ?? flow.knittingPartyDetails, flow.knittingFinishedAt && `done ${shortDate(flow.knittingFinishedAt)}`)}
      material="grey fabric"
      input={flow.purchasedWeightKg}
      output={flow.purchasedWeightKg}
      outputLabel="to this lot"
      lines={[
        { label: "Knitting batch", value: <span className="font-mono">{parent.flowNo}</span>, note: "this lot took part of its grey fabric" },
        { label: "Yarn", value: <span className="font-mono">{flow.yarnItemCode ?? "—"}</span>, note: flow.yarnCount },
        { label: "Fabric", value: join(flow.fabricType, flow.fabricDiameter && `${flow.fabricDiameter} dia`, gsmText(flow.fabricGsm), flow.knittingGg && `${flow.knittingGg} GG`, flow.knittingLl && `LL ${flow.knittingLl}`) ?? "—" },
        ...(prices ? [{ label: "Grey fabric cost", value: money(flow.metrics.yarnAmount), note: `${kg(flow.purchasedWeightKg)} × ${money(flow.yarnRatePerKg)}` }] : []),
      ]}
      challans={[]}
      action={`Open ${parent.flowNo}`}
      disabled={false}
      onAction={() => router.push(`/production?batch=${encodeURIComponent(parent.flowNo)}`)}
      onChallan={onChallan}
    />
  );

  // A knitting batch (not an older one dyed on itself) goes on in its dyeing lots.
  if (!parent && flow.knittingDestination !== "PARTY" && (flow.lots.length > 0 || dyesInLots(flow))) {
    return (
      <div className="pcards">
        {knitting}
        <LotsCard flow={flow} prices={prices} state={stateOf("dyeing")} action={flow.lots.length ? "Dye another colour" : "Start dyeing"} disabled={!openable.dyeing} onAction={() => onOpen("dyeing")} />
      </div>
    );
  }

  return (
    <div className="pcards">
      {fromKnitting || knitting}
      <ProcessCard
        accent="is-dyeing"
        icon={Droplets}
        title="Dyeing"
        state={stateOf("dyeing")}
        live={isDyeing(flow)}
        who={join(flow.dyeingMillDetails ?? flow.dyeingPartyDetails, flow.dyeingDate && `from ${shortDate(flow.dyeingDate)}`, flow.dyeingFinishedAt && `done ${shortDate(flow.dyeingFinishedAt)}`)}
        material="grey fabric"
        input={dyeIn}
        output={flow.dyeingOutputWeightKg}
        outputLabel="dyed fabric"
        lines={[
          { label: "Material", value: <span className="font-mono">{flow.flowNo}</span>, note: "grey fabric" },
          ...(flow.color || flow.rollCount ? [{ label: "Colour · rolls", value: join(flow.color, flow.rollCount ? `${flow.rollCount} rolls` : null) ?? "—" }] : []),
          { label: "Dyeing charges", value: money(flow.dyeingExpense), note: per(flow.dyeingExpense, dyeIn) },
          ...(flow.dyeingBalanceKg ? [{ label: "Back to warehouse", value: kg(flow.dyeingBalanceKg), note: `grey fabric not used · under ${flow.parent?.flowNo ?? flow.flowNo}` }] : []),
          ...(soldAt === "dyeing" ? deliveredLines() : []),
        ]}
        challans={[...challansFor(flow, "dyeing"), ...(soldAt === "dyeing" ? challansFor(flow, "delivery") : [])]}
        action={actionOf("dyeing")}
        disabled={!openable.dyeing}
        onAction={() => onOpen("dyeing")}
        onChallan={onChallan}
      />
      <ProcessCard
        accent="is-compacting"
        icon={Sparkles}
        title="Compacting"
        state={stateOf("compacting")}
        live={isCompacting(flow)}
        who={join(flow.compactingMillDetails ?? flow.compactingPartyDetails, flow.compactingDate && `from ${shortDate(flow.compactingDate)}`, flow.compactingFinishedAt && `done ${shortDate(flow.compactingFinishedAt)}`)}
        material="dyed fabric"
        input={compactIn}
        output={flow.officeDeliveryKg}
        outputLabel="finished"
        lines={[
          { label: "Material", value: <span className="font-mono">{flow.flowNo}</span>, note: join("dyed fabric", flow.color) },
          ...(flow.compactingInwardNo || flow.compactingOutwardNo ? [{ label: "Inward · outward", value: join(flow.compactingInwardNo, flow.compactingOutwardNo) ?? "—" }] : []),
          { label: "Compacting charges", value: money(flow.compactingExpense), note: per(flow.compactingExpense, compactIn) },
          ...(flow.compactingBalanceKg ? [{ label: "Back to warehouse", value: kg(flow.compactingBalanceKg), note: "dyed fabric not used" }] : []),
          ...(soldAt === "compacting" ? deliveredLines() : []),
          ...(left !== null && left > 0.0005 ? [{ label: "Left to deliver", value: kg(left), strong: true }] : []),
        ]}
        challans={[...challansFor(flow, "compacting"), ...(soldAt === "compacting" ? challansFor(flow, "delivery") : [])]}
        action={left !== null && left > 0.0005 ? actionOf("delivery") : actionOf("compacting")}
        disabled={left !== null && left > 0.0005 ? !openable.delivery : !openable.compacting}
        onAction={() => onOpen(left !== null && left > 0.0005 ? "delivery" : "compacting")}
        onChallan={onChallan}
      />
    </div>
  );
}
