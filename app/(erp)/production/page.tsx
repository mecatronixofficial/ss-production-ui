"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Droplets,
  Factory,
  Hash,
  Layers,
  ListOrdered,
  Palette,
  Paperclip,
  PenLine,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Truck,
  UserRound,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { api, qs } from "@/lib/api";
import type { Warehouse } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { toast } from "@/lib/toast-store";
import { cn, gsmText, kg, money, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import type { BadgeTone } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { useAuth } from "@/components/auth-provider";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CardHead, DestinationToggle, Field, FieldGroup, Pill, SaveChecklist, SectionHeading } from "./fields";
import { BatchProcesses, BatchTotals } from "./batch-summary";
import { DeliveryStage } from "./delivery-stage";
import { InProgressNote, StartProcess } from "./process-start";
import { KnittingStage, StartKnitting, type RunStage } from "./knitting-stage";
import { WizardNav, WizardSteps, WizardSummary } from "./start-wizard";
import { Attachments } from "./attachments";
import { ExpenseLedger } from "./expense-ledger";
import { completedInWarehouse, isCompacting, isDyeing, isKnitting, leftToDeliver, localDate, numeric, sentToWarehouse, shortDate, warehouseDelivery, weightCheck, WEIGHT_TOLERANCE_KG, type AttachmentStage, type FabricFlow, type FlowDirectory, type StageKey } from "./types";
import { plural, StockPicker, type StockScope } from "./stock-picker";
import { WeightChange } from "./weight-change";
import { itemHref } from "../warehouses/item-details";
import "./production.css";

type FlowResponse = { data: FabricFlow[] };
type ProcessStart = "knitting" | "dyeing" | "compacting";
type StartStock = { category: string; itemCode: string; itemName: string; warehouseId: string; unit: string; balanceKg: number };

const stages = [
  { key: "knitting" as const, label: "Knitting", icon: Factory },
  { key: "dyeing" as const, label: "Dyeing", icon: Droplets },
  { key: "compacting" as const, label: "Compacting", icon: Sparkles },
] as const;

const processName: Record<StageKey, string> = { knitting: "Knitting", dyeing: "Dyeing", compacting: "Compacting" };
/** The process a batch that ended in a warehouse after knitting / dyeing can be started on next. */
const nextAfter = { knitting: "dyeing", dyeing: "compacting" } as const;
/** A process has started and isn't completed yet: its fabric is at that party now. */
const processRunning = (flow: FabricFlow) => isKnitting(flow) || isDyeing(flow) || isCompacting(flow);

/** The journey step (0 yarn, 1 knitting, 2 dyeing…) a batch that ended in a warehouse finished on. */
const endedStep = (flow: FabricFlow) => {
  const ended = completedInWarehouse(flow);
  return ended ? (ended.stage === "knitting" ? 1 : 2) : null;
};

/** Where a batch is now: a short label for the list, a sentence for its details, and the stage that moves it on. */
const whereIs = (flow: FabricFlow): { label: string; tone: BadgeTone; place: string; next: StageKey | null; action: string } => {
  if (flow.status === "PURCHASED") return { label: "Yarn in hand", tone: "default", place: "Yarn in hand — knitting not started", next: "knitting", action: "Open knitting" };
  if (isKnitting(flow)) {
    const due = flow.knittingExpectedFinishDate ? ` · due ${shortDate(flow.knittingExpectedFinishDate)}` : "";
    const place = flow.knittingMillType === "OTHER"
      ? `Other mill · ${flow.knittingPartyDetails ?? flow.knittingMillDetails ?? "manual record"}`
      : `Own mill · ${flow.knittingMillDetails ?? "machine task"}`;
    return { label: flow.knittingMillType === "OTHER" ? "Other mill" : "Knitting task", tone: "warning", place: `${place}${due}`, next: "knitting", action: flow.knittingMillType === "OTHER" ? "Enter knitting record" : "Finish knitting" };
  }
  const ended = completedInWarehouse(flow);
  if (ended) {
    const { delivery } = ended;
    const fabric = ended.stage === "knitting" ? "grey fabric" : "dyed fabric";
    return {
      label: "Completed · in warehouse",
      tone: "success",
      place: `${processName[ended.stage]} completed · ${kg(delivery.receivedWeightKg ?? delivery.weightKg)} ${fabric} received in ${delivery.warehouse?.code ?? "the warehouse"} on ${shortDate(delivery.receivedAt)}`,
      // The fabric in the warehouse can still go on to the next process.
      next: nextAfter[ended.stage],
      action: `Start ${nextAfter[ended.stage]}`,
    };
  }
  const sent = sentToWarehouse(flow);
  if (sent) {
    return {
      label: "Sent to warehouse",
      tone: "warning",
      place: `${processName[sent.stage]} done · waiting for ${sent.delivery.warehouse?.code ?? "the warehouse"} to receive it; it can still be corrected`,
      next: sent.stage,
      action: `Edit ${sent.stage}`,
    };
  }
  if (flow.knittingFinishedAt && flow.dyeingDeliveryKg === null) return { label: "Grey fabric in warehouse", tone: "default", place: flow.knittingDeliveryPlace ?? "Knitting completed · waiting in warehouse", next: null, action: "" };
  if (flow.status === "KNITTING") {
    return isDyeing(flow)
      ? { label: "Dyeing", tone: "warning", place: `Dyeing at ${flow.dyeingPartyDetails ?? flow.dyeingMillDetails ?? "the dyeing party"} · since ${shortDate(flow.dyeingDate)}`, next: "dyeing", action: "Complete dyeing" }
      : { label: "At dyeing", tone: "info", place: "Knitted — grey fabric is ready for dyeing, not started yet", next: "dyeing", action: "Start dyeing" };
  }
  if (flow.dyeingOutputWeightKg !== null && flow.compactingDeliveryKg === null) return { label: "Dyed fabric in warehouse", tone: "default", place: flow.compactingMillDetails ?? "Dyeing completed · waiting in warehouse", next: null, action: "" };
  if (flow.status === "DYEING" || flow.status === "COMPACTING") {
    return isCompacting(flow)
      ? { label: "Compacting", tone: "warning", place: `Compacting at ${flow.compactingPartyDetails ?? flow.compactingMillDetails ?? "the compacting party"} · since ${shortDate(flow.compactingDate)}`, next: "compacting", action: "Complete compacting" }
      : { label: "At compacting", tone: "info", place: "Dyed — fabric is ready for compacting, not started yet", next: "compacting", action: "Start compacting" };
  }
  if (flow.status === "AT_OFFICE") {
    const left = leftToDeliver(flow) ?? 0;
    return (flow.finalDeliveredKg ?? 0) > 0
      ? { label: "Partly delivered", tone: "info", place: `Partly delivered — ${kg(left)} still to deliver`, next: "compacting", action: "Deliver the rest" }
      : { label: "Ready to deliver", tone: "info", place: "Compacted — finished fabric ready to deliver", next: "compacting", action: "Deliver" };
  }
  return { label: "Delivered", tone: "success", place: "Delivered — all processes complete", next: null, action: "" };
};

/** How far through the processes a batch is: 0 knitting, 1 dyeing, 2 compacting, 3 delivering, 4 all delivered (or ended in a warehouse). */
const progressOf = (flow: FabricFlow) => {
  if (flow.status === "PURCHASED" || isKnitting(flow)) return 0;
  const sent = sentToWarehouse(flow);
  if (sent) return sent.stage === "knitting" ? 0 : 1;
  if (completedInWarehouse(flow)) return 4;
  if (flow.status === "KNITTING") return 1;
  if (flow.status === "DYEING" || flow.status === "COMPACTING") return 2;
  if (flow.status === "AT_OFFICE") return 3;
  return 4;
};
const progressAccent = ["is-knitting", "is-dyeing", "is-compacting", "is-delivery", "is-complete"];

type Filter = "all" | "processing" | "knitting" | "dyeing" | "compacting" | "delivering" | "completed";
type ListOrder = "date" | "code" | "process";
const progressFilter: Filter[] = ["knitting", "dyeing", "compacting", "delivering", "completed"];
const filters: Array<{ key: Filter; label: string; icon: LucideIcon; accent: string }> = [
  { key: "all", label: "All batches", icon: Layers, accent: "is-all" },
  { key: "processing", label: "Processing", icon: RefreshCw, accent: "is-processing" },
  { key: "knitting", label: "Knitting", icon: Factory, accent: "is-knitting" },
  { key: "dyeing", label: "At dyeing", icon: Droplets, accent: "is-dyeing" },
  { key: "compacting", label: "At compacting", icon: Sparkles, accent: "is-compacting" },
  { key: "delivering", label: "To deliver", icon: Truck, accent: "is-delivery" },
  { key: "completed", label: "Completed", icon: CheckCircle2, accent: "is-complete" },
];
/** Whether a batch belongs under a filter: "processing" is every batch not yet completed (delivered or ended in a warehouse). */
const inFilter = (flow: FabricFlow, filter: Filter) =>
  filter === "all" || (filter === "processing" ? progressOf(flow) < 4 : progressFilter[progressOf(flow)] === filter);

/** Where the batch's yarn came from, by item code (older batches started from a purchase entry). */
const yarnSource = (flow: FabricFlow) =>
  flow.yarnItemCode ? `Yarn ${flow.yarnItemCode}${flow.yarnWarehouse ? ` · ${flow.yarnWarehouse.code}` : ""}` : "Yarn purchase";

/** The weight a process sent into a warehouse, if it went there. */
const warehouseWeight = (flow: FabricFlow, stage: "KNITTING" | "DYEING") => {
  const delivery = warehouseDelivery(flow, stage);
  return delivery ? toNumber(delivery.weightKg) : null;
};

/** One line per process for a batch's journey: when it happened, who did it and the weight that came out. */
const processSteps = (flow: FabricFlow) => [
  { key: "yarn", label: flow.yarnItemCode ? "Yarn from stock" : "Yarn purchase", date: flow.purchaseDate, who: yarnSource(flow), weight: flow.purchasedWeightKg },
  { key: "knitting", label: "Knitting", date: flow.knittingFinishedAt ?? flow.knittingDate, who: flow.knittingPartyDetails, weight: flow.dyeingDeliveryKg ?? warehouseWeight(flow, "KNITTING") },
  { key: "dyeing", label: "Dyeing", date: flow.dyeingFinishedAt ?? flow.dyeingDate, who: [flow.dyeingPartyDetails, flow.color].filter(Boolean).join(" · ") || null, weight: flow.compactingDeliveryKg ?? warehouseWeight(flow, "DYEING") },
  { key: "compacting", label: "Compacting", date: flow.compactingFinishedAt ?? flow.compactingDate, who: flow.compactingPartyDetails ?? (flow.compactingOutwardNo && `Outward ${flow.compactingOutwardNo}`), weight: flow.officeDeliveryKg },
  { key: "final", label: "Delivery", date: flow.finalDate, who: deliverySummary(flow), weight: flow.finalDeliveredKg },
];
const journeyStyle: Array<{ icon: LucideIcon; accent: string; opens: StageKey }> = [
  { icon: Boxes, accent: "is-yarn", opens: "knitting" },
  { icon: Factory, accent: "is-knitting", opens: "knitting" },
  { icon: Droplets, accent: "is-dyeing", opens: "dyeing" },
  { icon: Sparkles, accent: "is-compacting", opens: "compacting" },
  { icon: Truck, accent: "is-delivery", opens: "compacting" },
];

