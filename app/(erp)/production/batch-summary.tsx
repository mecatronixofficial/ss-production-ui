import { ArrowRight, Boxes, Building2, Droplets, Factory, Paperclip, Sparkles, Truck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, gsmText, kg, money, toNumber } from "@/lib/utils";
import { Attachments } from "./attachments";
import { Fact, Pill } from "./fields";
import { completedInWarehouse, isCompacting, isDyeing, isKnitting, sentToWarehouse, shortDate, warehouseDelivery, type AttachmentStage, type FabricFlow } from "./types";

const EMPTY = 0.0005;

/** Change from `input` to `output` as "+50.000 KG (5.00% gain)" / "−20.000 KG (2.00% loss)"; a dash until both exist. */
export function Change({ input, output, onDark = false }: { input: number | null; output: number | null; onDark?: boolean }) {
  if (input === null || output === null || !(input > 0)) return <span className={cn("production-change is-flat", onDark && "on-dark")}>—</span>;
  const diff = output - input;
  if (Math.abs(diff) < EMPTY) return <span className={cn("production-change is-flat", onDark && "on-dark")}>No change</span>;
  const pct = (Math.abs(diff) / input) * 100;
  return (
    <span className={cn("production-change", diff > 0 ? "is-gain" : "is-loss", onDark && "on-dark")}>
      {diff > 0 ? "+" : "−"}{kg(Math.abs(diff))} <small>{pct.toFixed(2)}% {diff > 0 ? "gain" : "loss"}</small>
    </span>
  );
}

/** A process's notes and its documents / photos (open only; they are added under Record process). */
function NotesAndFiles({ flow, stage, notes }: { flow: FabricFlow; stage: AttachmentStage; notes?: string | null }) {
  return (
    <div className="production-notes space-y-2">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400"><Paperclip size={11} /> Notes & documents</p>
      {notes && <p className="whitespace-pre-line rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">{notes}</p>}
      <Attachments flowId={flow.id} stage={stage} attachments={flow.attachments} readOnly />
    </div>
  );
}

type Status = "done" | "now" | "pending";
const statusPill: Record<Status, { tone: "success" | "warning" | "default"; label: string }> = {
  done: { tone: "success", label: "Done" },
  now: { tone: "warning", label: "In progress" },
  pending: { tone: "default", label: "Not yet" },
};

/**
 * One process on the timeline: its node, what went in and came out, its details, notes and documents.
 * Details show once something is recorded (`recorded`); until then a line says what it is waiting for.
 */
function Process({
  accent,
  icon: Icon,
  title,
  subtitle,
  status,
  statusLabel,
  recorded,
  waiting = "Waiting to be recorded under Record process.",
  notReached = "Not reached yet.",
  weights,
  flow,
  stage,
  notes,
  children,
}: {
  accent: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string | null;
  status: Status;
  statusLabel?: string;
  recorded: boolean;
  waiting?: string;
  /** Shown instead of "Not reached yet." for a pending process. */
  notReached?: string;
  weights?: { input: number | null; output: number | null; inputLabel: string; outputLabel: string };
  flow: FabricFlow;
  stage?: AttachmentStage;
  notes?: string | null;
  children: React.ReactNode;
}) {
  const pill = statusPill[status];
  const hasFiles = !!stage && (!!notes || flow.attachments.some((a) => a.stage === stage));
  return (
    <li className={cn("production-process", accent, `is-${status}`)}>
      <span className="production-process__node"><Icon size={18} /></span>
      <section className="production-process__card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="production-process__title">{title}</h4>
            {subtitle && <p className="production-process__sub">{subtitle}</p>}
          </div>
          <Pill tone={pill.tone} live={status === "now"}>{statusLabel ?? pill.label}</Pill>
        </div>
        {recorded ? (
          <>
            {weights && (
              <div className="production-flowstrip">
                <div className="min-w-0"><p className="production-flowstrip__label">{weights.inputLabel}</p><p className="production-flowstrip__value">{weights.input !== null ? kg(weights.input) : "—"}</p></div>
                <ArrowRight className="production-flowstrip__arrow" size={18} aria-hidden />
                <div className="min-w-0"><p className="production-flowstrip__label">{weights.outputLabel}</p><p className="production-flowstrip__value">{weights.output !== null ? kg(weights.output) : "—"}</p></div>
                <Change input={weights.input} output={weights.output} />
              </div>
            )}
            <div className="production-facts">{children}</div>
          </>
        ) : (
          <p className="mt-2 text-xs text-gray-400">{status === "pending" ? notReached : waiting}</p>
        )}
        {stage && (recorded || hasFiles) && <NotesAndFiles flow={flow} stage={stage} notes={notes} />}
      </section>
    </li>
  );
}

