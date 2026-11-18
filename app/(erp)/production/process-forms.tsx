"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, FileText, Trash2, UserRound } from "lucide-react";
import { api, qs } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import type { Warehouse } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, gsmText, kg, money, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Attachments } from "./attachments";
import { DyeingLotsInput, firstLines, lotsPayload, lotsProblem } from "./dyeing-lots";
import { ChargeInput, DestinationToggle, Field, FieldGroup } from "./fields";
import { currentShift, shiftIndex, type KnitRun, type Shift } from "../masters/machines/types";
import { greyToDye, isKnitting, knittingEditable, leftToDeliver, localDate, lotStage, numeric, shortDate, warehouseDelivery, weightCheck, WEIGHT_TOLERANCE_KG, type AttachmentStage, type FabricFlow, type FlowDelivery, type FlowDirectory, type RunStage } from "./types";

type Process = "dyeing" | "compacting";
const WORDS = {
  dyeing: { name: "Dyeing", input: "grey fabric", output: "dyed fabric", stage: "DYEING" as AttachmentStage },
  compacting: { name: "Compacting", input: "dyed fabric", output: "finished fabric", stage: "COMPACTING" as AttachmentStage },
} as const;
const EMPTY = 0.0005;

/** A weight against the step before it: refused above the tolerance, flagged when much was lost. */
function feedback(input: number | null, value: string) {
  const check = weightCheck(input ?? 0, numeric(value));
  return { error: check.kind === "over" ? check.message : null, warning: check.kind === "bigLoss" ? check.message : null };
}

/** "+12 KG" / "−20 KG (2.0%)" between two weights. */
function changeText(input: number, output: number) {
  if (!(input > 0) || !(output > 0)) return null;
  const diff = output - input;
  if (Math.abs(diff) < EMPTY) return "no change";
  return `${diff > 0 ? "+" : "−"}${kg(Math.abs(diff))} (${((Math.abs(diff) / input) * 100).toFixed(1)}%)`;
}

/**
 * One process's window, the same for starting, completing and correcting it: what went in at the top, the few
 * fields that matter, the rest folded under "More details", documents, and one save bar saying what is missing.
 */
function ProcessShell({
  accent,
  facts,
  before,
  locked,
  children,
  more,
  flow,
  stage,
  onFilesChanged,
  summary,
  problem,
  saveLabel,
  saving,
  onSave,
}: {
  accent: string;
  facts: Array<[string, React.ReactNode]>;
  /** Shown under the facts, before the fields (e.g. the deliveries so far). */
  before?: React.ReactNode;
  /** Why it can't be changed any more, if so. */
  locked?: string | null;
  children?: React.ReactNode;
  more?: React.ReactNode;
  flow: FabricFlow;
  stage?: AttachmentStage;
  onFilesChanged?: () => void;
  summary?: React.ReactNode;
  problem: string;
  saveLabel: string;
  saving: boolean;
  onSave: () => void;
}) {
  const files = stage ? flow.attachments.filter((a) => a.stage === stage).length : 0;
  return (
    <form className={cn("pform", accent)} onSubmit={(e) => { e.preventDefault(); if (!problem && !locked) onSave(); }}>
      <dl className="pform__in">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}
      </dl>
      {before}
      {locked && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"><CheckCircle2 size={15} /> {locked}</p>}
      {!(locked && !children) && <fieldset disabled={!!locked || saving} className="pform__fields">{children}</fieldset>}
      {more && (
        <details className="pform__more">
          <summary>More details</summary>
          <fieldset disabled={!!locked || saving} className="pform__fields">{more}</fieldset>
        </details>
      )}
      {stage && onFilesChanged && (
        <details className="pform__more">
          <summary>Documents & photos{files ? ` · ${files}` : ""}</summary>
          <div className="pt-3"><Attachments flowId={flow.id} stage={stage} attachments={flow.attachments} onChanged={onFilesChanged} /></div>
        </details>
      )}
      {!locked && (
        <div className="users-dialog__foot pform__foot">
          <div className="mr-auto min-w-0 text-xs">
            {problem ? <p className="font-semibold text-amber-700">{problem}</p> : summary ? <p className="text-gray-600">{summary}</p> : null}
          </div>
          <Button type="submit" disabled={saving || !!problem}>{saving ? "Saving…" : saveLabel} <ArrowRight size={15} /></Button>
        </div>
      )}
    </form>
  );
}

/**
 * The fabric a process didn't use, back into a warehouse, like knitting's unused yarn: shown when less was used than
 * was sent (or a balance was returned before). `kg` "" means none.
 */