/** "2 parties · WH-FG" — where the finished fabric went. */
function deliverySummary(flow: FabricFlow) {
  const parties = new Set(flow.deliveries.filter((d) => d.destination === "CUSTOMER").map((d) => d.partyName));
  const warehouses = [...new Set(flow.deliveries.filter((d) => d.destination === "WAREHOUSE").map((d) => d.warehouse?.code))];
  const parts = [
    parties.size === 1 ? [...parties][0] : parties.size > 1 ? `${parties.size} parties` : null,
    warehouses.length ? warehouses.join(", ") : null,
  ].filter(Boolean);
  return parts.join(" · ") || (flow.collectedAmount ? `Collected ${money(flow.collectedAmount)}` : null);
}

/** Everything that happened to a batch, oldest first: its record, followed by its code. */
function batchRecord(flow: FabricFlow) {
  const events: Array<{ date: string; title: string; detail: string; weight: number | null }> = [];
  const add = (date: string | null, title: string, detail: (string | null | false | undefined)[], weight: number | null = null) => {
    if (date) events.push({ date, title, detail: detail.filter(Boolean).join(" · "), weight });
  };
  add(
    flow.purchaseDate,
    flow.yarnItemCode ? `Yarn ${flow.yarnItemCode} taken from stock` : "Yarn purchased",
    [flow.yarnCount, flow.yarnWarehouse?.code, flow.yarnLotNo && `lot ${flow.yarnLotNo}`, flow.yarnRatePerKg > 0 && `${money(flow.yarnRatePerKg)}/KG`],
    flow.purchasedWeightKg,
  );
  if (flow.knittingDate && flow.knittingDate !== flow.knittingFinishedAt) {
    add(flow.knittingDate, "Knitting started", [flow.knittingPartyDetails, flow.knittingMillDetails, flow.knittingExpectedFinishDate && `due ${shortDate(flow.knittingExpectedFinishDate)}`]);
  }
  add(
    flow.knittingFinishedAt ?? (flow.dyeingDeliveryKg !== null ? flow.knittingDate : null),
    "Knitting finished",
    [!!flow.knittingBagCount && `${flow.knittingBagCount} bags`, flow.knittingDeliveryPlace && `to ${flow.knittingDeliveryPlace}`, flow.knittingExpense > 0 && `charges ${money(flow.knittingExpense)}`],
    flow.dyeingDeliveryKg,
  );
  // Dyeing and compacting are started, then completed; batches recorded in one go have only the completion.
  const dyed = flow.dyeingOutputWeightKg !== null;
  if (flow.dyeingDate && (!dyed || (flow.dyeingFinishedAt && flow.dyeingFinishedAt !== flow.dyeingDate))) {
    add(flow.dyeingDate, "Dyeing started", [flow.dyeingPartyDetails, flow.dyeingMillDetails], flow.fabricReceivedKg);
  }
  if (dyed) add(flow.dyeingFinishedAt ?? flow.dyeingDate, "Dyed", [flow.dyeingPartyDetails, flow.dyeingMillDetails, flow.color, !!flow.rollCount && `${flow.rollCount} rolls`], flow.compactingDeliveryKg ?? flow.dyeingOutputWeightKg);
  const compacted = flow.officeDeliveryKg !== null;
  if (flow.compactingDate && (!compacted || (flow.compactingFinishedAt && flow.compactingFinishedAt !== flow.compactingDate))) {
    add(flow.compactingDate, "Compacting started", [flow.compactingPartyDetails, flow.compactingMillDetails, flow.compactingInwardNo && `in ${flow.compactingInwardNo}`], flow.compactingReceivedKg);
  }
  if (compacted) {
    add(
      flow.compactingFinishedAt ?? flow.compactingDate,
      "Compacted",
      [flow.compactingPartyDetails, flow.compactingMillDetails, flow.compactingInwardNo && `in ${flow.compactingInwardNo}`, flow.compactingOutwardNo && `out ${flow.compactingOutwardNo}`],
      flow.officeDeliveryKg,
    );
  }
  for (const d of flow.processDeliveries) {
    if (d.destination !== "WAREHOUSE" || d.processStage === "FINAL") continue;
    const warehouse = d.warehouse?.code ?? "warehouse";
    const fabric = d.processStage === "KNITTING" ? "Grey fabric" : "Dyed fabric";
    add(d.deliveredAt, `${fabric} sent to ${warehouse}`, [!d.receivedAt && "waiting to be received", d.notes], toNumber(d.weightKg));
    if (d.receivedAt) add(d.receivedAt, `${fabric} received into ${warehouse} as ${flow.flowNo}`, [`${d.processStage === "KNITTING" ? "Knitting" : "Dyeing"} completed`], toNumber(d.receivedWeightKg ?? d.weightKg));
  }
  for (const d of flow.deliveries) {
    const warehouse = d.warehouse?.code ?? "warehouse";
    add(
      d.deliveredAt,
      d.destination === "CUSTOMER" ? `Delivered to ${d.partyName ?? "a party"}` : `Sent to ${warehouse}`,
      [toNumber(d.amount) > 0 && `collected ${money(d.amount)}`, d.destination === "WAREHOUSE" && !d.receivedAt && "waiting to be received", d.notes],
      toNumber(d.weightKg),
    );
    if (d.destination === "WAREHOUSE" && d.receivedAt) {
      add(d.receivedAt, `Received into ${warehouse} as ${flow.flowNo}`, ["Finished fabric stock"], toNumber(d.receivedWeightKg ?? d.weightKg));
    }
  }
  if (flow.deliveries.length === 0 && flow.finalDeliveredKg) add(flow.finalDate, "Delivered", [flow.collectedAmount > 0 && `collected ${money(flow.collectedAmount)}`], flow.finalDeliveredKg);
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export default function ProductionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Production />
    </Suspense>
  );
}

/**
 * The front shows every batch by code with only its yarn used and the process it is at. Opening a code
 * (`?batch=SS-2026-003`) shows its full details and stage forms; `?new=1` starts knitting a new batch.
 */
function Production() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // `?code=` is kept from older links.
  const batchParam = params.get("batch") ?? params.get("code") ?? "";
  const starting = params.get("new") === "1";
  const recordParam = params.get("record");

  const [flows, setFlows] = useState<FabricFlow[] | null>(null);
  const [directory, setDirectory] = useState<FlowDirectory>({ dealers: [], mills: [], knittingMills: [], dyeingMills: [], compactingMills: [], yarnStocks: [], fabricStocks: [] });
  const [loadingError, setLoadingError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setLoadingError("");
    try {
      const [response, flowDirectory] = await Promise.all([
        api<FlowResponse>("/production/fabric-flows"),
        api<FlowDirectory>("/production/fabric-flows/directory"),
      ]);
      setFlows(response.data);
      setDirectory(flowDirectory);
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : "Production batches could not be loaded");
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const go = (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString();
    router.push(search ? `${pathname}?${search}` : pathname, { scroll: true });
  };

  if (!flows) {
    if (loadingError) {
      return (
        <div className="production-page mx-auto max-w-xl pt-12">
          <div className="production-empty">
            <span className="production-empty__icon text-rose-600"><AlertTriangle size={24} /></span>
            <p className="text-lg font-bold text-gray-900">Production batches unavailable</p>
            <p className="text-sm text-gray-500">{loadingError}</p>
            <Button className="mt-4" onClick={() => void load(true)}><RefreshCw size={15} /> Retry</Button>
          </div>
        </div>
      );
    }
    return <Loading />;
  }

  if (starting && isAdmin) {
    return (
      <StartView
        directory={directory}
        flows={flows}
        onBack={() => go({})}
        onStarted={async (flow, manualRecord) => {
          await load();
          go(manualRecord ? { batch: flow.flowNo, record: "knitting" } : { batch: flow.flowNo });
        }}
        onOpenStock={async (stock, process) => {
          const flow = await api<FabricFlow>("/production/fabric-flows/start-stock-process", { method: "POST", body: JSON.stringify({ process, itemCode: stock.itemCode, warehouseId: stock.warehouseId, quantityKg: stock.balanceKg }) });
          await load();
          go({ batch: flow.flowNo, record: process });
        }}
      />
    );
  }

  if (batchParam) {
    const flow = flows.find((f) => f.flowNo.toUpperCase() === batchParam.trim().toUpperCase());
    if (!flow) {
      return (
        <div className="production-page mx-auto max-w-xl pt-12">
          <div className="production-empty">
            <span className="production-empty__icon"><Search size={24} /></span>
            <p className="text-lg font-bold text-gray-900">No batch with code {batchParam.toUpperCase()}</p>
            <p className="text-sm text-gray-500">Check the code on the bag, or pick it from the list.</p>
            <Button variant="outline" className="mt-4" onClick={() => go({})}><ArrowLeft size={15} /> All batches</Button>
          </div>
        </div>
      );
    }
    if (!isAdmin && flow.status !== "KNITTING") {
      return <ListView flows={flows.filter((item) => item.status === "KNITTING")} refreshing={refreshing} onRefresh={() => void load(true)} onOpen={(item) => go({ batch: item.flowNo })} onStart={() => undefined} managerMode />;
    }
    return <BatchView key={flow.id} flow={flow} directory={directory} reload={load} onBack={() => go({})} managerMode={!isAdmin} startInStage={recordParam === "knitting" || recordParam === "dyeing" || recordParam === "compacting" ? recordParam : undefined} />;
  }

  return <ListView flows={isAdmin ? flows : flows.filter((flow) => flow.status === "KNITTING")} refreshing={refreshing} onRefresh={() => void load(true)} onOpen={(flow) => go({ batch: flow.flowNo })} onStart={() => go({ new: "1" })} managerMode={!isAdmin} />;
}

/** A figure on the dark hero. */
function Glass({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: string }) {
  return (
    <div className="production-glass">
      <p className="production-glass__label">{label}</p>
      <p className={cn("production-glass__value", tone)}>{value}</p>
      {note && <p className="production-glass__note">{note}</p>}
    </div>
  );
}

