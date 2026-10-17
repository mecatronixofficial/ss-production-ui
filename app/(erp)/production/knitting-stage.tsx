"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Boxes, Building2, CheckCircle2, Factory, Gauge, Paperclip, Pencil, Play, Truck, UserRound } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { Warehouse } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, gsmText, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Attachments } from "./attachments";
import { DestinationToggle, Fact, Field, FieldGroup, SaveChecklist, SectionHeading } from "./fields";
import { StockPicker, type StockScope } from "./stock-picker";
import { WizardNav, WizardSummary } from "./start-wizard";
import { WeightChange } from "./weight-change";
import { isKnitting, knittingEditable, localDate, numeric, shortDate, warehouseDelivery, weightCheck, WEIGHT_TOLERANCE_KG, type FabricFlow, type FlowDirectory, type StageKey } from "./types";

type YarnStock = { category: string; itemCode: string; itemName: string; lotNo: string | null; warehouseId: string; unit: string; balanceKg: number };
type ItemPurchases = { purchases: Array<{ purchaseOrder: { orderDate: string }; unit: string; rate: number }> };
/** Saves a stage through the page (notice, toast, reload); resolves true when it saved. */
export type RunStage = (action: () => Promise<FabricFlow>, next?: StageKey, manualRecord?: boolean) => Promise<boolean>;

const EMPTY = 0.0005;
const stockKey = (row: YarnStock) => [row.itemCode, row.warehouseId, row.lotNo ?? "", row.category].join("|");

/** Knitting a batch: finish it with bags, weight and documents. A new batch is started with `StartKnitting`. */
export function KnittingStage({
  flow,
  directory,
  saving,
  run,
  onAttachmentsChanged,
  showPrices = true,
  managerMode = false,
}: {
  /** The batch being knitted. */
  flow: FabricFlow;
  directory: FlowDirectory;
  saving: boolean;
  run: RunStage;
  onAttachmentsChanged: () => void;
  showPrices?: boolean;
  managerMode?: boolean;
}) {
  return <KnittingBatch key={flow.id} flow={flow} directory={directory} saving={saving} run={run} onAttachmentsChanged={onAttachmentsChanged} showPrices={showPrices} managerMode={managerMode} />;
}

/** Details shared by starting and correcting knitting. */
function DetailsFields({
  f,
  set,
  directory,
}: {
  f: { startDate: string; expectedFinishDate: string; partyDetails: string; millDetails: string; gg: string; ll: string };
  set: (changes: Partial<typeof f>) => void;
  directory: FlowDirectory;
}) {
  return (
    <>
      <div className="production-field-section">
        <SectionHeading icon={Play} title="Dates" caption="When knitting starts and when it should be done" />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Starting date"><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Expected finish date" hint="Optional"><Input type="date" min={f.startDate} value={f.expectedFinishDate} onChange={(e) => set({ expectedFinishDate: e.target.value })} /></Field>
        </div>
      </div>
      <div className="production-field-section">
        <SectionHeading icon={UserRound} title="Party & mill" caption="Who knits it; search a registered name or add a new one" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Party details" className="md:col-span-2"><SearchableSelect placeholder="Search knitting party or add new" options={directory.dealers} value={f.partyDetails} onChange={(value) => set({ partyDetails: value })} /></Field>
          <Field label="Machine name" className="md:col-span-2"><SearchableSelect placeholder="Select machine or enter its name" options={directory.mills} value={f.millDetails} onChange={(value) => set({ millDetails: value })} /></Field>
          <Field label="Gauge (GG)" hint="Optional"><Input placeholder="e.g. 28G" value={f.gg} onChange={(e) => set({ gg: e.target.value })} /></Field>
          <Field label="Loop length (LL)" hint="Optional"><Input placeholder="e.g. 2.8mm" value={f.ll} onChange={(e) => set({ ll: e.target.value })} /></Field>
        </div>
      </div>
    </>
  );
}

/**
 * Starting a batch from yarn in stock, as the start wizard's steps: 1 the yarn and KG, 2 fabric and mill,
 * 3 check and start. Step 0 (warehouse and process) is the page's; this stays mounted through it so nothing typed is lost.
 */