function BalanceBack({
  material,
  sentKg,
  usedKg,
  kg: value,
  warehouseId,
  warehouses,
  backTo,
  onChange,
}: {
  material: string;
  sentKg: number | null;
  usedKg: number;
  kg: string;
  warehouseId: string;
  warehouses: Warehouse[];
  /** The code it goes back under. */
  backTo: string;
  onChange: (changes: { kg?: string; warehouseId?: string }) => void;
}) {
  const left = sentKg === null ? 0 : Math.max(0, sentKg - usedKg);
  if (!(left > EMPTY) && !(numeric(value) > 0)) return null;
  return (
    <div className="pform__balance">
      <p className="pform__balance-title">
        {material[0].toUpperCase() + material.slice(1)} not used: <b>{kg(left)}</b>
        <span> · of {kg(sentKg ?? 0)} sent, {kg(usedKg)} used. Not a loss: it goes back into a warehouse under <b className="font-mono">{backTo}</b>.</span>
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Back to warehouse (KG)" hint="0 if none went back">
          <WeightInput value={value} placeholder={left > EMPTY ? String(Math.round(left * 1000) / 1000) : "0"} onValueChange={(next) => onChange({ kg: next })} />
          {left > EMPTY && value === "" && (
            <button type="button" className="mt-1 text-[11px] font-semibold text-[#1b3c55] underline" onClick={() => onChange({ kg: String(Math.round(left * 1000) / 1000) })}>All {kg(left)} went back</button>
          )}
        </Field>
        {numeric(value) > 0 && (
          <Field label="Into warehouse" required className="md:col-span-2">
            <select className="erp-input" value={warehouseId} onChange={(e) => onChange({ warehouseId: e.target.value })}>
              <option value="">Select warehouse</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </div>
  );
}

/** Why a balance can't be saved yet, or "". */
const balanceProblem = (material: string, sentKg: number | null, usedKg: number, value: string, warehouseId: string) =>
  numeric(value) > 0 && sentKg !== null && usedKg + numeric(value) > sentKg + EMPTY
    ? `The ${material} used and its balance are more than the ${kg(sentKg)} sent.`
    : numeric(value) > 0 && !warehouseId
      ? `Choose the warehouse the ${material} balance goes to.`
      : "";

/** Who a process's fabric is delivered to, and (admins) what they paid and what the delivery cost. */
type PartyDraft = { party: string; amount: string; deliveryCost: string };
function PartyFields({ value, onChange, parties, showPrices, weightKg }: { value: PartyDraft; onChange: (changes: Partial<PartyDraft>) => void; parties: string[]; showPrices: boolean; weightKg: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Party" required className={showPrices ? "" : "md:col-span-3"}>
        <SearchableSelect placeholder="Search party or type a new one" options={parties} value={value.party} onChange={(party) => onChange({ party })} />
      </Field>
      {showPrices && (
        <>
          <Field label="Amount collected" hint={numeric(value.amount) > 0 && weightKg > 0 ? `${money(numeric(value.amount) / weightKg)} / KG` : "₹ · optional"}>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={value.amount} onChange={(e) => onChange({ amount: e.target.value })} />
          </Field>
          <Field label="Delivery cost" hint="₹ · transport, optional"><Input type="number" min="0" step="0.01" inputMode="decimal" value={value.deliveryCost} onChange={(e) => onChange({ deliveryCost: e.target.value })} /></Field>
        </>
      )}
    </div>
  );
}

/** The delivery a process made to a party when it finished (its fabric went straight to a customer). */
const partySale = (flow: FabricFlow): PartyDraft => {
  const sale = flow.deliveries.find((d) => d.destination === "CUSTOMER");
  return { party: sale?.partyName ?? "", amount: sale && toNumber(sale.amount) > 0 ? String(toNumber(sale.amount)) : "", deliveryCost: sale && toNumber(sale.expense) > 0 ? String(toNumber(sale.expense)) : "" };
};
const salePayload = (sale: PartyDraft) => ({
  partyName: sale.party.trim(),
  amount: numeric(sale.amount) > 0 ? numeric(sale.amount) : undefined,
  deliveryExpense: numeric(sale.deliveryCost) > 0 ? numeric(sale.deliveryCost) : undefined,
});

/**
 * Starting dyeing or compacting: who does it and when, and (when the fabric is in a warehouse) which stock. Dyeing
 * splits the knitting batch's grey fabric into colours, each a dyeing lot with its own code (one colour takes all of
 * it, with no weight to type); compacting takes all of a lot's dyed fabric. The weights out are entered when the
 * process is completed.
 */
export function StartProcessForm({ flow, process, directory, saving, run, fromWarehouse }: { flow: FabricFlow; process: Process; directory: FlowDirectory; saving: boolean; run: RunStage; fromWarehouse: boolean }) {
  const words = WORDS[process];
  const dyeing = process === "dyeing";
  const sentKg = dyeing ? flow.dyeingDeliveryKg : flow.compactingDeliveryKg;
  // The previous process may already have named the mill (not when the fabric went through a warehouse).
  const named = !fromWarehouse && (dyeing ? flow.knittingDestination !== "WAREHOUSE" : flow.dyeingDestination !== "WAREHOUSE");
  const [f, setF] = useState({
    mill: (named && (dyeing ? flow.dyeingMillDetails ?? flow.dyeingPartyDetails : flow.compactingMillDetails ?? flow.compactingPartyDetails)) || "",
    startDate: localDate(),
    inwardNo: "",
    notes: "",
    warehouseId: "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [lines, setLines] = useState(() => firstLines(flow.color ?? ""));

  // Fabric of this batch in a warehouse (when it ended there), to take all of it.
  const stock = useApiQuery<Array<{ itemCode: string; warehouseId: string; unit: string; balanceKg: number }>>(
    fromWarehouse ? `/inventory/balances${qs({ category: dyeing ? "GREY_FABRIC" : "DYED_FABRIC" })}` : null,
  );
  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouseOf = new Map(warehouses.map((w) => [w.id, w]));
  const ours = (code: string) => code === flow.flowNo || (dyeing && code.startsWith(`${flow.flowNo}-R`));
  const rows = (stock.data ?? []).filter((row) => ours(row.itemCode) && row.unit === "KG" && row.balanceKg > EMPTY);
  const rowKey = (row: { itemCode: string; warehouseId: string }) => `${row.itemCode}|${row.warehouseId}`;
  const chosen = rows.find((row) => rowKey(row) === f.warehouseId) ?? (rows.length === 1 ? rows[0] : undefined);
  const weight = fromWarehouse ? chosen?.balanceKg ?? null : dyeing ? greyToDye(flow) : sentKg;

  const problem =
    fromWarehouse && !stock.data ? "Checking the warehouse…" :
    fromWarehouse && !rows.length ? `No ${words.input} of ${flow.flowNo} is left in any warehouse.` :
    fromWarehouse && !chosen ? "Choose the warehouse it comes from." :
    !f.mill.trim() ? `Choose the ${process} mill.` :
    !f.startDate ? "Enter the start date." :
    dyeing ? lotsProblem(lines, weight) :
    "";

  const save = () =>
    run(async () => {
      const details = { startDate: f.startDate, partyDetails: f.mill.trim(), millDetails: f.mill.trim(), notes: f.notes.trim() || undefined };
      const lots = dyeing ? lotsPayload(lines) : undefined;
      if (fromWarehouse && chosen) {
        const started = await api<FabricFlow>("/production/fabric-flows/start-stock-process", {
          method: "POST",
          body: JSON.stringify({ process, itemCode: chosen.itemCode, warehouseId: chosen.warehouseId, ...details, lots, inwardNo: dyeing ? undefined : f.inwardNo.trim() || undefined }),
        });
        // Dyeing answers its first lot, so its challan opens; the page then reloads this batch with its lots.
        return started;
      }
      return api<FabricFlow>(`/production/fabric-flows/${flow.id}/${process}/start`, {
        method: "POST",
        body: JSON.stringify(dyeing ? { ...details, lots } : { ...details, receivedKg: sentKg, inwardNo: f.inwardNo.trim() || undefined }),
      });
    }, process);

  return (
    <ProcessShell
      accent={`is-${process}`}
      flow={flow}
      facts={[
        ["Material", <span key="m"><span className="font-mono">{chosen?.itemCode ?? flow.flowNo}</span> · {words.input}</span>],
        ["Weight", weight !== null ? (dyeing ? `${kg(weight)} to dye` : `${kg(weight)} · all of it`) : "—"],
        ["Fabric", [flow.fabricType, flow.fabricDiameter && `${flow.fabricDiameter} dia`, !dyeing && flow.color].filter(Boolean).join(" · ") || "—"],
      ]}
      before={dyeing && flow.lots.length > 0 ? (
        <div className="plots-done">
          <p className="pfloor__label">Dyeing lots so far</p>
          {flow.lots.map((lot) => (
            <Link key={lot.id} href={`/production?batch=${encodeURIComponent(lot.flowNo)}`} className="plots-done__row">
              <b className="font-mono">{lot.flowNo}</b>
              <span className="min-w-0 flex-1 truncate">{lot.color ?? "—"}</span>
              <span className="tabular-nums">{kg(toNumber(lot.purchasedWeightKg))}</span>
              <span className="plots-done__stage">{lotStage(lot)}</span>
            </Link>
          ))}
        </div>
      ) : undefined}
      problem={problem}
      summary={dyeing
        ? `${lines.length === 1 ? "A dyeing lot" : `${lines.length} dyeing lots`} start${lines.length === 1 ? "s" : ""} at ${f.mill.trim() || "the mill"}, each with its own code and delivery challan. Weights and charges are entered when each lot's dyeing is completed.`
        : `The ${words.input} goes to ${f.mill.trim() || "the mill"} with a delivery challan. Weights and charges are entered when ${process} is completed.`}
      saveLabel={`Start ${process}`}
      saving={saving}
      onSave={() => void save()}
      more={<Field label="Notes" hint="Optional"><Input maxLength={1000} placeholder="Vehicle, instructions…" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {fromWarehouse && rows.length > 1 && (
          <Field label="From warehouse" required className="md:col-span-3">
            <select className="erp-input" value={chosen ? rowKey(chosen) : ""} onChange={(e) => set({ warehouseId: e.target.value })}>
              <option value="">Select the stock</option>
              {rows.map((row) => <option key={rowKey(row)} value={rowKey(row)}>{row.itemCode !== flow.flowNo ? `${row.itemCode} · ` : ""}{warehouseOf.get(row.warehouseId)?.code ?? "Warehouse"} · {kg(row.balanceKg)}</option>)}
            </select>
          </Field>
        )}
        <Field label={`${words.name} mill`} required className="md:col-span-2">
          <SearchableSelect placeholder={`Search ${process} mill or add new`} options={dyeing ? directory.dyeingMills : directory.compactingMills} value={f.mill} onChange={(mill) => set({ mill })} />
        </Field>
        <Field label="Start date" required><Input type="date" max={localDate()} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
        {!dyeing && <Field label="Inward number" hint="Optional"><Input maxLength={80} placeholder="Gate pass / challan" value={f.inwardNo} onChange={(e) => set({ inwardNo: e.target.value })} /></Field>}
      </div>
      {dyeing && (
        <Field label="Colours" required hint="Each colour is a dyeing lot with its own code" className="mt-3">
          <DyeingLotsInput lines={lines} onChange={setLines} available={weight} batchCode={flow.flowNo} lotsSoFar={flow.lots.length} />
        </Field>
      )}
    </ProcessShell>
  );
}

/**
 * Completing dyeing (or correcting it): the grey fabric used, the dyed fabric that came out, its colour and rolls,
 * the charges, and where it goes next (compacting or a warehouse) with its delivery challan.
 */
export function DyeingForm({ flow, directory, saving, run, onFilesChanged, showPrices }: { flow: FabricFlow; directory: FlowDirectory; saving: boolean; run: RunStage; onFilesChanged: () => void; showPrices: boolean }) {
  const { data: warehouseList = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouses = warehouseList.filter((w) => w.active !== false);
  const done = flow.dyeingOutputWeightKg !== null;
  const [f, setF] = useState({
    finishedDate: localDate(flow.dyeingFinishedAt),
    received: String(flow.fabricReceivedKg ?? flow.dyeingDeliveryKg ?? ""),
    output: flow.dyeingOutputWeightKg !== null ? String(flow.dyeingOutputWeightKg) : "",
    color: flow.color ?? "",
    rolls: flow.rollCount !== null ? String(flow.rollCount) : "",
    expense: String(flow.dyeingExpense || ""),
    destination: flow.dyeingDestination ?? "NEXT_PROCESS",
    warehouseId: flow.dyeingDestinationWarehouseId ?? "",
    nextMill: (flow.dyeingDestination === "NEXT_PROCESS" && (flow.compactingMillDetails ?? flow.compactingPartyDetails)) || "",
    nextStartDate: "",
    nextInwardNo: "",
    nextNotes: "",
    // More details
    startDate: localDate(flow.dyeingDate),
    mill: flow.dyeingMillDetails ?? flow.dyeingPartyDetails ?? "",
    greyWeight: flow.dyeingGreyWeightKg !== null ? String(flow.dyeingGreyWeightKg) : "",
    count: flow.dyeingCount ?? flow.yarnCount,
    sentOn: done && flow.compactingDeliveryKg !== null && flow.compactingDeliveryKg !== flow.dyeingOutputWeightKg ? String(flow.compactingDeliveryKg) : "",
    notes: flow.dyeingNotes ?? "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const toWarehouse = f.destination === "WAREHOUSE";
  const toParty = f.destination === "PARTY";
  const toNextProcess = f.destination === "NEXT_PROCESS";
  const compactingStartDate = f.nextStartDate || f.finishedDate;
  const compactingStartWeight = f.sentOn ? numeric(f.sentOn) : numeric(f.output);
  const [sale, setSale] = useState<PartyDraft>(() => (flow.dyeingDestination === "PARTY" ? partySale(flow) : { party: "", amount: "", deliveryCost: "" }));
  // Grey fabric dyeing didn't use, back into a warehouse (a lot's under its knitting batch's code).
  const [balance, setBalance] = useState({ kg: flow.dyeingBalanceKg ? String(flow.dyeingBalanceKg) : "", warehouseId: "" });
  const received = numeric(f.received);
  const output = numeric(f.output);
  const receivedCheck = feedback(flow.dyeingDeliveryKg, f.received);
  const outputCheck = feedback(received, f.output);
  const sentCheck = f.sentOn ? feedback(output, f.sentOn) : { error: null, warning: null };
  const locked = warehouseDelivery(flow, "DYEING")?.receivedAt
    ? "The warehouse has received this dyed fabric, so dyeing can no longer be changed."
    : flow.compactingDate || flow.compactingFinishedAt || flow.officeDeliveryKg !== null
      ? "Compacting has started, so dyeing can no longer be changed."
      : null;

  const problem =
    !f.finishedDate ? "Enter the completed date." :
    f.startDate && f.finishedDate < f.startDate ? "Completed before it started." :
    !(received > 0) ? "Enter the grey fabric used." :
    receivedCheck.error ?? (!(output > 0) ? "Enter the dyed fabric weight." : outputCheck.error) ??
    (!f.color.trim() ? "Enter the colour." :
    f.rolls === "" || !/^\d+$/.test(f.rolls.trim()) ? "Enter the rolls (a whole number)." :
    !f.mill.trim() ? "Choose the dyeing mill under More details." :
    balanceProblem("grey fabric", flow.dyeingDeliveryKg, received, balance.kg, balance.warehouseId) ||
    (toParty ? (!sale.party.trim() ? "Enter the party it goes to." : sentCheck.error ?? "") :
    toWarehouse ? (!f.warehouseId ? "Choose the warehouse." : sentCheck.error ?? "") : !f.nextMill.trim() ? "Choose the compacting mill." :
    !(compactingStartWeight > 0) ? "Enter the weight sent to compacting." :
    !compactingStartDate || compactingStartDate < f.finishedDate ? "Compacting must start on or after dyeing is completed." :
    compactingStartDate > localDate() ? "Compacting cannot start on a future date." : sentCheck.error ?? ""));

  const save = () =>
    run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/dyeing`, {
          method: "POST",
          body: JSON.stringify({
            dyeingDate: f.startDate || f.finishedDate,
            finishedDate: f.finishedDate,
            dyeingPartyDetails: f.mill.trim(),
            dyeingMillDetails: f.mill.trim(),
            fabricReceivedKg: received,
            dyeingGreyWeightKg: f.greyWeight ? numeric(f.greyWeight) : undefined,
            color: f.color.trim(),
            dyeingCount: f.count.trim() || undefined,
            rollCount: Math.floor(numeric(f.rolls)),
            dyeingOutputWeightKg: output,
            dyeingExpense: numeric(f.expense),
            dyeingNotes: f.notes.trim() || undefined,
            compactingDeliveryKg: f.sentOn ? numeric(f.sentOn) : undefined,
            destination: f.destination,
            warehouseId: toWarehouse ? f.warehouseId : undefined,
            nextPartyDetails: f.destination === "NEXT_PROCESS" ? f.nextMill.trim() : undefined,
            nextMillDetails: f.destination === "NEXT_PROCESS" ? f.nextMill.trim() : undefined,
            compactingStart: toNextProcess ? { startDate: compactingStartDate, receivedKg: compactingStartWeight, inwardNo: f.nextInwardNo.trim() || undefined, notes: f.nextNotes.trim() || undefined } : undefined,
            ...(toParty ? salePayload(sale) : {}),
            balanceKg: numeric(balance.kg) > 0 ? numeric(balance.kg) : 0,
            balanceWarehouseId: numeric(balance.kg) > 0 ? balance.warehouseId : undefined,
          }),
        }),
      f.destination === "NEXT_PROCESS" ? "compacting" : "dyeing",
    );

  const charges = numeric(f.expense);
  return (
    <ProcessShell
      accent="is-dyeing"
      flow={flow}
      stage="DYEING"
      onFilesChanged={onFilesChanged}
      locked={locked}
      facts={[
        ["Material", <span key="m"><span className="font-mono">{flow.flowNo}</span> · grey fabric</span>],
        ["Sent to dyeing", flow.dyeingDeliveryKg !== null ? kg(flow.dyeingDeliveryKg) : "—"],
        ["Mill", f.mill || "—"],
        ["Started", shortDate(flow.dyeingDate) ?? "—"],
      ]}
      problem={problem}
      summary={<>In <b>{kg(received)}</b> → out <b>{kg(output)}</b> {changeText(received, output) && <>· {changeText(received, output)}</>}{showPrices && charges > 0 ? <> · charges <b>{money(charges)}</b>{received > 0 ? ` (${money(charges / received)} / KG)` : ""}</> : null}</>}
      saveLabel={toNextProcess ? "Complete dyeing & start compacting" : done ? "Save changes" : toParty ? "Complete & deliver to party" : "Complete & send to warehouse"}
      saving={saving}
      onSave={() => void save()}
      more={
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Dyeing mill" required className="md:col-span-2"><SearchableSelect placeholder="Search dyeing mill" options={directory.dyeingMills} value={f.mill} onChange={(mill) => set({ mill })} /></Field>
          <Field label="Started on"><Input type="date" max={f.finishedDate || undefined} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Grey weight at the mill" hint="Optional · KG"><WeightInput value={f.greyWeight} onValueChange={(greyWeight) => set({ greyWeight })} /></Field>
          <Field label="Count" hint="Optional"><Input maxLength={80} value={f.count} onChange={(e) => set({ count: e.target.value })} /></Field>
          <Field label={toParty ? "Weight delivered to the party" : toWarehouse ? "Weight sent to warehouse" : "Weight sent to compacting"} hint="Optional · all of the output when blank" error={sentCheck.error} warning={sentCheck.warning}><WeightInput value={f.sentOn} placeholder={f.output || undefined} onValueChange={(sentOn) => set({ sentOn })} /></Field>
          <Field label="Notes" hint="Optional" className="md:col-span-3"><Input maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Completed on" required><Input type="date" min={f.startDate || undefined} max={localDate()} value={f.finishedDate} onChange={(e) => set({ finishedDate: e.target.value })} /></Field>
        <Field label="Grey fabric used" required hint={flow.dyeingDeliveryKg !== null ? `sent ${kg(flow.dyeingDeliveryKg)} · ±${WEIGHT_TOLERANCE_KG}` : "KG"} error={receivedCheck.error} warning={receivedCheck.warning}><WeightInput value={f.received} onValueChange={(v) => set({ received: v })} /></Field>
        <Field label="Dyed fabric" required hint="KG out" error={outputCheck.error} warning={outputCheck.warning}><WeightInput value={f.output} onValueChange={(v) => set({ output: v })} autoFocus={!done} /></Field>
        <Field label="Colour" required><Input maxLength={80} placeholder="Fabric colour" value={f.color} onChange={(e) => set({ color: e.target.value })} /></Field>
        <Field label="Rolls" required><Input type="number" min="0" step="1" inputMode="numeric" value={f.rolls} onChange={(e) => set({ rolls: e.target.value })} /></Field>
        {showPrices && <ChargeInput label="Dyeing charges" value={f.expense} weightKg={received} onChange={(expense) => set({ expense })} />}
      </div>
      <BalanceBack
        material="grey fabric"
        sentKg={flow.dyeingDeliveryKg}
        usedKg={received}
        kg={balance.kg}
        warehouseId={balance.warehouseId}
        warehouses={warehouses}
        backTo={flow.parent?.flowNo ?? flow.flowNo}
        onChange={(changes) => setBalance((current) => ({ ...current, ...changes }))}
      />
      <FieldGroup label="Send the dyed fabric to" required>
        <DestinationToggle value={f.destination} next="compacting" onChange={(destination) => set({ destination, warehouseId: "" })} />
      </FieldGroup>
      {toParty ? (
        <PartyFields value={sale} onChange={(changes) => setSale((current) => ({ ...current, ...changes }))} parties={directory.deliveryParties ?? []} showPrices={showPrices} weightKg={f.sentOn ? numeric(f.sentOn) : output} />
      ) : toWarehouse ? (
        <Field label="Warehouse" required>
          <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
            <option value="">Select warehouse</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
      ) : (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
          <h3 className="text-sm font-bold text-[#123f35]">Send to compacting & start</h3>
          <p className="mb-3 mt-1 text-xs text-gray-600">Complete dyeing and start compacting with these details in one step.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Compacting mill" required><SearchableSelect placeholder="Search compacting mill or add new" options={directory.compactingMills} value={f.nextMill} onChange={(nextMill) => set({ nextMill })} /></Field>
            <Field label="Compacting start date" required><Input type="date" min={f.finishedDate || undefined} max={localDate()} value={compactingStartDate} onChange={(e) => set({ nextStartDate: e.target.value })} /></Field>
            <Field label="Compacting inward number" hint="Optional"><Input maxLength={80} value={f.nextInwardNo} onChange={(e) => set({ nextInwardNo: e.target.value })} /></Field>
            <div className="text-xs text-gray-600"><p className="mb-1.5 font-semibold">Fabric sent to compacting</p><p className="font-bold text-gray-800">{kg(compactingStartWeight)}</p></div>
            <Field label="Compacting instructions" hint="Optional" className="md:col-span-2"><Input maxLength={1000} value={f.nextNotes} onChange={(e) => set({ nextNotes: e.target.value })} /></Field>
          </div>
        </section>
      )}
    </ProcessShell>
  );
}

/**
 * Completing compacting (or correcting it): the dyed fabric used, the finished (compacted) weight that came out
 * and the charges, and where all of the finished fabric goes (a party or a warehouse) with its delivery challan.
 */
export function CompactingForm({ flow, directory, saving, run, onFilesChanged, showPrices }: { flow: FabricFlow; directory: FlowDirectory; saving: boolean; run: RunStage; onFilesChanged: () => void; showPrices: boolean }) {
  const done = flow.officeDeliveryKg !== null;
  const { data: warehouseList = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouses = warehouseList.filter((w) => w.active !== false);
  // The finished fabric is delivered with the completion, while nothing has been delivered yet.
  const delivers = flow.deliveries.length === 0 && (flow.finalDeliveredKg ?? 0) < EMPTY;
  const [to, setTo] = useState<"PARTY" | "WAREHOUSE">("PARTY");
  const [toStore, setToStore] = useState("");
  const [sale, setSale] = useState<PartyDraft>({ party: "", amount: "", deliveryCost: "" });
  // The rolls going with the finished fabric, on its delivery challan; the dyed rolls to start with.
  const [rolls, setRolls] = useState(flow.rollCount !== null ? String(flow.rollCount) : "");
  // Dyed fabric compacting didn't use, back into a warehouse under the batch's code.
  const [balance, setBalance] = useState({ kg: flow.compactingBalanceKg ? String(flow.compactingBalanceKg) : "", warehouseId: "" });
  const [f, setF] = useState({
    finishedDate: localDate(flow.compactingFinishedAt),
    received: String(flow.compactingReceivedKg ?? flow.compactingDeliveryKg ?? ""),
    output: flow.officeDeliveryKg !== null ? String(flow.officeDeliveryKg) : "",
    expense: String(flow.compactingExpense || ""),
    outwardNo: flow.compactingOutwardNo ?? "",
    // More details
    startDate: localDate(flow.compactingDate),
    mill: flow.compactingMillDetails ?? flow.compactingPartyDetails ?? "",
    inwardNo: flow.compactingInwardNo ?? "",
    notes: flow.compactingNotes ?? "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const received = numeric(f.received);
  const output = numeric(f.output);
  const receivedCheck = feedback(flow.compactingDeliveryKg, f.received);
  const outputCheck = feedback(received, f.output);
  const delivered = flow.finalDeliveredKg ?? 0;

  const problem =
    !f.finishedDate ? "Enter the completed date." :
    f.startDate && f.finishedDate < f.startDate ? "Completed before it started." :
    !(received > 0) ? "Enter the dyed fabric used." :
    receivedCheck.error ?? (!(output > 0) ? "Enter the compacted weight." : outputCheck.error) ??
    (output < delivered - EMPTY ? `${kg(delivered)} is already delivered; the compacted weight can't be less.` :
    !f.mill.trim() ? "Choose the compacting mill under More details." :
    balanceProblem("dyed fabric", flow.compactingDeliveryKg, received, balance.kg, balance.warehouseId) ? balanceProblem("dyed fabric", flow.compactingDeliveryKg, received, balance.kg, balance.warehouseId) :
    delivers && to === "PARTY" && !sale.party.trim() ? "Enter the party the finished fabric goes to." :
    delivers && to === "WAREHOUSE" && !toStore ? "Choose the warehouse the finished fabric goes to." : "");

  const save = () =>
    run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/compacting`, {
          method: "POST",
          body: JSON.stringify({
            compactingDate: f.startDate || f.finishedDate,
            finishedDate: f.finishedDate,
            compactingPartyDetails: f.mill.trim(),
            compactingMillDetails: f.mill.trim(),
            compactingInwardNo: f.inwardNo.trim() || undefined,
            compactingReceivedKg: received,
            compactingOutwardNo: f.outwardNo.trim() || undefined,
            officeDeliveryKg: output,
            compactingExpense: numeric(f.expense),
            compactingNotes: f.notes.trim() || undefined,
            balanceKg: numeric(balance.kg) > 0 ? numeric(balance.kg) : 0,
            balanceWarehouseId: numeric(balance.kg) > 0 ? balance.warehouseId : undefined,
            // All of the finished fabric goes on with the completion.
            ...(delivers
              ? {
                  delivery:
                    to === "PARTY"
                      ? { destination: "CUSTOMER", partyName: sale.party.trim(), amount: numeric(sale.amount) > 0 ? numeric(sale.amount) : undefined, expense: numeric(sale.deliveryCost) > 0 ? numeric(sale.deliveryCost) : undefined, packages: rolls.trim() ? Math.floor(numeric(rolls)) : undefined }
                      : { destination: "WAREHOUSE", warehouseId: toStore, packages: rolls.trim() ? Math.floor(numeric(rolls)) : undefined },
                }
              : {}),
          }),
        }),
      "compacting",
    );

  const charges = numeric(f.expense);
  return (
    <ProcessShell
      accent="is-compacting"
      flow={flow}
      stage="COMPACTING"
      onFilesChanged={onFilesChanged}
      facts={[
        ["Material", <span key="m"><span className="font-mono">{flow.flowNo}</span> · dyed fabric{flow.color ? ` · ${flow.color}` : ""}</span>],
        ["Sent to compacting", flow.compactingDeliveryKg !== null ? kg(flow.compactingDeliveryKg) : "—"],
        ["Mill", f.mill || "—"],
        ["Started", shortDate(flow.compactingDate) ?? "—"],
      ]}
      problem={problem}
      summary={<>In <b>{kg(received)}</b> → finished <b>{kg(output)}</b> {changeText(received, output) && <>· {changeText(received, output)}</>}{showPrices && charges > 0 ? <> · charges <b>{money(charges)}</b>{received > 0 ? ` (${money(charges / received)} / KG)` : ""}</> : null}</>}
      saveLabel={delivers ? (to === "PARTY" ? "Complete & deliver to party" : "Complete & send to warehouse") : done ? "Save changes" : "Complete compacting"}
      saving={saving}
      onSave={() => void save()}
      more={
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Compacting mill" required className="md:col-span-2"><SearchableSelect placeholder="Search compacting mill" options={directory.compactingMills} value={f.mill} onChange={(mill) => set({ mill })} /></Field>
          <Field label="Started on"><Input type="date" max={f.finishedDate || undefined} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Inward number" hint="Optional"><Input maxLength={80} placeholder="Gate pass / challan" value={f.inwardNo} onChange={(e) => set({ inwardNo: e.target.value })} /></Field>
          <Field label="Notes" hint="Optional" className="md:col-span-2"><Input maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Completed on" required><Input type="date" min={f.startDate || undefined} max={localDate()} value={f.finishedDate} onChange={(e) => set({ finishedDate: e.target.value })} /></Field>
        <Field label="Dyed fabric used" required hint={flow.compactingDeliveryKg !== null ? `sent ${kg(flow.compactingDeliveryKg)} · ±${WEIGHT_TOLERANCE_KG}` : "KG"} error={receivedCheck.error} warning={receivedCheck.warning}><WeightInput value={f.received} onValueChange={(v) => set({ received: v })} /></Field>
        <Field label="Compacted weight" required hint="Finished fabric, KG" error={outputCheck.error} warning={outputCheck.warning}><WeightInput value={f.output} onValueChange={(v) => set({ output: v })} autoFocus={!done} /></Field>
        {showPrices && <ChargeInput label="Compacting charges" value={f.expense} weightKg={received} onChange={(expense) => set({ expense })} />}
        <Field label="Outward number" hint="Optional"><Input maxLength={80} placeholder="Gate pass / challan" value={f.outwardNo} onChange={(e) => set({ outwardNo: e.target.value })} /></Field>
      </div>
      <BalanceBack
        material="dyed fabric"
        sentKg={flow.compactingDeliveryKg}
        usedKg={received}
        kg={balance.kg}
        warehouseId={balance.warehouseId}
        warehouses={warehouses}
        backTo={flow.flowNo}
        onChange={(changes) => setBalance((current) => ({ ...current, ...changes }))}
      />
      {delivers ? (
        <>
          <FieldGroup label="Deliver the finished fabric to" required>
            <DestinationToggle value={to} onChange={(next) => setTo(next === "WAREHOUSE" ? "WAREHOUSE" : "PARTY")} />
          </FieldGroup>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Rolls going" hint="On the delivery challan">
              <Input type="number" min="0" step="1" inputMode="numeric" value={rolls} onChange={(e) => setRolls(e.target.value)} />
            </Field>
          </div>
          {to === "PARTY" ? (
            <PartyFields value={sale} onChange={(changes) => setSale((current) => ({ ...current, ...changes }))} parties={directory.deliveryParties ?? []} showPrices={showPrices} weightKg={output} />
          ) : (
            <Field label="Warehouse" required>
              <select className="erp-input" value={toStore} onChange={(e) => setToStore(e.target.value)}>
                <option value="">Select warehouse</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </Field>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">
          Delivered {kg(delivered)}{flow.deliveries.length ? ` to ${[...new Set(flow.deliveries.map((d) => (d.destination === "CUSTOMER" ? d.partyName ?? "a party" : d.warehouse?.code ?? "a warehouse")))].join(", ")}` : ""}.{" "}
          {(flow.officeDeliveryKg ?? 0) - delivered > EMPTY ? `${kg((flow.officeDeliveryKg ?? 0) - delivered)} is left: deliver it from the compacting card.` : ""}
        </p>
      )}
    </ProcessShell>
  );
}

/**
 * Knitting a batch: who knits it (the own mill's machines or another mill), then when it is done the yarn used
 * (the rest goes back into stock), the grey fabric that came off, its rolls, charges and where it goes next, with its
 * delivery challan. Own-mill work on machines is finished from the Machines page.
 */
export function KnittingForm({ flow, directory, saving, run, onFilesChanged, showPrices, managerMode }: { flow: FabricFlow; directory: FlowDirectory; saving: boolean; run: RunStage; onFilesChanged: () => void; showPrices: boolean; managerMode: boolean }) {
  const { data: warehouseList = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouses = warehouseList.filter((w) => w.active !== false);
  const knitting = isKnitting(flow);
  const fromStock = !!flow.yarnItemCode;
  // The yarn it can have used: its own, or what the finished types sharing its yarn left.
  const pool = flow.yarnPool ?? null;
  const given = pool ? pool.leftForThisKg : flow.yarnReceivedKg ?? flow.purchasedWeightKg;
  const own = flow.knittingMillType === "OWN";
  const runs = flow.knittingRuns ?? [];
  const onMachines = runs.filter((r) => r.status === "RUNNING");
  const knittedOnMachines = runs.reduce((sum, r) => sum + toNumber(r.outputKg ?? 0), 0);
  // Rolls entered day by day on the Machines page (null when none are entered there).
  const rollsOnMachines = runs.some((r) => r.rollCount !== null && r.rollCount !== undefined) ? runs.reduce((sum, r) => sum + (r.rollCount ?? 0), 0) : null;
  const machinesBusy = own && onMachines.length > 0;
  const machineRuns = useApiQuery<KnitRun[]>(machinesBusy ? "/knitting/runs" : null);
  const [stopShift, setStopShift] = useState<Shift>(() => currentShift().shift);
  const [stopWarehouseId, setStopWarehouseId] = useState("");
  const [stopEdits, setStopEdits] = useState<Record<string, { outputKg: string; rolls: string }>>({});
  const changeStop = (id: string, changes: Partial<{ outputKg: string; rolls: string }>) => setStopEdits((current) => ({ ...current, [id]: { ...(current[id] ?? { outputKg: "", rolls: "" }), ...changes } }));
  const [f, setF] = useState({
    finishedDate: flow.knittingFinishedAt ? localDate(flow.knittingFinishedAt) : machinesBusy ? currentShift().date : localDate(),
    yarnUsed: String(flow.purchasedWeightKg),
    total: flow.knittingDeliveryKg !== null ? String(flow.knittingDeliveryKg) : own && knittedOnMachines > 0 ? String(Math.round(knittedOnMachines * 1000) / 1000) : "",
    rolls: flow.knittingBagCount ? String(flow.knittingBagCount) : own && rollsOnMachines ? String(rollsOnMachines) : "",
    expense: String(flow.knittingExpense || ""),
    yarnRate: String(flow.yarnRatePerKg || ""),
    destination: flow.knittingDestination ?? "NEXT_PROCESS",
    warehouseId: flow.knittingDestinationWarehouseId ?? "",
    nextMill: (flow.knittingDestination === "NEXT_PROCESS" && (flow.dyeingMillDetails ?? flow.dyeingPartyDetails)) || "",
    nextStartDate: "",
    nextNotes: "",
    // More details
    reference: flow.knittingDestination !== "WAREHOUSE" && flow.knittingDeliveryPlace && flow.knittingDeliveryPlace !== flow.dyeingMillDetails ? flow.knittingDeliveryPlace : "",
    notes: flow.knittingNotes ?? "",
    startDate: localDate(flow.knittingDate ?? flow.purchaseDate),
    expected: flow.knittingExpectedFinishDate ? localDate(flow.knittingExpectedFinishDate) : "",
    mill: own ? "" : flow.knittingMillDetails ?? flow.knittingPartyDetails ?? "",
    gg: flow.knittingGg ?? "",
    ll: flow.knittingLl ?? "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const toWarehouse = f.destination === "WAREHOUSE";
  const toParty = f.destination === "PARTY";
  const toNextProcess = f.destination === "NEXT_PROCESS";
  const dyeingStartDate = f.nextStartDate || f.finishedDate;
  const [dyeingLines, setDyeingLines] = useState(() => firstLines(flow.color ?? ""));
  const [sale, setSale] = useState<PartyDraft>(() => (flow.knittingDestination === "PARTY" ? partySale(flow) : { party: "", amount: "", deliveryCost: "" }));
  const yarnUsed = fromStock && numeric(f.yarnUsed) > 0 ? numeric(f.yarnUsed) : flow.purchasedWeightKg;
  const leftover = Math.max(0, given - yarnUsed);
  const finishMachines = onMachines.map((summary) => {
    const detail = machineRuns.data?.find((run) => run.id === summary.id);
    const edit = stopEdits[summary.id] ?? { outputKg: "", rolls: "" };
    const otherDays = detail?.days.filter((day) => day.date.slice(0, 10) !== f.finishedDate) ?? [];
    return { summary, detail, edit,
      output: edit.outputKg !== "" ? otherDays.reduce((sum, day) => sum + day.outputKg, 0) + numeric(edit.outputKg) : toNumber(detail?.outputKg ?? summary.outputKg ?? 0),
      rolls: edit.outputKg !== "" ? otherDays.reduce((sum, day) => sum + day.rollCount, 0) + numeric(edit.rolls) : detail?.rollCount ?? summary.rollCount ?? 0,
    };
  });
  const stoppedRuns = runs.filter((run) => run.status !== "RUNNING");
  const total = machinesBusy ? Math.round((stoppedRuns.reduce((sum, run) => sum + toNumber(run.outputKg ?? 0), 0) + finishMachines.reduce((sum, run) => sum + run.output, 0)) * 1000) / 1000 : numeric(f.total);
  const totalValue = machinesBusy ? String(total) : f.total;
  const rollsValue = machinesBusy ? String(stoppedRuns.reduce((sum, run) => sum + (run.rollCount ?? 0), 0) + finishMachines.reduce((sum, run) => sum + run.rolls, 0)) : f.rolls;
  const fabricWarehouse = stopWarehouseId || (warehouses.length === 1 ? warehouses[0].id : "");
  const totalCheck = feedback(yarnUsed, totalValue);
  const now = currentShift();
  const machineProblem = !machinesBusy ? "" :
    machineRuns.loading ? "Loading machine production…" :
    machineRuns.error ? "Could not load machine production. Retry below." :
    finishMachines.some((run) => !run.detail || run.detail.status !== "RUNNING") ? "A machine run has changed. Refresh the batch before finishing." :
    finishMachines.some((run) => !run.detail!.days.length && run.edit.outputKg === "") ? "Enter the final day's fabric and rolls for each machine below." :
    finishMachines.some((run) => run.edit.outputKg !== "" && (!(numeric(run.edit.outputKg) > 0) || !/^\d+$/.test(run.edit.rolls.trim()))) ? "Enter positive final-day fabric and a whole number of rolls for each machine." :
    finishMachines.some((run) => run.edit.outputKg !== "") && !fabricWarehouse ? "Choose the fabric warehouse for the final machine production." :
    finishMachines.some((run) => shiftIndex(f.finishedDate, stopShift) < shiftIndex(run.detail!.startedAt, run.detail!.startShift) || run.detail!.days.some((day) => day.date.slice(0, 10) > f.finishedDate)) ? "The finish date or shift is before recorded machine production." :
    shiftIndex(f.finishedDate, stopShift) > shiftIndex(now.date, now.shift) ? "Choose a finish shift that has already started." : "";
  // Start details changed under More details are saved first (they are their own record).
  const detailsChanged =
    !managerMode &&
    (f.startDate !== localDate(flow.knittingDate ?? flow.purchaseDate) ||
      f.expected !== (flow.knittingExpectedFinishDate ? localDate(flow.knittingExpectedFinishDate) : "") ||
      (!own && f.mill.trim() !== (flow.knittingMillDetails ?? flow.knittingPartyDetails ?? "")) ||
      f.gg.trim() !== (flow.knittingGg ?? "") ||
      f.ll.trim() !== (flow.knittingLl ?? ""));
  // Knitting can be corrected until the next place (a warehouse or dyeing) has received its grey fabric.
  const locked = knittingEditable(flow)
    ? null
    : warehouseDelivery(flow, "KNITTING")?.receivedAt
      ? "The warehouse has received this grey fabric, so knitting can no longer be changed."
      : "Dyeing has received this grey fabric, so knitting can no longer be changed.";
  const problem =
    !f.finishedDate ? "Enter the finished date." :
    f.finishedDate < f.startDate ? "Finished before knitting started." :
    machineProblem ? machineProblem :
    fromStock && !(numeric(f.yarnUsed) > 0) ? "Enter the yarn used." :
    fromStock && numeric(f.yarnUsed) > given + EMPTY ? (pool ? `Only ${kg(given)} of the shared yarn is left for ${flow.flowNo}.` : `Only ${kg(given)} of yarn was given to knitting.`) :
    !(total > 0) ? "Enter the grey fabric weight." :
    totalCheck.error ??
    (!/^\d+$/.test(rollsValue.trim()) || Number(rollsValue) < 1 ? "Enter the rolls (at least 1)." :
    !own && !f.mill.trim() ? "Choose the knitting mill under More details." :
    toParty ? (!sale.party.trim() ? "Enter the party it goes to." : "") :
    toWarehouse ? (!f.warehouseId ? "Choose the warehouse." : "") : !f.nextMill.trim() ? "Choose the dyeing mill." :
    !dyeingStartDate || dyeingStartDate < f.finishedDate ? "Dyeing must start on or after knitting is finished." :
    dyeingStartDate > localDate() ? "Dyeing cannot start on a future date." : lotsProblem(dyeingLines, total));

  const save = () =>
    run(async () => {
      if (detailsChanged) {
        await api<FabricFlow>(`/production/fabric-flows/${flow.id}/knitting`, {
          method: "PATCH",
          body: JSON.stringify({
            startDate: f.startDate,
            expectedFinishDate: f.expected || undefined,
            partyDetails: own ? flow.knittingPartyDetails ?? "Own mill" : f.mill.trim(),
            millDetails: own ? flow.knittingMillDetails ?? "Own mill" : f.mill.trim(),
            gg: f.gg.trim() || undefined,
            ll: f.ll.trim() || undefined,
          }),
        });
      }
      return api<FabricFlow>(`/production/fabric-flows/${flow.id}/knitting/finish`, {
        method: "POST",
        body: JSON.stringify({
          finishedDate: f.finishedDate,
          rollCount: Math.floor(numeric(rollsValue)),
          totalWeightKg: Math.round(total * 1000) / 1000,
          ...(machinesBusy ? {
            machineStops: finishMachines.map((run) => ({ runId: run.summary.id, ...(run.edit.outputKg !== "" ? { outputKg: numeric(run.edit.outputKg), rollCount: numeric(run.edit.rolls) } : {}) })),
            stopShift,
            stopWarehouseId: finishMachines.some((run) => run.edit.outputKg !== "") ? fabricWarehouse : undefined,
          } : {}),
          destination: f.destination,
          warehouseId: toWarehouse ? f.warehouseId : undefined,
          deliveryPlace: toWarehouse ? "Warehouse delivery" : toParty ? sale.party.trim() : f.reference.trim() || f.nextMill.trim(),
          nextPartyDetails: f.destination === "NEXT_PROCESS" ? f.nextMill.trim() : undefined,
          nextMillDetails: f.destination === "NEXT_PROCESS" ? f.nextMill.trim() : undefined,
          dyeingStart: toNextProcess ? { startDate: dyeingStartDate, lots: lotsPayload(dyeingLines), fabricReceivedKg: total, color: dyeingLines[0]?.color.trim(), notes: f.nextNotes.trim() || undefined } : undefined,
          ...(toParty ? salePayload(sale) : {}),
          knittingExpense: numeric(f.expense),
          notes: f.notes.trim() || undefined,
          ...(fromStock ? { yarnUsedKg: Math.round(numeric(f.yarnUsed) * 1000) / 1000 } : {}),
          ...(showPrices && f.yarnRate !== "" ? { yarnRatePerKg: numeric(f.yarnRate) } : {}),
        }),
      });
    }, f.destination === "NEXT_PROCESS" ? "dyeing" : "knitting");

  const charges = numeric(f.expense);
  const fabric = [flow.fabricType, flow.fabricDiameter && `${flow.fabricDiameter} dia`, gsmText(flow.fabricGsm), flow.knittingGg && `${flow.knittingGg} GG`, flow.knittingLl && `LL ${flow.knittingLl}`].filter(Boolean).join(" · ");
  return (
    <ProcessShell
      accent="is-knitting"
      flow={flow}
      stage="KNITTING"
      onFilesChanged={onFilesChanged}
      locked={locked}
      facts={[
        ["Material", <span key="m"><span className="font-mono">{flow.yarnItemCode ?? "Yarn"}</span> · {flow.yarnCount}{flow.yarnLotNo ? ` · lot ${flow.yarnLotNo}` : ""}</span>],
        ["Yarn given", `${kg(given)}${flow.yarnWarehouse ? ` from ${flow.yarnWarehouse.code}` : ""}`],
        ["Knitted at", own ? `Own mill${onMachines.length ? ` · ${onMachines.map((r) => r.machine.code).join(", ")}` : ""}` : flow.knittingMillDetails ?? flow.knittingPartyDetails ?? "—"],
        ...(pool ? ([["Shared yarn", `${kg(pool.totalKg)} with ${pool.sharedWith.join(", ")}${pool.usedByOthersKg > 0 ? ` · ${kg(pool.usedByOthersKg)} used by them` : ""}`]] as Array<[string, string]>) : []),
        ["Fabric to make", fabric || "—"],
      ]}
      before={
        own && runs.length > 0 ? (
          <div className="pform__note">
            <b>{kg(knittedOnMachines)}</b> knitted on {runs.length} machine run{runs.length === 1 ? "" : "s"} ({runs.map((r) => `${r.machine.code}${r.status === "RUNNING" ? " running" : ""}`).join(", ")}), entered day by day on the Machines page.{" "}
            {machinesBusy ? "Running machines will stop when this form is saved. Enter any final-day production below." : <Link href="/masters/machines?view=tasks" className="font-semibold underline">Open Machines</Link>}
          </div>
        ) : own && knitting ? (
          <div className="pform__note">No machine yet: put {flow.flowNo} on machines from the <Link href="/masters/machines?view=tasks" className="font-semibold underline">Machines</Link> page. Their KG and rolls are entered there each day.</div>
        ) : null
      }
      problem={problem}
      summary={<>Yarn <b>{kg(yarnUsed)}</b>{leftover > EMPTY ? <> ({kg(leftover)} back to stock)</> : null} → grey fabric <b>{kg(total)}</b> {changeText(yarnUsed, total) && <>· {changeText(yarnUsed, total)}</>}{showPrices && charges > 0 ? <> · charges <b>{money(charges)}</b></> : null}</>}
      saveLabel={toNextProcess ? "Finish knitting & start dyeing" : knitting ? (toParty ? "Finish & deliver to party" : "Finish & send to warehouse") : "Save changes"}
      saving={saving}
      onSave={() => void save()}
      more={
        <div className="grid gap-3 md:grid-cols-3">
          {!own && <Field label="Knitting mill" required className="md:col-span-2"><SearchableSelect placeholder="Search knitting mill" options={directory.knittingMills} value={f.mill} onChange={(mill) => set({ mill })} /></Field>}
          <Field label="Started on"><Input type="date" max={f.finishedDate || undefined} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Expected finish" hint="Optional"><Input type="date" min={f.startDate} value={f.expected} onChange={(e) => set({ expected: e.target.value })} /></Field>
          <Field label="Gauge (GG)" hint="Optional"><Input maxLength={40} value={f.gg} onChange={(e) => set({ gg: e.target.value })} /></Field>
          <Field label="Loop length (LL)" hint="Optional"><Input maxLength={40} value={f.ll} onChange={(e) => set({ ll: e.target.value })} /></Field>
          {!toWarehouse && <Field label="Delivery reference" hint="Optional · vehicle, their challan"><Input maxLength={200} value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>}
          <Field label="Notes" hint="Optional" className="md:col-span-3"><Input maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Finished on" required><Input type="date" min={f.startDate} max={localDate()} value={f.finishedDate} onChange={(e) => set({ finishedDate: e.target.value })} /></Field>
        <Field label="Fabric made (KG)" required hint={machinesBusy ? "Total from machine production below" : `grey fabric · ±${WEIGHT_TOLERANCE_KG}`} error={totalCheck.error} warning={totalCheck.warning}><WeightInput value={totalValue} readOnly={machinesBusy} onValueChange={(v) => set({ total: v })} autoFocus={knitting && !machinesBusy} /></Field>
        {fromStock && (
          <Field label="Yarn used (KG)" required hint={pool ? `${kg(given)} of shared yarn left` : `of ${kg(given)} given`}>
            <WeightInput value={f.yarnUsed} onValueChange={(yarnUsed) => set({ yarnUsed })} />
            <span className={cn("mt-1 block text-[11px] font-semibold", leftover > EMPTY ? "text-sky-700" : "text-gray-500")}>
              {pool && pool.othersOpen > 0
                ? `${kg(leftover)} stays for ${pool.sharedWith.join(", ")}; what none uses goes back when the last finishes`
                : leftover > EMPTY
                  ? `${kg(leftover)} goes back to ${flow.yarnItemCode ?? "the yarn"} in ${flow.yarnWarehouse?.code ?? "the warehouse"}`
                  : "All the yarn given was used"}
            </span>
          </Field>
        )}
        <Field
          label="Rolls"
          required
          hint={machinesBusy ? "Total from machine production below" : own && rollsOnMachines !== null ? `${rollsOnMachines} entered on Machines` : "Grey fabric rolls"}
          warning={!machinesBusy && own && rollsOnMachines !== null && f.rolls.trim() !== "" && Number(f.rolls) !== rollsOnMachines ? `The Machines page has ${rollsOnMachines} rolls; a new day entry there sets it back.` : undefined}
        >
          <Input type="number" min="1" step="1" inputMode="numeric" readOnly={machinesBusy} value={rollsValue} onChange={(e) => set({ rolls: e.target.value })} />
        </Field>
        {showPrices && <ChargeInput label="Knitting charges" value={f.expense} weightKg={total} onChange={(expense) => set({ expense })} />}
        {showPrices && fromStock && <Field label="Yarn price" hint={`₹ / KG · ${money(yarnUsed * numeric(f.yarnRate))}`}><Input type="number" min="0" step="0.01" inputMode="decimal" value={f.yarnRate} onChange={(e) => set({ yarnRate: e.target.value })} /></Field>}
      </div>
      {machinesBusy && (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
          <h3 className="text-sm font-bold text-[#123f35]">Finish the running machines</h3>
          <p className="mb-3 mt-1 text-xs text-gray-600">Enter production from each machine for the finish date. Leave it blank to keep production already recorded for that day. The fabric and rolls above are calculated automatically.</p>
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <Field label="Machine finish shift" required><select className="erp-input" value={stopShift} onChange={(e) => setStopShift(e.target.value as Shift)}><option value="DAY">Day · 9 AM – 9 PM</option><option value="NIGHT">Night · 9 PM – 9 AM</option></select></Field>
            <Field label="Fabric warehouse" required={finishMachines.some((run) => run.edit.outputKg !== "")} hint="Final production is recorded here before sending it on"><select className="erp-input" value={fabricWarehouse} onChange={(e) => setStopWarehouseId(e.target.value)}><option value="">Choose fabric warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
          </div>
          {machineRuns.error && <p role="alert" className="mb-2 text-xs text-rose-700">{machineRuns.error}</p>}
          <div className="grid gap-3">
            {finishMachines.map(({ summary, detail, edit }) => (
              <div key={summary.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="mb-2 text-xs font-bold text-gray-800">{summary.machine.code} · {summary.runNo}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={`Final-day fabric on ${summary.machine.code}`} hint={`KG · ${kg(detail?.outputKg ?? summary.outputKg ?? 0)} recorded so far`}><WeightInput value={edit.outputKg} onValueChange={(outputKg) => changeStop(summary.id, { outputKg })} /></Field>
                  <Field label={`Final-day rolls on ${summary.machine.code}`} hint="Whole number"><Input type="number" min="0" step="1" inputMode="numeric" value={edit.rolls} onChange={(e) => changeStop(summary.id, { rolls: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" className="mt-3" disabled={machineRuns.loading} onClick={() => void machineRuns.reload()}>{machineRuns.loading ? "Loading production…" : "Refresh machine production"}</Button>
        </section>
      )}
      <FieldGroup label="Send the grey fabric to" required>
        <DestinationToggle value={f.destination} next="dyeing" onChange={(destination) => set({ destination, warehouseId: "" })} />
      </FieldGroup>
      {toParty ? (
        <PartyFields value={sale} onChange={(changes) => setSale((current) => ({ ...current, ...changes }))} parties={directory.deliveryParties ?? []} showPrices={showPrices} weightKg={total} />
      ) : toWarehouse ? (
        <Field label="Warehouse" required>
          <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
            <option value="">Select warehouse</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
      ) : (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
          <h3 className="text-sm font-bold text-[#123f35]">Send to dyeing & start</h3>
          <p className="mb-3 mt-1 text-xs text-gray-600">Finish knitting and start the dyeing colours below in one step.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Dyeing mill" required><SearchableSelect placeholder="Search dyeing mill or add new" options={directory.dyeingMills} value={f.nextMill} onChange={(nextMill) => set({ nextMill })} /></Field>
            <Field label="Dyeing start date" required><Input type="date" min={f.finishedDate || undefined} max={localDate()} value={dyeingStartDate} onChange={(e) => set({ nextStartDate: e.target.value })} /></Field>
            <FieldGroup label="Dyeing colours" required hint={`${kg(total)} grey fabric`} className="md:col-span-2"><DyeingLotsInput lines={dyeingLines} onChange={setDyeingLines} available={total} batchCode={flow.flowNo} lotsSoFar={flow.lots.length} /></FieldGroup>
            <Field label="Dyeing instructions" hint="Optional" className="md:col-span-2"><Input maxLength={1000} value={f.nextNotes} onChange={(e) => set({ nextNotes: e.target.value })} /></Field>
          </div>
        </section>
      )}
    </ProcessShell>
  );
}

/**
 * Delivering the finished fabric: what was compacted, delivered and is left, every delivery with its challan (undo a
 * wrong one), and the next delivery to a party (with what they paid) or into a warehouse.
 */
export function DeliveryForm({ flow, saving, run, onFilesChanged, onChallan, parties = [] }: { flow: FabricFlow; saving: boolean; run: RunStage; onFilesChanged: () => void; onChallan: (id: string) => void; parties?: string[] }) {
  const { data: warehouseList = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouses = warehouseList.filter((w) => w.active !== false);
  const left = leftToDeliver(flow) ?? 0;
  const delivered = flow.finalDeliveredKg ?? 0;
  const [f, setF] = useState({ toParty: true, party: "", warehouseId: "", date: localDate(), weight: left > EMPTY ? String(Math.round(left * 1000) / 1000) : "", rolls: "", amount: "", expense: "", notes: "" });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const weight = numeric(f.weight);
  const challanOf = (d: FlowDelivery) => (flow.challans ?? []).find((c) => c.handOff === `DELIVERY:${d.id}`);

  const problem =
    !(weight > 0) ? "Enter the weight delivered." :
    weight > left + EMPTY ? `Only ${kg(left)} is left to deliver.` :
    !f.date ? "Enter the delivery date." :
    f.toParty ? (!f.party.trim() ? "Enter who it goes to." : "") : !f.warehouseId ? "Choose the warehouse." : "";

  const save = () =>
    run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/deliveries`, {
          method: "POST",
          body: JSON.stringify({
            deliveredDate: f.date,
            destination: f.toParty ? "CUSTOMER" : "WAREHOUSE",
            packages: f.rolls.trim() ? Math.floor(numeric(f.rolls)) : undefined,
            partyName: f.toParty ? f.party.trim() : undefined,
            warehouseId: f.toParty ? undefined : f.warehouseId,
            weightKg: Math.round(weight * 1000) / 1000,
            amount: f.toParty ? numeric(f.amount) : undefined,
            expense: numeric(f.expense),
            notes: f.notes.trim() || undefined,
          }),
        }),
      "compacting",
    );

  const undo = async (d: FlowDelivery) => {
    const where = d.destination === "CUSTOMER" ? d.partyName ?? "the party" : `${d.warehouse?.code ?? "the warehouse"} stock`;
    const ok = await confirmDialog({
      title: `Undo delivery of ${kg(d.weightKg)}?`,
      description: d.destination === "CUSTOMER"
        ? `The delivery to ${where} and its ${money(d.amount)} collection are removed and its challan cancelled; the fabric is ready to deliver again.`
        : d.receivedAt
          ? `The fabric comes back out of ${where} and its challan is cancelled. Not possible if it has already been issued from there.`
          : "The warehouse hasn't received it yet, so it is cancelled with its challan and the fabric is ready to deliver again.",
      confirmLabel: "Undo delivery",
      tone: "danger",
    });
    if (ok) await run(() => api<FabricFlow>(`/production/fabric-flows/${flow.id}/deliveries/${d.id}`, { method: "DELETE" }), "compacting");
  };

  return (
    <ProcessShell
      accent="is-delivery"
      flow={flow}
      stage="FINAL"
      onFilesChanged={onFilesChanged}
      locked={flow.officeDeliveryKg === null ? "Complete compacting first; its compacted weight is what is delivered." : left <= EMPTY ? `All of ${flow.flowNo}'s finished fabric has been delivered.` : null}
      facts={[
        ["Finished fabric", flow.officeDeliveryKg !== null ? kg(flow.officeDeliveryKg) : "—"],
        ["Delivered", kg(delivered)],
        ["Left to deliver", kg(left)],
        ["Collected", money(flow.collectedAmount)],
      ]}
      before={
        flow.deliveries.length > 0 && (
          <ul className="pform__list">
            {flow.deliveries.map((d) => {
              const challan = challanOf(d);
              return (
                <li key={d.id}>
                  <span className="pform__list-icon">{d.destination === "CUSTOMER" ? <UserRound size={14} /> : <Building2 size={14} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-800">{d.destination === "CUSTOMER" ? d.partyName ?? "Party" : d.warehouse?.code ?? "Warehouse"} · {kg(d.weightKg)}</span>
                    <span className="block text-[11px] text-gray-500">
                      {shortDate(d.deliveredAt)}
                      {d.destination === "CUSTOMER" ? ` · collected ${money(d.amount)}` : d.receivedAt ? ` · received ${shortDate(d.receivedAt)}` : " · waiting to be received"}
                      {toNumber(d.expense) > 0 ? ` · cost ${money(d.expense)}` : ""}
                    </span>
                  </span>
                  {challan && <button type="button" className="pcard__challan shrink-0" onClick={() => onChallan(challan.id)}><FileText size={12} /> <span className="font-mono">{challan.challanNo}</span></button>}
                  <button type="button" className="pform__icon-btn" disabled={saving} aria-label={`Undo delivery of ${kg(d.weightKg)}`} title="Undo this delivery" onClick={() => void undo(d)}><Trash2 size={14} /></button>
                </li>
              );
            })}
          </ul>
        )
      }
      problem={problem}
      summary={<>Deliver <b>{kg(weight)}</b> to <b>{f.toParty ? f.party.trim() || "the party" : warehouses.find((w) => w.id === f.warehouseId)?.code ?? "the warehouse"}</b> with a delivery challan{weight < left - EMPTY ? ` · ${kg(left - weight)} stays to deliver later` : ""}</>}
      saveLabel={f.toParty ? "Deliver" : "Send to warehouse"}
      saving={saving}
      onSave={() => void save()}
      more={
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Delivery cost" hint="₹ · optional · transport etc."><Input type="number" min="0" step="0.01" inputMode="decimal" value={f.expense} onChange={(e) => set({ expense: e.target.value })} /></Field>
          <Field label="Notes" hint="Optional"><Input maxLength={500} placeholder="Vehicle, invoice…" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      }
    >
      {flow.officeDeliveryKg !== null && left > EMPTY && (
        <>
          <div className="start-dialog__mills" role="radiogroup" aria-label="Deliver to">
            {([
              [true, "To a party", "Sold and sent out; record what they paid", UserRound],
              [false, "To a warehouse", `Received there as ${flow.flowNo} stock`, Building2],
            ] as const).map(([value, title, text, Icon]) => (
              <button key={title} type="button" role="radio" aria-checked={f.toParty === value} className={cn("start-dialog__mill", f.toParty === value && "is-active")} onClick={() => set({ toParty: value })}>
                <Icon size={16} aria-hidden />
                <span><strong>{title}</strong><small>{text}</small></span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {f.toParty ? (
              <Field label="Deliver to" required>
                <Input value={f.party} maxLength={160} list="delivery-parties" autoComplete="off" placeholder="e.g. Sri Textiles" onChange={(e) => set({ party: e.target.value })} />
                <datalist id="delivery-parties">{parties.map((name) => <option key={name} value={name} />)}</datalist>
              </Field>
            ) : (
              <Field label="Warehouse" required>
                <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
                  <option value="">Select warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Weight" required hint={`KG · ${kg(left)} left`}><WeightInput value={f.weight} onValueChange={(v) => set({ weight: v })} /></Field>
            <Field label="Date" required><Input type="date" max={localDate()} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
            <Field label="Rolls" hint="On the delivery challan"><Input type="number" min="0" step="1" inputMode="numeric" value={f.rolls} onChange={(e) => set({ rolls: e.target.value })} /></Field>
            {f.toParty && <Field label="Amount collected" hint="₹ · optional"><Input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>}
          </div>
        </>
      )}
    </ProcessShell>
  );
}