/** The front: every batch by code, with only the yarn it used and the process it is at. */
function ListView({
  flows,
  refreshing,
  onRefresh,
  onOpen,
  onStart,
  managerMode = false,
}: {
  flows: FabricFlow[];
  refreshing: boolean;
  onRefresh: () => void;
  onOpen: (flow: FabricFlow) => void;
  onStart: () => void;
  managerMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [listOrder, setListOrder] = useState<ListOrder>("date");
  const q = search.trim().toUpperCase();
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: flows.length, processing: 0, knitting: 0, dyeing: 0, compacting: 0, delivering: 0, completed: 0 };
    for (const flow of flows) {
      result[progressFilter[progressOf(flow)]]++;
      if (progressOf(flow) < 4) result.processing++;
    }
    return result;
  }, [flows]);
  const visible = useMemo(() => {
    const filtered = flows.filter(
        (f) =>
          inFilter(f, filter) &&
          (!q || f.flowNo.toUpperCase().includes(q) || f.yarnItemCode?.toUpperCase().includes(q)),
      );
    return filtered.sort((a, b) => {
      if (listOrder === "code") return a.flowNo.localeCompare(b.flowNo, undefined, { numeric: true });
      if (listOrder === "process") return progressOf(a) - progressOf(b) || a.flowNo.localeCompare(b.flowNo, undefined, { numeric: true });
      return b.purchaseDate.localeCompare(a.purchaseDate) || b.flowNo.localeCompare(a.flowNo, undefined, { numeric: true });
    });
  }, [flows, filter, q, listOrder]);
  const active = flows.filter((f) => progressOf(f) < 4);
  const shownFilter = filters.find((f) => f.key === filter)!;

  return (
    <div className="production-page space-y-5 pb-10">
      <header className="production-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="production-eyebrow">{managerMode ? "Assigned knitting work" : "Yarn · Knitting · Dyeing · Compacting · Delivery"}</p>
            <h1 className="production-hero__title">{managerMode ? "Knitting tasks" : "Production"}</h1>
            <p className="mt-1 max-w-xl text-sm text-white/65">{managerMode ? "Open a task to see its machine, yarn code and required weight, then complete it with the finished weight." : "Every batch keeps its item code from the yarn to the last delivery. Open a code to see everything that happened to it."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="production-ghost" disabled={refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> Refresh</Button>
            {!managerMode && <Button className="production-cta" onClick={onStart}><Play size={15} /> Start</Button>}
          </div>
        </div>
        <div className="production-hero__stats">
          <Glass label="Batches" value={flows.length} note={`${active.length} in progress`} />
          <Glass label="Yarn in process" value={kg(sum(active.map((f) => f.purchasedWeightKg)))} note="Batches still processing" />
          {!managerMode && <Glass label="Ready to deliver" value={kg(sum(flows.map((f) => leftToDeliver(f) ?? 0)))} note="Compacted, not yet delivered" />}
          {!managerMode && <Glass label="Delivered" value={kg(sum(flows.map((f) => f.finalDeliveredKg ?? 0)))} note="To parties and warehouses" />}
        </div>
      </header>

      {!managerMode && <nav className="production-pipeline" aria-label="Show batches by process">
        {filters.map(({ key, label, icon: Icon, accent }) => (
          <button key={key} type="button" aria-pressed={filter === key} className={cn("production-filter", accent)} onClick={() => setFilter(key)}>
            <span className="production-filter__icon"><Icon size={17} /></span>
            <span className="min-w-0">
              <span className="production-filter__count">{counts[key]}</span>
              <span className="production-filter__label">{label}</span>
            </span>
          </button>
        ))}
      </nav>}

      <div className="production-list-tools">
        <form
          className="production-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (visible.length === 1) onOpen(visible[0]);
          }}
        >
          <Search size={17} aria-hidden />
          <Input placeholder="Find a code, e.g. SS-2026-003" aria-label="Find a batch code" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" spellCheck={false} />
        </form>
        <div className="production-order" role="group" aria-label="Arrange production batches">
          <button type="button" aria-pressed={listOrder === "date"} onClick={() => setListOrder("date")}><CalendarDays size={15} /> Date-wise</button>
          <button type="button" aria-pressed={listOrder === "code"} onClick={() => setListOrder("code")}><Hash size={15} /> Code-wise</button>
          <button type="button" aria-pressed={listOrder === "process"} onClick={() => setListOrder("process")}><ListOrdered size={15} /> Process order</button>
        </div>
        <p className="text-sm text-gray-500">
          {visible.length} {visible.length === 1 ? "batch" : "batches"}{filter !== "all" && <> · {shownFilter.label}</>}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="production-empty">
          <span className="production-empty__icon">{flows.length ? <Search size={24} /> : <Factory size={24} />}</span>
          <p className="text-base font-bold text-gray-900">{!flows.length ? "No batches yet" : q ? `No batch matches ${q}` : `No batches ${shownFilter.label.toLowerCase()}`}</p>
          <p className="text-sm text-gray-500">{flows.length ? "Check the material code, or show all batches." : "Start a process with yarn or fabric from a warehouse."}</p>
          {flows.length ? (
            <Button variant="outline" className="mt-3" onClick={() => { setSearch(""); setFilter("all"); }}>Show all batches</Button>
          ) : !managerMode ? (
            <Button className="mt-3" onClick={onStart}><Play size={15} /> Start</Button>
          ) : null}
        </div>
      ) : (
        <div className="production-ledger">
          <div className="production-ledger__head" aria-hidden>
            <span>Date</span><span>Batch / yarn code</span><span>Yarn used</span><span>Current process</span><span>Progress</span><span />
          </div>
          {visible.map((flow) => <BatchRow key={flow.id} flow={flow} onOpen={() => onOpen(flow)} />)}
        </div>
      )}
    </div>
  );
}

const railSteps = ["Knit", "Dye", "Compact", "Deliver"];

/** A compact ledger row: easier to scan than cards and still shows the full process position. */
function BatchRow({ flow, onOpen }: { flow: FabricFlow; onOpen: () => void }) {
  const where = whereIs(flow);
  const step = progressOf(flow);
  // A batch that ended in a warehouse went only as far as that process; later rail steps stay empty.
  const ended = endedStep(flow);
  const railDone = ended ?? step;
  const railNow = ended === null ? step : -1;
  return (
    <button type="button" className={cn("production-ledger__row", progressAccent[step])} onClick={onOpen} aria-label={`${flow.flowNo}: ${kg(flow.purchasedWeightKg)} yarn used, ${where.label}`}>
      <span className="production-ledger__date"><small>Started</small>{shortDate(flow.purchaseDate)}</span>
      <span className="production-ledger__identity">
        <strong>{flow.flowNo}</strong>
        <small>{flow.yarnItemCode ? `Yarn ${flow.yarnItemCode}` : flow.yarnCount}</small>
      </span>
      <span className="production-ledger__weight"><small>Yarn used</small>{kg(flow.purchasedWeightKg)}</span>
      <span className="production-ledger__status"><Pill tone={where.tone} live={processRunning(flow)}>{where.label}</Pill><small>{where.place}</small></span>
      <span className="production-ledger__progress" aria-hidden>
        <span className="production-rail">{railSteps.map((s, i) => <span key={s} className={cn(i < railDone && "is-done", i === railNow && "is-now")} />)}</span>
        <span className="production-rail-labels">{railSteps.map((s, i) => <span key={s} className={cn(i < railDone && "is-done", i === railNow && "is-now")}>{s}</span>)}</span>
      </span>
      <span className="production-ledger__open">Open <ArrowRight size={14} /></span>
    </button>
  );
}

const startProcesses = [
  { key: "knitting" as const, label: "Knitting", material: "yarn", icon: Factory, text: "Knit yarn into grey fabric" },
  { key: "dyeing" as const, label: "Dyeing", material: "grey fabric", icon: Droplets, text: "Dye grey fabric from stock" },
  { key: "compacting" as const, label: "Compacting", material: "dyed fabric", icon: Sparkles, text: "Compact dyed fabric from stock" },
];

/**
 * Starting a new batch, one step at a time: the warehouse and process, the stock to use, (knitting only) the
 * fabric and mill, then a read-back to check before anything is saved.
 */