export function StartKnitting({
  directory,
  saving,
  run,
  stockScope,
  step,
  onStep,
}: {
  directory: FlowDirectory;
  saving: boolean;
  run: RunStage;
  /** The wizard's warehouse and search. */
  stockScope: StockScope;
  step: number;
  onStep: (step: number) => void;
}) {
  const stock = useApiQuery<YarnStock[]>(`/inventory/balances${qs({ category: "YARN" })}`);
  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouseOf = new Map(warehouses.map((w) => [w.id, w]));
  // Yarn that can be knitted: in stock, by KG, in a warehouse that is still active.
  const available = (stock.data ?? [])
    .filter((row) => row.unit === "KG" && row.balanceKg > EMPTY && warehouseOf.get(row.warehouseId)?.active !== false)
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  const [millType, setMillType] = useState<"OWN" | "OTHER">("OWN");
  const [f, setF] = useState({ yarn: "", yarnKg: "", yarnRatePerKg: "", fabricType: "", fabricDiameter: "", fabricGsm: "", startDate: localDate(), expectedFinishDate: "", partyDetails: "Own mill", millDetails: "", gg: "", ll: "" });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const chosen = available.find((row) => stockKey(row) === f.yarn);

  // The price defaults to the yarn's latest purchase rate.
  const purchases = useApiQuery<ItemPurchases>(chosen ? `/inventory/item${qs({ code: chosen.itemCode })}` : null);
  useEffect(() => {
    const latest = purchases.data?.purchases
      .filter((p) => p.unit === "KG")
      .sort((a, b) => b.purchaseOrder.orderDate.localeCompare(a.purchaseOrder.orderDate))[0];
    if (latest) setF((current) => (current.yarnRatePerKg ? current : { ...current, yarnRatePerKg: String(latest.rate) }));
  }, [purchases.data]);

  const yarnKg = numeric(f.yarnKg);
  const tooMuch = !!chosen && yarnKg > chosen.balanceKg + EMPTY;
  const yarnReady = !!chosen && yarnKg > 0 && !tooMuch;
  const detailsReady = !!f.fabricType.trim() && !!f.fabricDiameter.trim() && !!f.startDate && (millType === "OWN" || !!f.millDetails.trim());

  const start = () =>
    chosen &&
    run(
      () =>
        api<FabricFlow>("/production/fabric-flows/start-knitting", {
          method: "POST",
          body: JSON.stringify({
            millType,
            fabricType: f.fabricType.trim(),
            fabricDiameter: f.fabricDiameter.trim(),
            fabricGsm: f.fabricGsm.trim() || undefined,
            yarnItemCode: chosen.itemCode,
            warehouseId: chosen.warehouseId,
            yarnLotNo: chosen.lotNo ?? undefined,
            yarnCategory: chosen.category,
            yarnKg,
            yarnRatePerKg: numeric(f.yarnRatePerKg),
            startDate: f.startDate,
            expectedFinishDate: f.expectedFinishDate || undefined,
            partyDetails: millType === "OWN" ? f.partyDetails : undefined,
            millDetails: millType === "OWN" ? "Pending machine selection" : f.millDetails,
            gg: f.gg || undefined,
            ll: f.ll || undefined,
          }),
        }),
      "knitting",
      millType === "OTHER",
    );

  if (step === 1) {
    return (
      <>
        <StockPicker
          rows={available}
          warehouses={warehouses}
          material="yarn"
          loading={!stock.data}
          selectedKey={f.yarn}
          keyOf={stockKey}
          onSelect={(row) => set({ yarn: row ? stockKey(row) : "", yarnKg: "", yarnRatePerKg: "" })}
          scope={stockScope}
        />
        {chosen && (
          <div className="production-field-section mt-4">
            <SectionHeading icon={Boxes} title={`How much of ${chosen.itemCode}?`} caption={`${kg(chosen.balanceKg)} in ${warehouseOf.get(chosen.warehouseId)?.code ?? "the warehouse"}; the KG used is taken out of it`} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="KG used" hint={`max ${kg(chosen.balanceKg)}`}>
                <span className="flex gap-1.5">
                  <WeightInput wrapperClassName="flex-1" className={cn(tooMuch && "border-red-400")} value={f.yarnKg} onValueChange={(yarnKg) => set({ yarnKg })} aria-invalid={tooMuch} />
                  <Button size="sm" variant="outline" className="h-11 shrink-0" title="Use all of this yarn" onClick={() => set({ yarnKg: String(Math.round(chosen.balanceKg * 1000) / 1000) })}>
                    All
                  </Button>
                </span>
                {tooMuch && <span className="mt-1 block text-[11px] text-red-600">Only {kg(chosen.balanceKg)} in stock</span>}
              </Field>
              <Field label="Price" hint="₹ / KG">
                <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="From purchase" value={f.yarnRatePerKg} onChange={(e) => set({ yarnRatePerKg: e.target.value })} />
              </Field>
            </div>
          </div>
        )}
        <WizardNav
          onBack={() => onStep(0)}
          onNext={() => onStep(2)}
          disabled={!yarnReady}
          hint={!chosen ? "Pick the yarn to knit." : tooMuch ? `Only ${kg(chosen.balanceKg)} of ${chosen.itemCode} in stock.` : yarnKg > 0 ? `${kg(yarnKg)} of ${chosen.itemCode} · ${money(yarnKg * numeric(f.yarnRatePerKg))}` : "Enter the KG used."}
        />
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <div className="space-y-3">
          <div className="production-field-section">
            <SectionHeading icon={Factory} title="Where will it be knitted?" caption="Own-mill work becomes a task; outside-mill work continues to manual recording" />
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Knitting mill type">
              {([
                { value: "OWN" as const, icon: Factory, title: "Own mill", text: "Create a task; choose the machine on the Machines page" },
                { value: "OTHER" as const, icon: Building2, title: "Other mill", text: "Select the mill, send yarn and provide fabric details" },
              ]).map(({ value, icon: Icon, title, text }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={millType === value}
                  className={cn("flex items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300", millType === value ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300")}
                  onClick={() => {
                    setMillType(value);
                    set({ partyDetails: value === "OWN" ? "Own mill" : "", millDetails: "" });
                  }}
                >
                  <span className={cn("rounded-xl p-2", millType === value ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600")}><Icon size={18} /></span>
                  <span><span className="block text-sm font-bold text-gray-900">{title}</span><span className="mt-0.5 block text-xs text-gray-500">{text}</span></span>
                </button>
              ))}
            </div>
          </div>
          <div className="production-field-section">
            <SectionHeading icon={Boxes} title="Fabric to make" caption="Each allocation receives a derived fabric code such as YARN-D1, YARN-D2" />
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Fabric type"><Input placeholder="e.g. Single jersey, Rib, Interlock" value={f.fabricType} onChange={(e) => set({ fabricType: e.target.value })} /></Field>
              <Field label="Diameter"><Input placeholder="e.g. 22 DIA" value={f.fabricDiameter} onChange={(e) => set({ fabricDiameter: e.target.value })} /></Field>
              <Field label="GSM" hint="Optional · grams per m²"><Input inputMode="decimal" maxLength={20} placeholder="e.g. 180" value={f.fabricGsm} onChange={(e) => set({ fabricGsm: e.target.value })} /></Field>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Gauge (GG)" hint="Optional"><Input placeholder="e.g. 28G" value={f.gg} onChange={(e) => set({ gg: e.target.value })} /></Field>
              <Field label="Loop length (LL)" hint="Optional"><Input placeholder="e.g. 2.8mm" value={f.ll} onChange={(e) => set({ ll: e.target.value })} /></Field>
            </div>
            <p className="mt-2 text-xs text-gray-500">The yarn KG is allocated only to this fabric. Start another batch from the same yarn code for another type or diameter.</p>
          </div>
          <div className="production-field-section">
            <SectionHeading icon={Play} title="Dates" caption={millType === "OWN" ? "When knitting starts and when it should be done" : "When yarn is sent and when fabric is expected back"} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={millType === "OWN" ? "Starting date" : "Yarn sent date"}><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
              <Field label={millType === "OWN" ? "Expected finish date" : "Expected fabric date"} hint="Optional"><Input type="date" min={f.startDate} value={f.expectedFinishDate} onChange={(e) => set({ expectedFinishDate: e.target.value })} /></Field>
            </div>
          </div>
          {millType === "OTHER" && (
            <div className="production-field-section">
              <SectionHeading icon={Building2} title="Other mill" caption="Select the mill receiving the yarn; no machine assignment is needed" />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Knitting mill">
                  <SearchableSelect placeholder="Search outside mill or add new" options={directory.knittingMills} value={f.millDetails} onChange={(value) => set({ millDetails: value })} />
                </Field>
              </div>
            </div>
          )}
        </div>
        <WizardNav
          onBack={() => onStep(1)}
          onNext={() => onStep(3)}
          disabled={!detailsReady}
          hint={!f.fabricType.trim() || !f.fabricDiameter.trim() ? "Enter the fabric type and diameter." : !f.startDate ? "Enter the date." : millType === "OTHER" && !f.millDetails.trim() ? "Select the knitting mill." : "Next, check everything before it is saved."}
        />
      </>
    );
  }

  if (step === 3 && chosen) {
    return (
      <>
        <WizardSummary
          groups={[
            {
              title: "Yarn from stock",
              rows: [
                ["Yarn code", <span key="code" className="font-mono">{chosen.itemCode}</span>],
                ["Item", chosen.itemName],
                ["Warehouse", [warehouseOf.get(chosen.warehouseId)?.code, chosen.lotNo && `lot ${chosen.lotNo}`].filter(Boolean).join(" · ")],
                ["KG used", `${kg(yarnKg)} of ${kg(chosen.balanceKg)}`],
              ],
            },
            {
              title: "Fabric to make",
              rows: [
                ["Fabric type", f.fabricType.trim()],
                ["Diameter", f.fabricDiameter.trim()],
                ["GSM", f.fabricGsm.trim() && gsmText(f.fabricGsm.trim())],
                ["GG · LL", [f.gg, f.ll].filter(Boolean).join(" · ")],
              ],
            },
            {
              title: millType === "OWN" ? "Own mill" : "Other mill",
              rows: [
                ["Mill", millType === "OWN" ? "Own mill · machine chosen on the Machines page" : f.millDetails],
                [millType === "OWN" ? "Starts" : "Yarn sent", shortDate(`${f.startDate}T00:00`)],
                ["Expected", f.expectedFinishDate && shortDate(`${f.expectedFinishDate}T00:00`)],
              ],
            },
          ]}
        />
        <div className="production-dock start-wizard__dock mt-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Yarn price</p>
            <p className="mt-1 text-xl font-bold text-amber-900">{money(yarnKg * numeric(f.yarnRatePerKg))}</p>
            <p className="text-[11px] text-amber-700">{kg(yarnKg)} × {money(numeric(f.yarnRatePerKg))} / KG</p>
          </div>
          <p className="max-w-sm text-xs text-amber-800">
            {millType === "OWN" ? "The task will appear in the knitting manager's work list and on the Machines page." : "The batch will be created, then the knitting completion form opens for manual entry."} The batch uses the yarn&apos;s code (repeat batches get -2, -3…).
          </p>
        </div>
        <WizardNav
          onBack={() => onStep(2)}
          onNext={() => void start()}
          disabled={saving || !yarnReady || !detailsReady}
          nextLabel={saving ? "Creating…" : millType === "OWN" ? "Create knitting task" : "Continue to manual record"}
          nextIcon={<Play size={15} />}
          hint="Nothing is saved until you press start."
        />
      </>
    );
  }

  // The yarn picked has gone from stock since (another batch took it): pick again.
  if (step === 3) return <WizardNav onBack={() => onStep(1)} onNext={() => onStep(1)} nextLabel="Pick the yarn again" hint="The yarn picked is no longer in stock." />;
  return null;
}

function KnittingBatch({
  flow,
  directory,
  saving,
  run,
  onAttachmentsChanged,
  showPrices,
  managerMode,
}: {
  flow: FabricFlow;
  directory: FlowDirectory;
  saving: boolean;
  run: RunStage;
  onAttachmentsChanged: () => void;
  showPrices: boolean;
  managerMode: boolean;
}) {
  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active !== false);
  const editable = knittingEditable(flow);
  const knitting = isKnitting(flow);
  const knittedToWarehouse = warehouseDelivery(flow, "KNITTING");
  const receivedInWarehouse = knittedToWarehouse?.receivedAt ? knittedToWarehouse : null;
  const yarnUsed = flow.yarnReceivedKg ?? flow.purchasedWeightKg;
  const overdue = knitting && !!flow.knittingExpectedFinishDate && flow.knittingExpectedFinishDate.slice(0, 10) < localDate();

  const [editingDetails, setEditingDetails] = useState(false);
  const [d, setD] = useState({
    startDate: localDate(flow.knittingDate ?? flow.purchaseDate),
    expectedFinishDate: flow.knittingExpectedFinishDate ? localDate(flow.knittingExpectedFinishDate) : "",
    partyDetails: flow.knittingPartyDetails ?? "",
    millDetails: flow.knittingMillDetails ?? "",
    gg: flow.knittingGg ?? "",
    ll: flow.knittingLl ?? "",
    yarnRatePerKg: String(flow.yarnRatePerKg || ""),
  });
  const [f, setF] = useState({
    finishedDate: localDate(flow.knittingFinishedAt),
    bagCount: flow.knittingBagCount ? String(flow.knittingBagCount) : "",
    totalWeightKg: flow.knittingDeliveryKg !== null ? String(flow.knittingDeliveryKg) : "",
    deliveryPlace: flow.knittingDeliveryPlace ?? "",
    destination: flow.knittingDestination ?? "NEXT_PROCESS",
    warehouseId: flow.knittingDestinationWarehouseId ?? "",
    nextPartyDetails: flow.dyeingPartyDetails ?? "",
    nextMillDetails: flow.dyeingMillDetails ?? "",
    knittingExpense: String(flow.knittingExpense || 0),
    notes: flow.knittingNotes ?? "",
  });
  const setFinish = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));

  const total = numeric(f.totalWeightKg);
  const bags = Math.floor(numeric(f.bagCount));
  const bagWeight = bags > 0 && total > 0 ? total / bags : null;
  const check = weightCheck(yarnUsed, total);
  const tooHeavy = check.kind === "over";
  const toWarehouse = f.destination === "WAREHOUSE";
  const startedOn = localDate(flow.knittingDate ?? flow.purchaseDate);
  const dateError = f.finishedDate && f.finishedDate < startedOn ? "Finished before knitting started" : null;
  const bagsError = f.bagCount !== "" && !/^\d+$/.test(f.bagCount.trim()) ? "Bags are a whole number" : null;
  // What the finish form still needs, so its save bar can say why it can't save yet.
  const finishMissing = [
    !f.finishedDate && "finished date",
    !(bags >= 1) && "bags",
    !(total > 0) && "total weight",
    toWarehouse ? !f.warehouseId && "warehouse" : !f.deliveryPlace.trim() && "delivery reference",
    !toWarehouse && !f.nextPartyDetails.trim() && "dyeing mill",
  ].filter((item): item is string => !!item);
  const finishProblems = [dateError, bagsError, tooHeavy && "the weight is over the limit"].filter((item): item is string => !!item);
  const finishReady = !finishMissing.length && !finishProblems.length;

  const saveDetails = () =>
    run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/knitting`, {
          method: "PATCH",
          body: JSON.stringify({
            startDate: d.startDate,
            expectedFinishDate: d.expectedFinishDate || undefined,
            partyDetails: d.partyDetails,
            millDetails: d.millDetails,
            gg: d.gg || undefined,
            ll: d.ll || undefined,
            yarnRatePerKg: numeric(d.yarnRatePerKg),
          }),
        }),
      "knitting",
    ).then((saved) => saved && setEditingDetails(false));

  const finish = () =>
    run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/knitting/finish`, {
          method: "POST",
          body: JSON.stringify({
            finishedDate: f.finishedDate,
            bagCount: bags,
            totalWeightKg: Math.round(total * 1000) / 1000,
            destination: f.destination,
            warehouseId: f.destination === "WAREHOUSE" ? f.warehouseId : undefined,
            deliveryPlace: f.destination === "WAREHOUSE" ? "Warehouse delivery" : f.deliveryPlace,
            nextPartyDetails: f.destination === "NEXT_PROCESS" ? f.nextPartyDetails : undefined,
            nextMillDetails: f.destination === "NEXT_PROCESS" ? (f.nextMillDetails || f.nextPartyDetails) : undefined,
            knittingExpense: numeric(f.knittingExpense),
            notes: f.notes.trim() || undefined,
          }),
        }),
      knitting && f.destination === "NEXT_PROCESS" ? "dyeing" : "knitting",
    );

  return (
    <div className="space-y-5">
      <div className="production-field-section">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SectionHeading icon={Boxes} title="Yarn & start" caption={knitting ? "Knitting in progress" : "Knitting done"} />
          {editable && !managerMode && !editingDetails && (
            <Button size="sm" variant="outline" onClick={() => setEditingDetails(true)}><Pencil size={13} /> Edit details</Button>
          )}
        </div>
        {editingDetails ? (
          <div className="space-y-3">
            <DetailsFields f={d} set={(changes) => setD((current) => ({ ...current, ...changes }))} directory={directory} />
            <div className="production-field-section">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Yarn price" hint="₹ / KG"><Input type="number" min="0" step="0.01" value={d.yarnRatePerKg} onChange={(e) => setD({ ...d, yarnRatePerKg: e.target.value })} /></Field>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">The yarn and KG taken from stock can&apos;t be changed here.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={saving} onClick={() => setEditingDetails(false)}>Cancel</Button>
              <Button disabled={saving || !d.startDate || !d.partyDetails.trim() || !d.millDetails.trim()} onClick={() => void saveDetails()}>Save details</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Batch code" value={flow.flowNo} />
            <Fact label="Yarn" value={flow.yarnItemCode ? `${flow.yarnItemCode} · ${flow.yarnCount}` : flow.yarnCount} />
            <Fact
              label="Taken from"
              value={flow.yarnItemCode ? `${flow.yarnWarehouse?.code ?? "Warehouse"}${flow.yarnLotNo ? ` · lot ${flow.yarnLotNo}` : ""}` : "Yarn purchase"}
            />
            <Fact label="Yarn used" value={kg(yarnUsed)} />
            <Fact label="Fabric code" value={flow.flowNo} />
            <Fact label="Fabric type" value={flow.fabricType} />
            <Fact label="Diameter" value={flow.fabricDiameter} />
            <Fact label="GSM" value={gsmText(flow.fabricGsm)} />
            {showPrices && <Fact label="Price" value={`${money(flow.yarnRatePerKg)} / KG = ${money(flow.metrics.yarnAmount)}`} />}
            <Fact label="Starting date" value={shortDate(flow.knittingDate ?? flow.purchaseDate)} />
            <Fact label="Expected finish" value={shortDate(flow.knittingExpectedFinishDate)} tone={overdue ? "text-red-600" : undefined} />
            <Fact label="Party · mill" value={[flow.knittingPartyDetails, flow.knittingMillDetails].filter(Boolean).join(" · ")} />
            {(flow.knittingGg || flow.knittingLl) && <Fact label="GG · LL" value={[flow.knittingGg, flow.knittingLl].filter(Boolean).join(" · ")} />}
          </div>
        )}
      </div>

      <div className="production-field-section">
        <SectionHeading icon={Truck} title={knitting ? "Finish knitting" : "Finished"} caption="Bags, total weight and where it was delivered; the total weight goes on to dyeing" />
        {editable ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Finished date" required error={dateError}><Input type="date" min={startedOn} value={f.finishedDate} onChange={(e) => setFinish({ finishedDate: e.target.value })} /></Field>
              <Field label="No. of bags" required error={bagsError}><Input type="number" min="1" step="1" inputMode="numeric" value={f.bagCount} onChange={(e) => setFinish({ bagCount: e.target.value })} /></Field>
              <Field label="Total weight" required hint={`±${WEIGHT_TOLERANCE_KG} of ${kg(yarnUsed)}`} error={check.kind === "over" ? check.message : null} warning={check.kind === "bigLoss" ? check.message : null}>
                <WeightInput className={cn(tooHeavy && "border-red-400")} value={f.totalWeightKg} onValueChange={(totalWeightKg) => setFinish({ totalWeightKg })} aria-invalid={tooHeavy} />
              </Field>
              <Field label="Approx. bag weight" hint="Worked out">
                <Input value={bagWeight ? `≈ ${kg(bagWeight)} per bag` : ""} placeholder="Bags and weight first" disabled />
              </Field>
            </div>
            <FieldGroup label="Deliver to" required>
              <DestinationToggle value={f.destination} next="dyeing" onChange={(destination) => setFinish({ destination, warehouseId: "" })} />
            </FieldGroup>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {toWarehouse ? (
                <Field label="Warehouse" required className="md:col-span-2"><select className="erp-input" value={f.warehouseId} onChange={(e) => setFinish({ warehouseId: e.target.value })}><option value="">Select warehouse</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
              ) : <>
                <Field label="Delivery reference" required><Input placeholder="Challan, vehicle or location" value={f.deliveryPlace} onChange={(e) => setFinish({ deliveryPlace: e.target.value })} /></Field>
                <Field label="Next dyeing mill" required><SearchableSelect placeholder="Select dyeing mill" options={directory.dyeingMills} value={f.nextPartyDetails} onChange={(value) => setFinish({ nextPartyDetails: value, nextMillDetails: value })} /></Field>
              </>}
              {showPrices && <Field label="Knitting charges" hint="₹"><Input type="number" min="0" step="0.01" inputMode="decimal" value={f.knittingExpense} onChange={(e) => setFinish({ knittingExpense: e.target.value })} /></Field>}
            </div>
            <Field label="Notes" hint="Optional">
              <textarea className="erp-input min-h-[4.5rem] py-2" maxLength={1000} placeholder="Anything worth remembering about this batch" value={f.notes} onChange={(e) => setFinish({ notes: e.target.value })} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Finished date" value={shortDate(flow.knittingFinishedAt)} />
            <Fact label="No. of bags" value={flow.knittingBagCount} />
            <Fact label="Total weight" value={flow.knittingDeliveryKg !== null ? kg(flow.knittingDeliveryKg) : null} />
            <Fact label="Approx. bag weight" value={flow.knittingBagCount && flow.knittingDeliveryKg ? `≈ ${kg(flow.knittingDeliveryKg / flow.knittingBagCount)}` : null} />
            <Fact label="Delivery place" value={flow.knittingDeliveryPlace} />
            {showPrices && <Fact label="Knitting charges" value={money(flow.knittingExpense)} />}
            <Fact label="Notes" value={flow.knittingNotes} />
          </div>
        )}
      </div>

      {editable && (
        <div className="production-dock">
          <div className="production-estimate grid gap-3 sm:grid-cols-3">
            <div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Yarn used</p><p className="mt-1 text-base font-bold text-gray-800">{kg(yarnUsed)}</p></div>
            <WeightChange input={yarnUsed} output={total} label="Knitting" />
            {showPrices && <div><p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Charges</p><p className="mt-1 text-base font-bold text-amber-800">{money(numeric(f.knittingExpense))}</p></div>}
          </div>
          <div className="production-dock__save">
            <SaveChecklist total={toWarehouse ? 4 : 5} missing={finishMissing} problems={finishProblems} />
            <Button disabled={saving || !finishReady} onClick={() => void finish()}>
              {saving ? "Saving…" : knitting ? <>{toWarehouse ? "Complete knitting & send to warehouse" : "Complete knitting & send to dyeing"} <ArrowRight size={15} /></> : <><CheckCircle2 size={15} /> Save changes</>}
            </Button>
          </div>
        </div>
      )}
      {!editable && !knitting && (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Gauge size={13} /> {receivedInWarehouse ? `${receivedInWarehouse.warehouse?.code ?? "The warehouse"} has received this fabric` : "Dyeing has received this fabric"}, so knitting can no longer be changed.
        </p>
      )}

      <div className="production-field-section">
        <SectionHeading icon={Paperclip} title="Documents & photos" caption="Delivery challan, bills, photos of the bags" />
        <Attachments flowId={flow.id} stage="KNITTING" attachments={flow.attachments} onChanged={onAttachmentsChanged} />
      </div>
    </div>
  );
}