/** Every process of a batch, oldest first, on a timeline: details, weight in and out, notes and documents. */
export function BatchProcesses({ flow }: { flow: FabricFlow }) {
  const yarnUsed = flow.yarnReceivedKg ?? flow.purchasedWeightKg;
  const delivered = flow.finalDeliveredKg ?? 0;
  const left = flow.officeDeliveryKg !== null ? Math.max(0, flow.officeDeliveryKg - delivered) : null;
  // Knitting or dyeing may deliver into a warehouse instead of the next process; once received there the batch ends.
  const knitToWarehouse = warehouseDelivery(flow, "KNITTING");
  const dyeToWarehouse = warehouseDelivery(flow, "DYEING");
  const ended = completedInWarehouse(flow);
  const sent = sentToWarehouse(flow);
  const atDyeing = flow.dyeingDeliveryKg !== null;
  const knitDone = atDyeing || !!knitToWarehouse;
  const knitStarted = knitDone || isKnitting(flow) || !!flow.knittingDate;
  const atCompacting = flow.compactingDeliveryKg !== null;
  const dyeDone = atCompacting || !!dyeToWarehouse;
  const compactDone = flow.officeDeliveryKg !== null;
  const anyDelivery = flow.deliveries.length > 0 || delivered > EMPTY;
  const allDelivered = compactDone && anyDelivery && (left ?? 0) <= EMPTY;
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;
  const handOffLabel = (delivery: typeof knitToWarehouse) => (delivery ? (delivery.receivedAt ? "Done · in warehouse" : "Sent · not received") : undefined);
  const handOffFact = (delivery: typeof knitToWarehouse) =>
    delivery && (
      <Fact
        label="Warehouse"
        value={`${delivery.warehouse?.code ?? "Warehouse"} · ${delivery.receivedAt ? `received ${shortDate(delivery.receivedAt)}, ${kg(delivery.receivedWeightKg ?? delivery.weightKg)}` : "not received yet"}`}
        tone={delivery.receivedAt ? "text-emerald-700" : "text-amber-700"}
      />
    );
  const skippedAfter = ended
    ? `Not started · the ${ended.stage === "knitting" ? "grey" : "dyed"} fabric is in ${ended.delivery.warehouse?.code ?? "the warehouse"}; start ${ended.stage === "knitting" ? "dyeing" : "compacting"} under Record process to continue.`
    : "";
  const waitingFor = sent ? `Waiting for ${sent.delivery.warehouse?.code ?? "the warehouse"} to receive the ${sent.stage === "knitting" ? "grey" : "dyed"} fabric.` : undefined;

  return (
    <ol className="production-timeline">
      <Process accent="is-yarn" icon={Boxes} title="Yarn" subtitle={join(flow.yarnItemCode ?? "Purchased yarn", flow.yarnCount)} status="done" statusLabel="Taken" recorded flow={flow}>
        <Fact label="Yarn code" value={flow.yarnItemCode ?? "Purchased yarn"} />
        <Fact label="Taken from" value={flow.yarnWarehouse ? `${flow.yarnWarehouse.code}${flow.yarnLotNo ? ` · lot ${flow.yarnLotNo}` : ""}` : null} />
        <Fact label="Date" value={shortDate(flow.purchaseDate)} />
        <Fact label="Weight used" value={kg(yarnUsed)} />
        <Fact label="Rate" value={`${money(flow.yarnRatePerKg)} / KG`} />
        <Fact label="Yarn cost" value={money(flow.metrics.yarnAmount)} />
      </Process>

      <Process
        accent="is-knitting"
        icon={Factory}
        title="Knitting"
        subtitle={join(flow.knittingMillType === "OTHER" ? "Other mill" : "Own mill", flow.knittingPartyDetails, flow.knittingMillDetails)}
        status={knitDone ? "done" : knitStarted ? "now" : "pending"}
        statusLabel={knitDone ? handOffLabel(knitToWarehouse) : undefined}
        recorded={knitStarted}
        weights={{ input: yarnUsed, output: flow.knittingDeliveryKg ?? flow.dyeingDeliveryKg, inputLabel: "Yarn in", outputLabel: "Knitted weight" }}
        flow={flow}
        stage="KNITTING"
        notes={flow.knittingNotes}
      >
        <Fact label="Mill type" value={flow.knittingMillType === "OTHER" ? "Other mill · manual record" : "Own mill · assigned task"} />
        <Fact label="Started" value={shortDate(flow.knittingDate)} />
        <Fact label="Fabric code" value={flow.flowNo} />
        <Fact label="Fabric type" value={flow.fabricType} />
        <Fact label="Diameter" value={flow.fabricDiameter} />
        <Fact label="GSM" value={gsmText(flow.fabricGsm)} />
        <Fact label={knitDone ? "Finished" : "Expected finish"} value={shortDate(knitDone ? flow.knittingFinishedAt : flow.knittingExpectedFinishDate)} />
        <Fact label="Bags" value={flow.knittingBagCount} />
        <Fact label="Approx. bag weight" value={flow.knittingBagCount && flow.knittingDeliveryKg ? `≈ ${kg(flow.knittingDeliveryKg / flow.knittingBagCount)}` : null} />
        <Fact label="GG · LL" value={join(flow.knittingGg, flow.knittingLl)} />
        <Fact label="Delivered to" value={flow.knittingDeliveryPlace} />
        {handOffFact(knitToWarehouse)}
        <Fact label="Charges" value={money(flow.knittingExpense)} />
      </Process>

      <Process
        accent="is-dyeing"
        icon={Droplets}
        title="Dyeing"
        subtitle={join(flow.dyeingPartyDetails, flow.dyeingMillDetails, flow.color)}
        status={ended?.stage === "knitting" || sent?.stage === "knitting" ? "pending" : dyeDone ? "done" : atDyeing ? "now" : "pending"}
        statusLabel={ended?.stage === "knitting" ? "Not started" : dyeDone ? handOffLabel(dyeToWarehouse) : atDyeing ? (isDyeing(flow) ? "In progress" : "Ready to start") : undefined}
        recorded={dyeDone || isDyeing(flow)}
        waiting="The grey fabric is ready for dyeing; start it under Record process → Dyeing."
        notReached={ended?.stage === "knitting" ? skippedAfter : sent?.stage === "knitting" ? waitingFor : undefined}
        weights={{ input: flow.fabricReceivedKg, output: flow.compactingDeliveryKg ?? (dyeToWarehouse ? toNumber(dyeToWarehouse.weightKg) : null), inputLabel: "Fabric received", outputLabel: dyeToWarehouse ? "Sent to warehouse" : "Sent to compacting" }}
        flow={flow}
        stage="DYEING"
        notes={flow.dyeingNotes}
      >
        <Fact label="Started" value={shortDate(flow.dyeingDate)} />
        <Fact label="Completed" value={dyeDone ? shortDate(flow.dyeingFinishedAt ?? flow.dyeingDate) : "In progress"} />
        <Fact label="Colour" value={flow.color} />
        <Fact label="Count" value={flow.dyeingCount} />
        <Fact label="Rolls" value={flow.rollCount} />
        <Fact label="Grey fabric weight" value={flow.dyeingGreyWeightKg !== null ? kg(flow.dyeingGreyWeightKg) : null} />
        <Fact label="Dyeing output" value={flow.dyeingOutputWeightKg !== null ? kg(flow.dyeingOutputWeightKg) : null} />
        {handOffFact(dyeToWarehouse)}
        <Fact label="Expense" value={money(flow.dyeingExpense)} />
      </Process>

      <Process
        accent="is-compacting"
        icon={Sparkles}
        title="Compacting"
        subtitle={join(flow.compactingPartyDetails, flow.compactingMillDetails)}
        status={ended || sent ? "pending" : compactDone ? "done" : atCompacting ? "now" : "pending"}
        statusLabel={ended ? "Not started" : !compactDone && atCompacting && !sent ? (isCompacting(flow) ? "In progress" : "Ready to start") : undefined}
        recorded={compactDone || isCompacting(flow)}
        waiting="The dyed fabric is ready for compacting; start it under Record process → Compacting."
        notReached={ended ? skippedAfter : sent?.stage === "dyeing" ? waitingFor : undefined}
        weights={{ input: flow.compactingReceivedKg, output: flow.officeDeliveryKg, inputLabel: "Received", outputLabel: "Compacted weight" }}
        flow={flow}
        stage="COMPACTING"
        notes={flow.compactingNotes}
      >
        <Fact label="Started" value={shortDate(flow.compactingDate)} />
        <Fact label="Completed" value={compactDone ? shortDate(flow.compactingFinishedAt ?? flow.compactingDate) : "In progress"} />
        <Fact label="Inward no." value={flow.compactingInwardNo} />
        <Fact label="Outward no." value={flow.compactingOutwardNo} />
        <Fact label="Expense" value={money(flow.compactingExpense)} />
      </Process>

      <Process
        accent="is-delivery"
        icon={Truck}
        title="Delivery"
        subtitle={compactDone ? `${kg(delivered)} delivered${left !== null ? ` · ${kg(left)} left` : ""}` : null}
        status={ended ? "pending" : allDelivered ? "done" : compactDone ? "now" : "pending"}
        statusLabel={ended ? "Not started" : allDelivered ? "Delivered" : compactDone ? (anyDelivery ? "Partly delivered" : "Ready to deliver") : undefined}
        recorded={anyDelivery}
        notReached={ended ? skippedAfter : undefined}
        waiting="The finished fabric is ready; deliver it under Record process → Compacting."
        flow={flow}
        stage="FINAL"
        notes={flow.notes}
      >
        <Fact label="Delivered" value={kg(delivered)} />
        <Fact label="Left to deliver" value={left !== null ? kg(left) : null} />
        <Fact label="Collected" value={money(flow.collectedAmount)} />
        <div className="col-span-full">
          {flow.deliveries.length === 0 ? (
            <p className="text-xs text-gray-500">{kg(delivered)} delivered on {shortDate(flow.finalDate)} (before destinations were kept).</p>
          ) : (
            <ul className="production-deliveries">
              {flow.deliveries.map((d) => {
                const toParty = d.destination === "CUSTOMER";
                return (
                  <li key={d.id}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="production-deliveries__icon">{toParty ? <UserRound size={15} /> : <Building2 size={15} />}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-800">{toParty ? d.partyName ?? "Party" : `${d.warehouse?.code ?? "Warehouse"} · stock as ${flow.flowNo}`}</span>
                        <span className="block truncate text-[11px] text-gray-500">
                          {shortDate(d.deliveredAt)}
                          {!toParty && (d.receivedAt ? ` · received ${shortDate(d.receivedAt)}, ${kg(d.receivedWeightKg ?? d.weightKg)}` : " · waiting to be received")}
                          {d.notes ? ` · ${d.notes}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-bold text-gray-800">{kg(d.weightKg)}</span>
                      {toNumber(d.amount) > 0 && <span className="block text-[11px] text-gray-500">{money(d.amount)} collected</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Process>
    </ol>
  );
}

/** The final totals of a batch: weight from yarn to finished fabric and every production cost. */
export function BatchTotals({ flow }: { flow: FabricFlow }) {
  const yarnUsed = flow.yarnReceivedKg ?? flow.purchasedWeightKg;
  const finalWeight = flow.officeDeliveryKg ?? flow.compactingDeliveryKg ?? flow.dyeingDeliveryKg;
  const delivered = flow.finalDeliveredKg ?? 0;
  const left = flow.officeDeliveryKg !== null ? Math.max(0, flow.officeDeliveryKg - delivered) : null;
  const ratio = finalWeight !== null && yarnUsed > 0 ? Math.min(100, (finalWeight / yarnUsed) * 100) : 0;
  const rows: Array<[string, number, boolean?]> = [
    ["Yarn", flow.metrics.yarnAmount],
    ["Knitting", flow.knittingExpense],
    ["Dyeing", flow.dyeingExpense],
    ["Compacting", flow.compactingExpense],
    ["Delivery & other", flow.otherExpense + flow.purchaseOtherCost],
    ["Total cost", flow.metrics.totalSpent, true],
    ["Additional expenses", flow.metrics.additionalExpenses],
  ];

  return (
    <section className="production-card">
      <div className="production-total-hero">
        <p className="production-eyebrow">Final total</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="production-total-hero__value">{finalWeight !== null ? kg(finalWeight) : "—"}</p>
            <p className="mt-1 text-xs text-white/60">{flow.officeDeliveryKg !== null ? "Finished (compacted) weight" : "Weight so far"} from {kg(yarnUsed)} of yarn</p>
          </div>
          <Change input={yarnUsed} output={finalWeight} onDark />
        </div>
        <div className="production-bar mt-4" role="img" aria-label={`${ratio.toFixed(0)}% of the yarn weight`}><span style={{ width: `${ratio}%` }} /></div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><p className="production-glass__label">Delivered</p><p className="mt-0.5 font-bold">{kg(delivered)}</p></div>
          <div><p className="production-glass__label">Left to deliver</p><p className="mt-0.5 font-bold">{left !== null ? kg(left) : "—"}</p></div>
        </div>
      </div>
      <dl className="production-money">
        {rows.map(([label, value, strong]) => (
          <div key={label} className={cn(strong && "is-strong")}><dt>{label}</dt><dd>{money(value)}</dd></div>
        ))}
      </dl>
    </section>
  );
}