function StartView({ directory, flows, onBack, onStarted, onOpenStock }: { directory: FlowDirectory; flows: FabricFlow[]; onBack: () => void; onStarted: (flow: FabricFlow, manualRecord: boolean) => Promise<void>; onOpenStock: (stock: StartStock, process: "dyeing" | "compacting") => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [process, setProcess] = useState<ProcessStart>("knitting");
  const [step, setStep] = useState(0);
  const [stockCode, setStockCode] = useState("");
  // One warehouse and search for every process: switching process keeps the warehouse, and each process shows what it has there.
  const [scopeWarehouseId, setScopeWarehouseId] = useState("");
  const [scopeSearch, setScopeSearch] = useState("");
  const stockScope: StockScope = { warehouseId: scopeWarehouseId, search: scopeSearch, setWarehouseId: setScopeWarehouseId };
  const yarnQuery = useApiQuery<StartStock[]>(`/inventory/balances${qs({ category: "YARN" })}`);
  const greyQuery = useApiQuery<StartStock[]>(`/inventory/balances${qs({ category: "GREY_FABRIC" })}`);
  const dyedQuery = useApiQuery<StartStock[]>(`/inventory/balances${qs({ category: "DYED_FABRIC" })}`);
  const { data: startWarehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const activeStartWarehouses = startWarehouses.filter((warehouse) => warehouse.active !== false);
  const startWarehouseById = new Map(startWarehouses.map((warehouse) => [warehouse.id, warehouse]));
  const processKey = (row: StartStock) => `${row.itemCode}|${row.warehouseId}`;
  const flowByCode = new Map(flows.map((flow) => [flow.flowNo, flow]));
  const usable = (row: StartStock) => row.unit === "KG" && row.balanceKg > 0.0005 && startWarehouseById.get(row.warehouseId)?.active !== false;
  const stockFor: Record<ProcessStart, StartStock[]> = {
    knitting: (yarnQuery.data ?? []).filter(usable),
    dyeing: (greyQuery.data ?? []).filter((row) => {
      const flow = flowByCode.get(row.itemCode);
      return usable(row) && !!flow && flow.knittingFinishedAt !== null && !flow.dyeingIssueTxnId;
    }),
    compacting: (dyedQuery.data ?? []).filter((row) => {
      const flow = flowByCode.get(row.itemCode);
      return usable(row) && !!flow && flow.dyeingOutputWeightKg !== null && !flow.compactingIssueTxnId;
    }),
  };
  const stockLoaded: Record<ProcessStart, boolean> = { knitting: !!yarnQuery.data, dyeing: !!greyQuery.data, compacting: !!dyedQuery.data };
  /** What a process could start with in the chosen warehouse (or all of them). */
  const inScope = (key: ProcessStart) => stockFor[key].filter((row) => !scopeWarehouseId || row.warehouseId === scopeWarehouseId);
  const availableProcessStock = process === "knitting" ? [] : stockFor[process];
  const selectedProcessStock = availableProcessStock.find((row) => processKey(row) === stockCode);
  const scopeWarehouse = startWarehouseById.get(scopeWarehouseId);
  const where = scopeWarehouse ? scopeWarehouse.code : "all warehouses";
  const chosenProcess = startProcesses.find((item) => item.key === process)!;
  const material = chosenProcess.material;
  const steps = process === "knitting" ? ["Warehouse & process", "Yarn", "Fabric & mill", "Confirm"] : ["Warehouse & process", material[0].toUpperCase() + material.slice(1), "Confirm"];
  const lastStep = steps.length - 1;
  const head =
    step === 0
      ? { title: "Where from, and which process?", caption: "The warehouse counts for every process; each one shows the stock it can start with there." }
      : step === lastStep
        ? { title: "Check and start", caption: "Everything chosen so far. Go back to change anything; nothing is saved until you start." }
        : step === 1
          ? { title: `Pick the ${material}`, caption: process === "knitting" ? `Yarn in ${where}; the KG used is taken out of that warehouse.` : `${material[0].toUpperCase() + material.slice(1)} in ${where}; the whole stock of the code goes to ${process}.` }
          : { title: "Fabric and mill", caption: "What to make from the yarn, where it is knitted and when." };

  const go = (next: number) => {
    setError("");
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const run: RunStage = async (action, _next, manualRecord = false) => {
    setSaving(true);
    setError("");
    try {
      const flow = await action();
      toast.success(
        manualRecord
          ? `Batch ${flow.flowNo} created. Enter the other mill's knitting record now.`
          : `Knitting task ${flow.flowNo} created: ${kg(flow.purchasedWeightKg)} of ${flow.yarnItemCode ?? "yarn"} assigned from stock.`,
        manualRecord ? "Ready for manual record" : "Task created",
      );
      await onStarted(flow, manualRecord);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start knitting");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const startStock = async () => {
    if (!selectedProcessStock || process === "knitting") return;
    setSaving(true);
    setError("");
    try {
      await onOpenStock(selectedProcessStock, process);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not start ${process}`);
      setSaving(false);
    }
  };
  const ProcessIcon = chosenProcess.icon;
  const shownCount = inScope(process);

  return (
    <div className={cn("production-page start-wizard pb-10", `is-${process}`)}>
      <aside className="start-wizard__side">
        <button type="button" className="start-wizard__back" onClick={onBack}><ArrowLeft size={14} /> All batches</button>
        <p className="start-wizard__eyebrow">New batch</p>
        <h1 className="start-wizard__title">Start production</h1>
        <WizardSteps steps={steps} current={step} onJump={go} />
        <div className="start-wizard__picked" aria-label="Chosen so far">
          <button type="button" disabled={step === 0} onClick={() => go(0)} title="Change the warehouse">
            <WarehouseIcon size={16} aria-hidden />
            <span><small>Warehouse</small>{scopeWarehouse ? `${scopeWarehouse.code} · ${scopeWarehouse.name}` : "All warehouses"}</span>
          </button>
          <button type="button" disabled={step === 0} onClick={() => go(0)} title="Change the process">
            <ProcessIcon size={16} aria-hidden />
            <span><small>Process</small>{chosenProcess.label}</span>
          </button>
        </div>
      </aside>

      <div className="start-wizard__main">
        {error && <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle size={17} />{error}</div>}

        <section className="start-wizard__panel">
          <div className="start-wizard__head">
            <div className="min-w-0">
              <p className="start-wizard__count">Step {step + 1} of {steps.length}</p>
              <h2>{head.title}</h2>
              <p>{head.caption}</p>
            </div>
            {step === 1 && (
              <label className="start-wizard__search">
                <span className="sr-only">Search {material} code</span>
                <span className="stock-pick__control">
                  <Search size={15} className="text-gray-400" aria-hidden />
                  <Input value={scopeSearch} placeholder={`Search ${material} code`} autoComplete="off" spellCheck={false} onChange={(e) => setScopeSearch(e.target.value)} />
                </span>
              </label>
            )}
          </div>

          <div className="start-wizard__body">
            {step === 0 && (
              <>
                <Field label="Warehouse" hint={`${activeStartWarehouses.length} active`} className="max-w-xl">
                  <span className="stock-pick__control">
                    <WarehouseIcon size={15} className="text-gray-400" aria-hidden />
                    <select className="erp-input" value={scopeWarehouseId} onChange={(e) => { setScopeWarehouseId(e.target.value); setStockCode(""); }}>
                      <option value="">All warehouses</option>
                      {activeStartWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
                    </select>
                  </span>
                </Field>
                <p className="mb-2 mt-6 text-[10px] font-extrabold uppercase tracking-[.12em] text-gray-500">Process</p>
                <div className="start-wizard__processes" role="radiogroup" aria-label="Process to start">
                  {startProcesses.map(({ key, label, material: stockMaterial, icon: Icon, text }) => {
                    const rows = inScope(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={process === key}
                        className={cn("start-wizard__process", `is-${key}`)}
                        onClick={() => {
                          if (key === process) return;
                          setProcess(key);
                          setStockCode("");
                          setScopeSearch("");
                        }}
                      >
                        <span className="start-wizard__process-icon"><Icon size={20} /></span>
                        <span className="block text-base font-extrabold text-gray-900">{label}</span>
                        <span className="block text-xs text-gray-500">{text}</span>
                        <span className={cn("start-wizard__stock", rows.length > 0 && "has-stock")}>
                          {!stockLoaded[key]
                            ? "Loading stock…"
                            : rows.length
                              ? `${plural(new Set(rows.map((row) => row.itemCode)).size, "code")} · ${kg(rows.reduce((total, row) => total + row.balanceKg, 0))}`
                              : `No ${stockMaterial} in ${where}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <WizardNav
                  onNext={() => go(1)}
                  disabled={stockLoaded[process] && !shownCount.length}
                  hint={!stockLoaded[process] ? "Loading stock…" : shownCount.length ? `${chosenProcess.label} from ${where}.` : `No ${material} in ${where}: choose another warehouse or process.`}
                />
              </>
            )}

            {process === "knitting" ? (
              <StartKnitting directory={directory} saving={saving} run={run} stockScope={stockScope} step={step} onStep={go} />
            ) : step === 1 ? (
              <>
                <StockPicker
                  rows={availableProcessStock}
                  warehouses={startWarehouses}
                  material={material}
                  loading={!stockLoaded[process]}
                  selectedKey={stockCode}
                  keyOf={processKey}
                  onSelect={(row) => setStockCode(row ? processKey(row) : "")}
                  scope={stockScope}
                />
                <WizardNav
                  onBack={() => go(0)}
                  onNext={() => go(2)}
                  disabled={!selectedProcessStock}
                  hint={selectedProcessStock ? `${selectedProcessStock.itemCode} · ${kg(selectedProcessStock.balanceKg)} goes to ${process}.` : `Pick the ${material} to start ${process} with.`}
                />
              </>
            ) : step === 2 && selectedProcessStock ? (
              <>
                <WizardSummary
                  groups={[
                    {
                      title: `${material[0].toUpperCase() + material.slice(1)} from stock`,
                      rows: [
                        ["Code", <span key="code" className="font-mono">{selectedProcessStock.itemCode}</span>],
                        ["Item", selectedProcessStock.itemName],
                        ["Warehouse", startWarehouseById.get(selectedProcessStock.warehouseId)?.code],
                        ["KG", `${kg(selectedProcessStock.balanceKg)} · the whole stock`],
                      ],
                    },
                    {
                      title: chosenProcess.label,
                      rows: [
                        ["Batch", flowByCode.get(selectedProcessStock.itemCode)?.flowNo],
                        ["After start", `The ${process} form opens to record party, mill and weights`],
                      ],
                    },
                  ]}
                />
                <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Weight may go up or down by up to {WEIGHT_TOLERANCE_KG} KG in each process. Notes, documents and photos can be kept with every process.</p>
                <WizardNav onBack={() => go(1)} onNext={() => void startStock()} disabled={saving} nextLabel={saving ? "Starting…" : `Start ${process}`} nextIcon={<Play size={15} />} hint="Nothing is saved until you press start." />
              </>
            ) : step === 2 ? (
              <WizardNav onBack={() => go(1)} onNext={() => go(1)} nextLabel={`Pick the ${material} again`} hint={`The ${material} picked is no longer in stock.`} />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Everything about one batch: its journey, process forms, documents, weights and production costs. */
function BatchView({ flow, directory, reload, onBack, managerMode = false, startInStage }: { flow: FabricFlow; directory: FlowDirectory; reload: () => Promise<void>; onBack: () => void; managerMode?: boolean; startInStage?: StageKey }) {
  const where = whereIs(flow);
  const ended = completedInWarehouse(flow);
  const shownStages = managerMode ? stages.filter((stage) => stage.key === "knitting") : stages;
  const [activeStage, setActiveStage] = useState<StageKey>(managerMode ? "knitting" : startInStage ?? where.next ?? "compacting");
  // After a batch ended in a warehouse, the processes after that one haven't started; the next can be started from that stock.
  const startable = ended ? nextAfter[ended.stage] : null;
  const notStarted = !!ended && stages.findIndex((stage) => stage.key === activeStage) > stages.findIndex((stage) => stage.key === ended.stage);
  /** "details": every process and the totals, read-only; "record": the forms to record or correct a process. */
  const [view, setView] = useState<"details" | "record">(managerMode || startInStage ? "record" : "details");
  const openStage = (stage: StageKey) => {
    setActiveStage(stage);
    setView("record");
  };
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active !== false);
  const [dyeing, setDyeing] = useState({ dyeingDate: localDate(), finishedDate: localDate(), dyeingPartyDetails: "", dyeingMillDetails: "", fabricReceivedKg: "", dyeingGreyWeightKg: "", color: "", dyeingCount: "", rollCount: "", dyeingOutputWeightKg: "", dyeingExpense: "0", compactingDeliveryKg: "", destination: "NEXT_PROCESS" as "NEXT_PROCESS" | "WAREHOUSE", warehouseId: "", nextPartyDetails: "", nextMillDetails: "", dyeingNotes: "" });
  const [compacting, setCompacting] = useState({ compactingDate: localDate(), finishedDate: localDate(), compactingPartyDetails: "", compactingMillDetails: "", compactingInwardNo: "", compactingReceivedKg: "", compactingOutwardNo: "", officeDeliveryKg: "", compactingExpense: "0", compactingNotes: "" });

  useEffect(() => {
    setDyeing({
      dyeingDate: localDate(flow.dyeingDate),
      finishedDate: localDate(flow.dyeingFinishedAt),
      dyeingPartyDetails: flow.dyeingPartyDetails || "",
      // Each process has its own party and mill; nothing is carried over from knitting.
      dyeingMillDetails: flow.dyeingMillDetails || "",
      fabricReceivedKg: String(flow.fabricReceivedKg ?? flow.dyeingDeliveryKg ?? ""),
      dyeingGreyWeightKg: String(flow.dyeingGreyWeightKg ?? ""),
      color: flow.color || "",
      dyeingCount: flow.dyeingCount || flow.yarnCount,
      rollCount: String(flow.rollCount ?? ""),
      dyeingOutputWeightKg: String(flow.dyeingOutputWeightKg ?? ""),
      dyeingExpense: String(flow.dyeingExpense || 0),
      dyeingNotes: flow.dyeingNotes || "",
      compactingDeliveryKg: String(flow.compactingDeliveryKg ?? ""),
      destination: flow.dyeingDestination ?? "NEXT_PROCESS",
      warehouseId: flow.dyeingDestinationWarehouseId ?? "",
      nextPartyDetails: flow.compactingPartyDetails || "",
      nextMillDetails: flow.compactingMillDetails || "",
    });
    setCompacting({ compactingDate: localDate(flow.compactingDate), finishedDate: localDate(flow.compactingFinishedAt), compactingPartyDetails: flow.compactingPartyDetails || "", compactingMillDetails: flow.compactingMillDetails || "", compactingInwardNo: flow.compactingInwardNo || "", compactingReceivedKg: String(flow.compactingReceivedKg ?? flow.compactingDeliveryKg ?? ""), compactingOutwardNo: flow.compactingOutwardNo || "", officeDeliveryKg: String(flow.officeDeliveryKg ?? ""), compactingExpense: String(flow.compactingExpense || 0), compactingNotes: flow.compactingNotes || "" });
    // Only when the batch itself was saved: attaching a file or adding an expense reloads it too, and must not
    // wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.id, flow.updatedAt]);

  /** Saves a stage, reloads the batch and moves to the next stage. Resolves true when saved. */
  const run: RunStage = async (action, next) => {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await action();
      const text = `${saved.flowNo} saved. Weight and production cost were recalculated.`;
      setNotice({ tone: "success", text });
      toast.success(text, "Stage saved");
      if (next) setActiveStage(next);
      await reload();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not save this stage" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const stageDone: Record<StageKey, boolean> = { knitting: flow.knittingFinishedAt !== null, dyeing: flow.dyeingOutputWeightKg !== null, compacting: flow.officeDeliveryKg !== null };
  const stageOpen: Record<StageKey, boolean> = { knitting: true, dyeing: flow.dyeingDeliveryKg !== null, compacting: flow.compactingDeliveryKg !== null };
  // Each process is started (party, mill, fabric received), then completed when its fabric comes back.
  const inProgress: Record<StageKey, boolean> = { knitting: isKnitting(flow), dyeing: isDyeing(flow), compacting: isCompacting(flow) };
  const sent = sentToWarehouse(flow);
  const stageState = (key: StageKey) =>
    ended?.stage === key
      ? "Done · in warehouse"
      : startable === key
        ? "Ready to start"
        : sent?.stage === key
        ? "Sent · not received"
        : stageDone[key] ? (key === "compacting" && flow.status === "AT_OFFICE" ? "Done · deliver" : "Done") : stageOpen[key] ? (inProgress[key] ? "In progress" : key === "knitting" ? "Now" : "Ready to start") : "Waiting";
  // Dyeing / compacting that has fabric waiting for it but hasn't been started shows the start form first.
  const awaitingStart: Record<StageKey, boolean> = { knitting: false, dyeing: stageOpen.dyeing && flow.dyeingDate === null, compacting: stageOpen.compacting && flow.compactingDate === null };
  // Dyeing that a warehouse has received can't be changed any more (knitting locks itself the same way).
  const dyeingLocked = !!warehouseDelivery(flow, "DYEING")?.receivedAt;
  const stageReady = stageOpen[activeStage] && !(activeStage === "dyeing" && dyeingLocked);

  // Each weight against the step before it: up to WEIGHT_TOLERANCE_KG more is fine, more is refused.
  const dyeReceived = weightFeedback(flow.dyeingDeliveryKg, dyeing.fabricReceivedKg);
  const dyeOutput = weightFeedback(numeric(dyeing.fabricReceivedKg), dyeing.dyeingOutputWeightKg);
  const dyeSent = weightFeedback(numeric(dyeing.dyeingOutputWeightKg), dyeing.compactingDeliveryKg);
  const compactReceived = weightFeedback(flow.compactingDeliveryKg, compacting.compactingReceivedKg);
  const compactSent = weightFeedback(numeric(compacting.compactingReceivedKg), compacting.officeDeliveryKg);
  const dyeingOver = dyeReceived.over || dyeOutput.over || dyeSent.over;
  const compactingOver = compactReceived.over || compactSent.over;
  const kgHint = `KG · ±${WEIGHT_TOLERANCE_KG}`;
  const toWarehouse = dyeing.destination === "WAREHOUSE";

  // What each form still needs, so its save bar can say why it can't save yet.
  const dyeDateError = dyeing.dyeingDate && dyeing.finishedDate && dyeing.finishedDate < dyeing.dyeingDate ? "Completed before it started" : null;
  const rollsError = dyeing.rollCount !== "" && !/^\d+$/.test(dyeing.rollCount.trim()) ? "Rolls are a whole number" : null;
  const dyeingMissing = [
    !dyeing.dyeingDate && "start date",
    !dyeing.finishedDate && "completed date",
    !dyeing.fabricReceivedKg && "fabric received",
    !dyeing.dyeingGreyWeightKg && "grey fabric weight",
    !dyeing.dyeingPartyDetails.trim() && "dyeing mill",
    !dyeing.color.trim() && "colour",
    !dyeing.dyeingCount.trim() && "count",
    !dyeing.rollCount && "rolls",
    !dyeing.dyeingOutputWeightKg && "dyeing output",
    !dyeing.compactingDeliveryKg && (toWarehouse ? "weight sent" : "weight to compacting"),
    toWarehouse ? !dyeing.warehouseId && "warehouse" : !dyeing.nextPartyDetails.trim() && "compacting mill",
  ].filter((item): item is string => !!item);
  const dyeingProblems = [dyeDateError, rollsError, dyeingOver && "a weight is over the limit"].filter((item): item is string => !!item);
  const compactDateError = compacting.compactingDate && compacting.finishedDate && compacting.finishedDate < compacting.compactingDate ? "Completed before it started" : null;
  const compactingMissing = [
    !compacting.compactingDate && "start date",
    !compacting.finishedDate && "completed date",
    !compacting.compactingInwardNo.trim() && "inward number",
    !compacting.compactingReceivedKg && "received weight",
    !compacting.compactingOutwardNo.trim() && "outward number",
    !compacting.officeDeliveryKg && "compacted weight",
    !compacting.compactingPartyDetails.trim() && "compacting mill",
  ].filter((item): item is string => !!item);
  const compactingProblems = [compactDateError, compactingOver && "a weight is over the limit"].filter((item): item is string => !!item);

  const weightVariance = flow.metrics.currentWeightKg - flow.purchasedWeightKg;

  return (
    <div className="production-page space-y-5 pb-10">
      <header className="production-hero">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="production-back" onClick={onBack}><ArrowLeft size={14} /> All batches</button>
          <Pill tone={where.tone} live={processRunning(flow)}>{where.label}</Pill>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="production-eyebrow">{yarnSource(flow)} · {flow.yarnCount}{flow.fabricType ? ` · ${flow.fabricType}` : ""}{flow.fabricDiameter ? ` · ${flow.fabricDiameter}` : ""}{flow.fabricGsm ? ` · ${gsmText(flow.fabricGsm)}` : ""}</p>
            <h1 className="production-hero__code">{flow.flowNo}</h1>
            {flow.yarnItemCode && <Link href={itemHref(flow.yarnItemCode)} className="mt-1 inline-block text-xs font-semibold text-emerald-200 underline underline-offset-2 hover:text-white">Yarn code {flow.yarnItemCode} · view full details</Link>}
            <p className="mt-1.5 text-sm text-white/70">{where.place}</p>
          </div>
          {where.next && (!managerMode || where.next === "knitting") && (
            <Button className="production-cta" onClick={() => openStage(where.next!)}>{where.action} <ArrowRight size={15} /></Button>
          )}
        </div>
        <div className="production-hero__stats">
          <Glass label="Yarn used" value={kg(flow.purchasedWeightKg)} note={managerMode ? (flow.yarnItemCode ?? undefined) : `${money(flow.yarnRatePerKg)} / KG`} />
          <Glass label="Weight now" value={kg(flow.metrics.currentWeightKg)} note={`Delivered ${kg(flow.finalDeliveredKg ?? 0)}`} />
          <Glass
            label="Weight variance"
            value={`${weightVariance > 0 ? "+" : weightVariance < 0 ? "−" : ""}${kg(Math.abs(weightVariance))}`}
            note="Yarn input compared with current weight"
          />
          {!managerMode && <Glass label="Production cost" value={money(flow.metrics.totalSpent)} note="Yarn, processes and other expenses" />}
        </div>
        {!managerMode && <div className="production-segment" role="tablist" aria-label="View">
          {([
            ["details", "Details", ClipboardList],
            ["record", "Record process", PenLine],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>}
      </header>

      {!managerMode && <BatchJourney flow={flow} onOpen={openStage} />}

      {notice && <div className={cn("flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm", notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>{notice.tone === "success" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}{notice.text}</div>}

      {view === "details" && (
        <div className="production-layout">
          <BatchProcesses flow={flow} />
          <aside className="space-y-5">
            <BatchTotals flow={flow} />
            <ExpenseLedger flow={flow} reload={reload} />
            <section className="production-card">
              <CardHead eyebrow="Record" title={`Everything that happened to ${flow.flowNo}`} />
              <div className="production-card__body">
                <ol className="production-record">
                  {batchRecord(flow).map((event, index) => (
                    <li key={`${event.date}-${index}`}>
                      <span className="production-record__date">{shortDate(event.date)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-800">{event.title}</span>
                        {event.detail && <span className="block truncate text-xs text-gray-500" title={event.detail}>{event.detail}</span>}
                      </span>
                      {event.weight !== null && <span className="shrink-0 text-sm font-bold text-gray-800">{kg(event.weight)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </aside>
        </div>
      )}

      {view === "record" && (
        <div className="production-layout">
          <div className="min-w-0 space-y-4">
          <nav className="production-switcher" role="tablist" aria-label="Process">
            {shownStages.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <button
                  key={stage.key}
                  type="button"
                  role="tab"
                  aria-selected={activeStage === stage.key}
                  onClick={() => setActiveStage(stage.key)}
                  className={cn("production-switch", `is-${stage.key}`, stageDone[stage.key] && "is-done", !stageDone[stage.key] && stageOpen[stage.key] && "is-now")}
                >
                  <span className="production-switch__num" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                  <span className="production-switch__icon">{stageDone[stage.key] ? <Check size={18} strokeWidth={3} /> : <Icon size={18} />}</span>
                  <span className="min-w-0">
                    <span className="production-switch__label">{stage.label}</span>
                    <span className="production-switch__state">{stageState(stage.key)}</span>
                  </span>
                </button>
              );
            })}
          </nav>
          <section id="production-workspace" className={cn("production-card production-form scroll-mt-20", `is-${activeStage}`)}>
            {!managerMode && <StageBanner flow={flow} stage={activeStage} state={stageState(activeStage)} />}
            <div className="production-card__body">
              {!notStarted && !stageOpen[activeStage] && <div className="mb-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><div><p className="font-bold">Previous process is not finished</p><p className="mt-1 text-xs">Record the earlier process and its delivered weight first.</p></div></div>}
              {!notStarted && (activeStage === "knitting" || activeStage === "dyeing") && <WarehouseNotice flow={flow} stage={activeStage} />}
              {notStarted && ended && startable && (activeStage === startable
                ? <StartFromWarehouse flow={flow} process={startable} saving={saving} run={run} />
                : <div className="flex gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"><Building2 className="mt-0.5 shrink-0 text-gray-400" size={17} /><div><p className="font-bold">Not started</p><p className="mt-1 text-xs">The batch&apos;s {ended.stage === "knitting" ? "grey" : "dyed"} fabric is in {ended.delivery.warehouse?.code ?? "the warehouse"}. Start {startable} first; {processName[activeStage].toLowerCase()} follows it.</p></div></div>)}

              {activeStage === "knitting" && <KnittingStage flow={flow} directory={directory} saving={saving} run={run} onAttachmentsChanged={() => void reload()} showPrices={!managerMode} managerMode={managerMode} />}

              {activeStage === "dyeing" && !notStarted && awaitingStart.dyeing && <StartProcess key={`dyeing-${flow.id}`} flow={flow} process="dyeing" directory={directory} saving={saving} run={run} />}
              {activeStage === "dyeing" && !notStarted && !awaitingStart.dyeing && <div className="space-y-5">
                {isDyeing(flow) && <InProgressNote flow={flow} process="dyeing" />}
                <fieldset disabled={dyeingLocked} className="min-w-0">
                  <div className="production-field-section">
                    <SectionHeading icon={Hash} title={isDyeing(flow) ? `Complete dyeing ${flow.flowNo}` : `Dyeing ${flow.flowNo}`} caption="When it started and was completed, and the fabric taken in; the batch is tracked by its code" />
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="Started on" required><Input type="date" value={dyeing.dyeingDate} onChange={(e) => setDyeing({ ...dyeing, dyeingDate: e.target.value })} /></Field>
                      <Field label="Completed on" required error={dyeDateError}><Input type="date" min={dyeing.dyeingDate} value={dyeing.finishedDate} onChange={(e) => setDyeing({ ...dyeing, finishedDate: e.target.value })} /></Field>
                      <Field label="Fabric received" required hint={flow.dyeingDeliveryKg !== null ? `Sent ${kg(flow.dyeingDeliveryKg)} · ±${WEIGHT_TOLERANCE_KG}` : kgHint} error={dyeReceived.error} warning={dyeReceived.warning}><WeightInput value={dyeing.fabricReceivedKg} onValueChange={(fabricReceivedKg) => setDyeing({ ...dyeing, fabricReceivedKg })} /></Field>
                      <Field label="Grey fabric weight" required hint="As weighed at the mill"><WeightInput value={dyeing.dyeingGreyWeightKg} onValueChange={(dyeingGreyWeightKg) => setDyeing({ ...dyeing, dyeingGreyWeightKg })} /></Field>
                    </div>
                  </div>
                  <div className="production-field-section">
                    <SectionHeading icon={UserRound} title="Party & mill" caption="Who dyes it; search a registered name or add a new one" />
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="Dyeing mill" required className="md:col-span-2"><SearchableSelect placeholder="Select dyeing mill" options={directory.dyeingMills} value={dyeing.dyeingPartyDetails} onChange={(value) => setDyeing({ ...dyeing, dyeingPartyDetails: value, dyeingMillDetails: value })} /></Field>
                    </div>
                  </div>
                  <div className="production-field-section">
                    <SectionHeading icon={Palette} title="Fabric specs" caption="Colour, count and rolls" />
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="Colour" required><Input placeholder="Fabric colour" maxLength={80} value={dyeing.color} onChange={(e) => setDyeing({ ...dyeing, color: e.target.value })} /></Field>
                      <Field label="Count" required><Input placeholder="e.g. 30s combed" value={dyeing.dyeingCount} onChange={(e) => setDyeing({ ...dyeing, dyeingCount: e.target.value })} /></Field>
                      <Field label="Number of rolls" required error={rollsError}><Input type="number" min="0" step="1" inputMode="numeric" value={dyeing.rollCount} onChange={(e) => setDyeing({ ...dyeing, rollCount: e.target.value })} /></Field>
                      <Field label="Dyeing output" required hint={kgHint} error={dyeOutput.error} warning={dyeOutput.warning}><WeightInput value={dyeing.dyeingOutputWeightKg} onValueChange={(dyeingOutputWeightKg) => setDyeing({ ...dyeing, dyeingOutputWeightKg })} /></Field>
                    </div>
                  </div>
                  <div className="production-field-section">
                    <SectionHeading icon={Banknote} title="Cost & delivery" caption={toWarehouse ? "What dyeing cost and the dyed fabric sent into a warehouse" : "What dyeing cost and the weight sent on to compacting"} />
                    <FieldGroup label="Deliver to" required>
                      <DestinationToggle value={dyeing.destination} next="compacting" onChange={(destination) => setDyeing({ ...dyeing, destination, warehouseId: "" })} />
                    </FieldGroup>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={toWarehouse ? "Sent to warehouse" : "Delivered to compacting"} required hint={kgHint} error={dyeSent.error} warning={dyeSent.warning}><WeightInput value={dyeing.compactingDeliveryKg} onValueChange={(compactingDeliveryKg) => setDyeing({ ...dyeing, compactingDeliveryKg })} /></Field>
                      {toWarehouse ? <Field label="Warehouse" required><select className="erp-input" value={dyeing.warehouseId} onChange={(e) => setDyeing({ ...dyeing, warehouseId: e.target.value })}><option value="">Select warehouse</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
                        : <Field label="Next compacting mill" required><SearchableSelect placeholder="Select compacting mill" options={directory.compactingMills} value={dyeing.nextPartyDetails} onChange={(value) => setDyeing({ ...dyeing, nextPartyDetails: value, nextMillDetails: value })} /></Field>}
                      <Field label="Dyeing expense" hint="₹"><Input type="number" min="0" step="0.01" inputMode="decimal" value={dyeing.dyeingExpense} onChange={(e) => setDyeing({ ...dyeing, dyeingExpense: e.target.value })} /></Field>
                    </div>
                  </div>
                  <ProcessNotes
                    flow={flow}
                    stage="DYEING"
                    notes={dyeing.dyeingNotes}
                    onNotes={(dyeingNotes) => setDyeing({ ...dyeing, dyeingNotes })}
                    onFilesChanged={() => void reload()}
                  />
                </fieldset>
                {!dyeingLocked && <div className="production-dock">
                <StageEstimate input={numeric(dyeing.fabricReceivedKg)} output={numeric(dyeing.compactingDeliveryKg)} expense={numeric(dyeing.dyeingExpense)} label="Dyeing" />
                <div className="production-dock__save">
                  <SaveChecklist total={11} missing={dyeingMissing} problems={dyeingProblems} />
                  <Button disabled={saving || !stageReady || dyeingMissing.length > 0 || dyeingProblems.length > 0} onClick={() => void run(() => api<FabricFlow>(`/production/fabric-flows/${flow.id}/dyeing`, { method: "POST", body: JSON.stringify({ ...dyeing, dyeingPartyDetails: dyeing.dyeingPartyDetails.trim(), dyeingMillDetails: (dyeing.dyeingMillDetails || dyeing.dyeingPartyDetails).trim(), color: dyeing.color.trim(), dyeingCount: dyeing.dyeingCount.trim(), dyeingNotes: dyeing.dyeingNotes.trim() || undefined, warehouseId: toWarehouse ? dyeing.warehouseId : undefined, nextPartyDetails: toWarehouse ? undefined : dyeing.nextPartyDetails.trim(), nextMillDetails: toWarehouse ? undefined : (dyeing.nextMillDetails || dyeing.nextPartyDetails).trim(), fabricReceivedKg: numeric(dyeing.fabricReceivedKg), dyeingGreyWeightKg: numeric(dyeing.dyeingGreyWeightKg), rollCount: Math.floor(numeric(dyeing.rollCount)), dyeingOutputWeightKg: numeric(dyeing.dyeingOutputWeightKg), dyeingExpense: numeric(dyeing.dyeingExpense), compactingDeliveryKg: numeric(dyeing.compactingDeliveryKg) }) }), toWarehouse ? "dyeing" : "compacting")}>{saving ? "Saving…" : flow.dyeingOutputWeightKg === null ? (toWarehouse ? "Complete dyeing & send to warehouse" : "Complete dyeing & send to compacting") : "Save changes"} <ArrowRight size={15} /></Button>
                </div>
                </div>}
                {dyeingLocked && <p className="flex items-center gap-2 text-xs text-gray-500"><CheckCircle2 size={13} /> The warehouse has received this dyed fabric, so dyeing can no longer be changed.</p>}
              </div>}

              {activeStage === "compacting" && !notStarted && awaitingStart.compacting && <StartProcess key={`compacting-${flow.id}`} flow={flow} process="compacting" directory={directory} saving={saving} run={run} />}
              {activeStage === "compacting" && !notStarted && !awaitingStart.compacting && <div className="space-y-5">
                {isCompacting(flow) && <InProgressNote flow={flow} process="compacting" />}
                <div>
                  <div className="production-field-section">
                    <SectionHeading icon={Sparkles} title={isCompacting(flow) ? `Complete compacting ${flow.flowNo}` : "Compacting details"} caption="When it started and was completed, inward receipt and outward delivery" />
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="Started on" required><Input type="date" value={compacting.compactingDate} onChange={(e) => setCompacting({ ...compacting, compactingDate: e.target.value })} /></Field>
                      <Field label="Completed on" required error={compactDateError}><Input type="date" min={compacting.compactingDate} value={compacting.finishedDate} onChange={(e) => setCompacting({ ...compacting, finishedDate: e.target.value })} /></Field>
                      <Field label="Compacting expense" hint="₹"><Input type="number" min="0" step="0.01" inputMode="decimal" value={compacting.compactingExpense} onChange={(e) => setCompacting({ ...compacting, compactingExpense: e.target.value })} /></Field>
                      <Field label="Inward number" required hint="Gate pass / challan"><Input placeholder="Inward reference" value={compacting.compactingInwardNo} onChange={(e) => setCompacting({ ...compacting, compactingInwardNo: e.target.value })} /></Field>
                      <Field label="Received weight" required hint={flow.compactingDeliveryKg !== null ? `Sent ${kg(flow.compactingDeliveryKg)} · ±${WEIGHT_TOLERANCE_KG}` : kgHint} error={compactReceived.error} warning={compactReceived.warning}><WeightInput value={compacting.compactingReceivedKg} onValueChange={(compactingReceivedKg) => setCompacting({ ...compacting, compactingReceivedKg })} /></Field>
                      <Field label="Outward number" required hint="Gate pass / challan"><Input placeholder="Outward reference" value={compacting.compactingOutwardNo} onChange={(e) => setCompacting({ ...compacting, compactingOutwardNo: e.target.value })} /></Field>
                      <Field label="Compacted weight" required hint={kgHint} error={compactSent.error} warning={compactSent.warning}><WeightInput value={compacting.officeDeliveryKg} onValueChange={(officeDeliveryKg) => setCompacting({ ...compacting, officeDeliveryKg })} /></Field>
                    </div>
                  </div>
                  <div className="production-field-section">
                    <SectionHeading icon={UserRound} title="Party & mill" caption="Who compacts it; search a registered name or add a new one" />
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="Compacting mill" required className="md:col-span-2"><SearchableSelect placeholder="Select compacting mill" options={directory.compactingMills} value={compacting.compactingPartyDetails} onChange={(value) => setCompacting({ ...compacting, compactingPartyDetails: value, compactingMillDetails: value })} /></Field>
                    </div>
                  </div>
                  <ProcessNotes
                    flow={flow}
                    stage="COMPACTING"
                    notes={compacting.compactingNotes}
                    onNotes={(compactingNotes) => setCompacting({ ...compacting, compactingNotes })}
                    onFilesChanged={() => void reload()}
                  />
                </div>
                <div className="production-dock">
                <StageEstimate input={numeric(compacting.compactingReceivedKg)} output={numeric(compacting.officeDeliveryKg)} expense={numeric(compacting.compactingExpense)} label="Compacting" />
                <div className="production-dock__save">
                  <SaveChecklist total={7} missing={compactingMissing} problems={compactingProblems} />
                  <Button disabled={saving || !stageReady || compactingMissing.length > 0 || compactingProblems.length > 0} onClick={() => void run(() => api<FabricFlow>(`/production/fabric-flows/${flow.id}/compacting`, { method: "POST", body: JSON.stringify({ ...compacting, compactingPartyDetails: compacting.compactingPartyDetails.trim(), compactingMillDetails: (compacting.compactingMillDetails || compacting.compactingPartyDetails).trim(), compactingInwardNo: compacting.compactingInwardNo.trim(), compactingOutwardNo: compacting.compactingOutwardNo.trim(), compactingNotes: compacting.compactingNotes.trim() || undefined, compactingReceivedKg: numeric(compacting.compactingReceivedKg), officeDeliveryKg: numeric(compacting.officeDeliveryKg), compactingExpense: numeric(compacting.compactingExpense) }) }), "compacting")}>{saving ? "Saving…" : flow.officeDeliveryKg === null ? "Complete compacting" : "Save changes"} <Sparkles size={15} /></Button>
                </div>
                </div>
                {flow.officeDeliveryKg !== null && (
                  <div className="production-delivery-block is-delivery">
                    <div className="production-subbanner">
                      <span className="production-subbanner__icon"><Truck size={18} /></span>
                      <div className="min-w-0"><p className="production-subbanner__title">Delivery</p><p className="production-subbanner__sub">The compacted fabric of {flow.flowNo}, to a party or into a warehouse</p></div>
                    </div>
                    <DeliveryStage flow={flow} saving={saving} run={run} onFilesChanged={() => void reload()} parties={directory.deliveryParties} />
                  </div>
                )}
              </div>}
            </div>
          </section>
          </div>

          <aside className="space-y-5">
            <section className="production-card">
              <CardHead eyebrow="Batch calculation" title="Weight & production cost" />
              <BatchCalculation flow={flow} active={activeStage} />
            </section>
            <ExpenseLedger flow={flow} reload={reload} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** A batch's journey: every process as a step, done / now / not yet; a step opens its form. */
function BatchJourney({ flow, onOpen }: { flow: FabricFlow; onOpen: (stage: StageKey) => void }) {
  const steps = processSteps(flow);
  // A batch that ended in a warehouse stops at that process; one still being received there has no next step yet.
  const ended = completedInWarehouse(flow);
  const sent = sentToWarehouse(flow);
  const endIndex = endedStep(flow);
  const sentIndex = sent ? (sent.stage === "knitting" ? 1 : 2) : null;
  // The yarn step is always done; each later process is done once it has sent material on. The first one that hasn't is next.
  const done = (index: number) => index === 0 || ((endIndex === null || index <= endIndex) && steps[index].weight !== null);
  const next = endIndex !== null || sentIndex !== null ? -1 : steps.findIndex((_, index) => !done(index));
  const handOff = (index: number) =>
    index === endIndex && ended
      ? `Received in ${ended.delivery.warehouse?.code ?? "warehouse"} · ${shortDate(ended.delivery.receivedAt)}`
      : index === sentIndex && sent
        ? `Sent to ${sent.delivery.warehouse?.code ?? "warehouse"} · not received yet`
        : null;
  return (
    <nav className="production-journey" aria-label="Processes">
      {steps.map((step, index) => {
        const { icon: Icon, accent, opens } = journeyStyle[index];
        // A started process shows who has the fabric now; one not started yet is waiting to be started.
        const running =
          step.key === "knitting" && isKnitting(flow)
            ? [flow.knittingPartyDetails, flow.knittingExpectedFinishDate && `due ${shortDate(flow.knittingExpectedFinishDate)}`].filter(Boolean).join(" · ") || "Knitting"
            : step.key === "dyeing" && isDyeing(flow)
              ? [flow.dyeingPartyDetails, `since ${shortDate(flow.dyeingDate)}`].filter(Boolean).join(" · ")
              : step.key === "compacting" && isCompacting(flow)
                ? [flow.compactingPartyDetails, `since ${shortDate(flow.compactingDate)}`].filter(Boolean).join(" · ")
                : null;
        // Steps after the warehouse stop haven't started; the one right after it can be started from the warehouse stock.
        if (endIndex !== null && index > endIndex) {
          return (
            <button key={step.key} type="button" className={cn("production-journey__step", accent, index === endIndex + 1 && "is-now")} onClick={() => onOpen(opens)} title={`Open ${opens} under Record process`}>
              <span className="production-journey__node"><Icon size={16} /></span>
              <span className="production-journey__label">{step.label}</span>
              <span className="production-journey__value">{index === endIndex + 1 ? "Can start" : "—"}</span>
              <span className="production-journey__meta">{index === endIndex + 1 ? "From the warehouse stock" : "Not started"}</span>
            </button>
          );
        }
        return (
          <button
            key={step.key}
            type="button"
            className={cn("production-journey__step", accent, done(index) && "is-done", index === next && "is-now")}
            onClick={() => onOpen(opens)}
            title={`Open ${opens} under Record process`}
          >
            <span className="production-journey__node">{done(index) ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}</span>
            <span className="production-journey__label">{step.label}</span>
            <span className="production-journey__value">{done(index) ? kg(step.weight ?? 0) : index === next ? (running ? "In progress" : "Next") : "—"}</span>
            <span className="production-journey__meta">
              {done(index)
                ? handOff(index) ?? ([shortDate(step.date), step.who].filter(Boolean).join(" · ") || "Recorded")
                : index === next
                  ? running ?? (step.key === "final" ? "Waiting for this process" : "Not started yet")
                  : "Not reached yet"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** What one process took in and sent on, what it cost and who did it, for its banner. */
function stageInfo(flow: FabricFlow, stage: StageKey) {
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
  if (stage === "knitting") {
    return { from: "Yarn", to: "Grey fabric", input: flow.yarnReceivedKg ?? flow.purchasedWeightKg, output: flow.knittingDeliveryKg ?? flow.dyeingDeliveryKg, expense: flow.knittingExpense, who: join(flow.knittingPartyDetails, flow.knittingMillDetails) };
  }
  if (stage === "dyeing") {
    return { from: "Grey fabric", to: "Dyed fabric", input: flow.fabricReceivedKg ?? flow.dyeingDeliveryKg, output: flow.compactingDeliveryKg, expense: flow.dyeingExpense, who: join(flow.dyeingPartyDetails, flow.dyeingMillDetails, flow.color) };
  }
  return { from: "Dyed fabric", to: "Finished fabric", input: flow.compactingReceivedKg ?? flow.compactingDeliveryKg, output: flow.officeDeliveryKg, expense: flow.compactingExpense, who: join(flow.compactingPartyDetails, flow.compactingMillDetails) };
}

/** The coloured banner over a process's form: which process, who does it, and its weight in, out and cost so far. */
function StageBanner({ flow, stage, state }: { flow: FabricFlow; stage: StageKey; state: string }) {
  const index = stages.findIndex((s) => s.key === stage);
  const { icon: Icon, label } = stages[index];
  const info = stageInfo(flow, stage);
  const diff = info.input !== null && info.output !== null && info.input > 0 ? info.output - info.input : null;
  return (
    <div className="production-banner">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="production-banner__icon"><Icon size={22} /></span>
          <div className="min-w-0">
            <p className="production-banner__eyebrow">Process {String(index + 1).padStart(2, "0")} · {info.from} → {info.to}</p>
            <h2 className="production-banner__title">{label} <span className="production-banner__code">{flow.flowNo}</span></h2>
            <p className="production-banner__sub">{info.who ?? "Party and mill not recorded yet"}</p>
          </div>
        </div>
        <span className="production-banner__state">{state}</span>
      </div>
      <div className="production-banner__figures">
        <div><p>Weight in</p><strong>{info.input !== null ? kg(info.input) : "—"}</strong></div>
        <div><p>Weight out</p><strong>{info.output !== null ? kg(info.output) : "—"}</strong></div>
        <div>
          <p>{diff !== null && diff > 0 ? "Gain" : "Loss"}</p>
          <strong>{diff === null ? "—" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${kg(Math.abs(diff))}`}</strong>
          {diff !== null && info.input ? <small className="production-banner__pct">{((Math.abs(diff) / info.input) * 100).toFixed(2)}% of weight in</small> : null}
        </div>
        <div><p>Expense</p><strong>{money(info.expense)}</strong></div>
      </div>
    </div>
  );
}

/**
 * When knitting or dyeing delivered into a warehouse: completed once the warehouse received it (the batch ends there
 * unless that stock is started on the next process), still editable while it is on its way.
 */
function WarehouseNotice({ flow, stage }: { flow: FabricFlow; stage: "knitting" | "dyeing" }) {
  const delivery = warehouseDelivery(flow, stage === "knitting" ? "KNITTING" : "DYEING");
  if (!delivery) return null;
  const warehouse = delivery.warehouse ? `${delivery.warehouse.code} · ${delivery.warehouse.name}` : "the warehouse";
  const fabric = stage === "knitting" ? "grey fabric" : "dyed fabric";
  if (delivery.receivedAt) {
    const ended = completedInWarehouse(flow)?.stage === stage;
    return (
      <div className="mb-5 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
        <div>
          <p className="font-bold">{processName[stage]} completed · received in warehouse</p>
          <p className="mt-1 text-xs">
            {kg(delivery.receivedWeightKg ?? delivery.weightKg)} {fabric} received in {warehouse} on {shortDate(delivery.receivedAt)}; it is stock there as {flow.flowNo}.
            {ended ? ` To continue the batch, start ${nextAfter[stage]} from that stock on the ${processName[nextAfter[stage]]} tab.` : ""} This process can no longer be changed.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <Building2 className="mt-0.5 shrink-0" size={17} />
      <div>
        <p className="font-bold">Sent to warehouse · not received yet</p>
        <p className="mt-1 text-xs">{kg(delivery.weightKg)} {fabric} sent to {warehouse} on {shortDate(delivery.deliveredAt)}. You can still correct this process until the warehouse receives it.</p>
      </div>
    </div>
  );
}

/**
 * Continues a batch that ended in a warehouse: its fabric there (stock under the batch code) is taken out and the
 * next process starts, the same as starting that process from warehouse stock.
 */
function StartFromWarehouse({ flow, process, saving, run }: { flow: FabricFlow; process: "dyeing" | "compacting"; saving: boolean; run: RunStage }) {
  const category = process === "dyeing" ? "GREY_FABRIC" : "DYED_FABRIC";
  const fabric = process === "dyeing" ? "grey fabric" : "dyed fabric";
  const stock = useApiQuery<StartStock[]>(`/inventory/balances${qs({ category })}`);
  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouseOf = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const rows = (stock.data ?? []).filter((row) => row.itemCode === flow.flowNo && row.unit === "KG" && row.balanceKg > 0.0005);
  const [warehouseId, setWarehouseId] = useState("");
  const chosen = rows.find((row) => row.warehouseId === warehouseId) ?? (rows.length === 1 ? rows[0] : undefined);

  const start = () =>
    chosen &&
    run(
      () => api<FabricFlow>("/production/fabric-flows/start-stock-process", { method: "POST", body: JSON.stringify({ process, itemCode: chosen.itemCode, warehouseId: chosen.warehouseId, quantityKg: chosen.balanceKg }) }),
      process,
    );

  return (
    <div className="production-field-section">
      <SectionHeading icon={Play} title={`Start ${process}`} caption={`Continue ${flow.flowNo} with its ${fabric} from the warehouse`} />
      {stock.loading ? (
        <p className="text-sm text-gray-500">Checking warehouse stock…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">No {fabric} of {flow.flowNo} is left in any warehouse, so {process} can&apos;t be started.</p>
      ) : (
        <>
          {rows.length > 1 ? (
            <Field label="From warehouse">
              <select className="erp-input" value={chosen?.warehouseId ?? ""} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Select warehouse</option>
                {rows.map((row) => <option key={row.warehouseId} value={row.warehouseId}>{warehouseOf.get(row.warehouseId)?.code ?? "Warehouse"} · {kg(row.balanceKg)}</option>)}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-gray-700">{kg(rows[0].balanceKg)} {fabric} of {flow.flowNo} is in {warehouseOf.get(rows[0].warehouseId)?.code ?? "the warehouse"}.</p>
          )}
          <p className="mt-2 text-xs text-gray-500">All of it is taken out of the warehouse and sent to {process}; then record {process} here as usual.</p>
          <div className="mt-4 flex justify-end">
            <Button disabled={saving || !chosen} onClick={() => void start()}><Play size={15} /> {saving ? "Starting…" : chosen ? `Start ${process} with ${kg(chosen.balanceKg)}` : `Start ${process}`}</Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A process's notes (saved with the process) and its documents and photos (saved as soon as they are attached).
 */
function ProcessNotes({
  flow,
  stage,
  notes,
  onNotes,
  onFilesChanged,
}: {
  flow: FabricFlow;
  stage: AttachmentStage;
  notes: string;
  onNotes: (notes: string) => void;
  onFilesChanged: () => void;
}) {
  return (
    <div className="production-field-section">
      <SectionHeading icon={Paperclip} title="Notes & documents" caption="Notes are saved with this process; files are saved as soon as you attach them" />
      <div className="space-y-3">
        <Field label="Notes" hint="Optional">
          <textarea className="erp-input min-h-[4.5rem] py-2" maxLength={1000} placeholder="Anything worth remembering about this process" value={notes} onChange={(e) => onNotes(e.target.value)} />
        </Field>
        <Attachments flowId={flow.id} stage={stage} attachments={flow.attachments} onChanged={onFilesChanged} />
      </div>
    </div>
  );
}

function StageEstimate({ input, output, expense, label }: { input: number; output: number; expense: number; label: string }) {
  return <div className="production-estimate grid gap-3 sm:grid-cols-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label} input</p><p className="mt-1 text-base font-bold text-gray-800">{kg(input)}</p></div><WeightChange input={input} output={output} label={label} /><div><p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Stage expense</p><p className="mt-1 text-base font-bold text-amber-800">{money(expense)}</p></div></div>;
}

/** Field feedback for one weight against the step before it: refused when too high, flagged when a lot was lost. */
const weightFeedback = (input: number | null, output: string) => {
  const check = weightCheck(input ?? 0, numeric(output));
  return { error: check.kind === "over" ? check.message : null, warning: check.kind === "bigLoss" ? check.message : null, over: check.kind === "over" };
};

/** A semicircle gauge: how much of the yarn weight the batch still has (more than 100% when it gained). */
function YieldGauge({ pct }: { pct: number }) {
  const gradient = useId();
  const arc = Math.PI * 52;
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <div className="production-gauge" role="img" aria-label={`Yield ${pct.toFixed(1)}%`}>
      <svg viewBox="0 0 120 68" aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#c08426" />
            <stop offset="55%" stopColor="#1f8a6a" />
            <stop offset="100%" stopColor="#3ecf8e" />
          </linearGradient>
        </defs>
        <path d="M8 62 A52 52 0 0 1 112 62" className="production-gauge__track" />
        <path d="M8 62 A52 52 0 0 1 112 62" className="production-gauge__value" stroke={`url(#${gradient})`} style={{ strokeDasharray: arc, strokeDashoffset: arc * (1 - shown / 100) }} />
      </svg>
      <span className="production-gauge__label">
        <strong>{pct.toFixed(pct >= 99.95 && pct < 100.05 ? 0 : 1)}%</strong>
        <small>Yield</small>
      </span>
    </div>
  );
}

/** A weight change as a small chip: "+40 KG" green, "−55 KG" red. */
function ChangeChip({ diff }: { diff: number | null }) {
  if (diff === null) return null;
  if (Math.abs(diff) < 0.0005) return <span className="production-change is-flat is-sm">±0</span>;
  return <span className={cn("production-change is-sm", diff > 0 ? "is-gain" : "is-loss")}>{diff > 0 ? "+" : "−"}{kg(Math.abs(diff))}</span>;
}

/**
 * The batch in numbers beside the forms: the yield so far, the weight after every process as bars in its colour
 * (the process being recorded is highlighted), where the money went, and what came back.
 */
function BatchCalculation({ flow, active }: { flow: FabricFlow; active: StageKey }) {
  const yarn = flow.purchasedWeightKg;
  const rows: Array<{ key: string; label: string; value: number | null; accent: string; icon: LucideIcon }> = [
    { key: "yarn", label: flow.yarnItemCode ? "Yarn used" : "Yarn purchased", value: yarn, accent: "is-yarn", icon: Boxes },
    { key: "knitting", label: "After knitting", value: flow.dyeingDeliveryKg, accent: "is-knitting", icon: Factory },
    { key: "dyeing", label: "After dyeing", value: flow.compactingDeliveryKg, accent: "is-dyeing", icon: Droplets },
    { key: "compacting", label: "After compacting", value: flow.officeDeliveryKg, accent: "is-compacting", icon: Sparkles },
  ];
  const max = Math.max(yarn, ...rows.map((r) => r.value ?? 0)) || 1;
  const now = flow.metrics.currentWeightKg;
  const yieldPct = yarn ? (now / yarn) * 100 : 0;
  const change = now - yarn;
  const delivered = flow.finalDeliveredKg ?? 0;
  const compacted = flow.officeDeliveryKg;

  const costs = [
    { label: "Yarn", value: flow.metrics.yarnAmount, accent: "is-yarn" },
    { label: "Knitting", value: flow.knittingExpense, accent: "is-knitting" },
    { label: "Dyeing", value: flow.dyeingExpense, accent: "is-dyeing" },
    { label: "Compacting", value: flow.compactingExpense, accent: "is-compacting" },
    { label: "Delivery & other", value: flow.otherExpense + flow.purchaseOtherCost, accent: "is-other" },
  ];
  const spent = flow.metrics.totalSpent || costs.reduce((total, c) => total + c.value, 0);

  return (
    <div className="production-calc">
      <div className="production-calc__head">
        <YieldGauge pct={yieldPct} />
        <div className="min-w-0">
          <p className="production-calc__eyebrow">Weight now</p>
          <p className="production-calc__big">{kg(now)}</p>
          <p className="text-xs text-gray-500">of {kg(yarn)} {flow.yarnItemCode ? "yarn used" : "yarn purchased"}</p>
          <div className="mt-2"><ChangeChip diff={yarn ? change : null} /></div>
        </div>
      </div>

      <section className="production-calc__section">
        <p className="production-calc__eyebrow">Weight after each process</p>
        <ol className="production-wbars">
          {rows.map((row, index) => {
            const Icon = row.icon;
            const previous = index > 0 ? rows[index - 1].value : null;
            return (
              <li key={row.key} className={cn("production-wbar", row.accent, row.key === active && "is-active", row.value === null && "is-empty")}>
                <span className="production-wbar__icon"><Icon size={14} /></span>
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="production-wbar__label">{row.label}</span>
                    <strong className="production-wbar__value">{row.value === null ? "—" : kg(row.value)}</strong>
                  </span>
                  <span className="production-wbar__track"><span style={{ width: `${row.value === null ? 0 : (row.value / max) * 100}%` }} /></span>
                  {index > 0 && row.value !== null && previous !== null && <span className="mt-1 block"><ChangeChip diff={row.value - previous} /></span>}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="production-calc__delivered is-delivery">
          <span className="production-wbar__icon"><Truck size={14} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="production-wbar__label">Delivered</span>
              <strong className="production-wbar__value">{kg(delivered)}{compacted !== null && <span className="font-medium text-gray-400"> / {kg(compacted)}</span>}</strong>
            </span>
            <span className="production-wbar__track"><span style={{ width: `${compacted ? Math.min(100, (delivered / compacted) * 100) : 0}%` }} /></span>
            <span className="mt-1 block text-[11px] text-gray-500">{compacted === null ? "After compacting" : `${kg(Math.max(0, compacted - delivered))} left to deliver`}</span>
          </span>
        </div>
      </section>

      <section className="production-calc__section">
        <div className="flex items-baseline justify-between gap-2">
          <p className="production-calc__eyebrow">Where the money went</p>
          <strong className="text-sm text-gray-900">{money(spent)}</strong>
        </div>
        <div className="production-costbar" role="img" aria-label={costs.map((c) => `${c.label} ${money(c.value)}`).join(", ")}>
          {costs.filter((c) => c.value > 0).map((c) => <span key={c.label} className={c.accent} style={{ flexGrow: c.value }} title={`${c.label} ${money(c.value)}`} />)}
        </div>
        <ul className="production-costs">
          {costs.map((c) => (
            <li key={c.label} className={c.accent}>
              <span className="production-costs__dot" />
              <span className="flex-1 text-gray-600">{c.label}</span>
              <span className="text-[11px] text-gray-400">{spent > 0 ? `${((c.value / spent) * 100).toFixed(0)}%` : "—"}</span>
              <strong className="w-24 text-right text-gray-800">{money(c.value)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="production-calc__section production-calc__money">
        <div className="production-moneytile">
          <p className="production-calc__eyebrow">Total production cost</p>
          <p className="production-moneytile__value">{money(spent)}</p>
          <p className="text-[11px] text-gray-500">Profit is calculated only after sale</p>
        </div>
      </section>
    </div>
  );
}
