"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle2,
  Droplets,
  Factory,
  Hash,
  Layers,
  ListOrdered,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Timer,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import { prefetchApi, useApiQuery } from "@/lib/use-api-query";
import { ATTENTION_KINDS } from "@/lib/attention";
import { toast } from "@/lib/toast-store";
import { cn, gsmText, kg, money, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BadgeTone } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { useAuth } from "@/components/auth-provider";
import { keepDialogForOpenDropdown } from "@/components/ui/searchable-select";
import * as Dialog from "@radix-ui/react-dialog";
import { ProcessChallanDialog } from "@/components/process-challan";
import { CardHead, Pill } from "./fields";
import { ProcessCards, type CardKey } from "./process-cards";
import { CompactingForm, DeliveryForm, DyeingForm, KnittingForm, StartProcessForm } from "./process-forms";
import { StartDialog } from "./start-dialog";
import { DailyKnitting, FabricSection, Figures, MachinesSection, StockSection } from "./floor-sections";
import { materialOut, type ProductionOverview } from "./floor-data";
import { FloorClock } from "../masters/machines/floor";
import "../masters/machines/machines.css";
import { ExpenseLedger } from "./expense-ledger";
import { ProcessRegister, processRecords } from "./process-register";
import { completedInWarehouse, greyLeft, isCompacting, isDyeing, isKnitting, leftToDeliver, localDate, lotStage, sentToWarehouse, shortDate, warehouseDelivery, type FabricFlow, type FlowDirectory, type RunStage, type StageKey } from "./types";
import { itemHref } from "../warehouses/item-details";
import "./production.css";

type FlowResponse = { data: FabricFlow[] };
/** Until the mills and parties have loaded, the forms offer none. */
const EMPTY_DIRECTORY: FlowDirectory = { dealers: [], mills: [], knittingMills: [], dyeingMills: [], compactingMills: [], yarnStocks: [], fabricStocks: [] };

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

/** Roll up independently moving colour lots without hiding work still held by a processor. */
const lotSummary = (flow: FabricFlow) => {
  const counts = { Dyeing: 0, Dyed: 0, Compacting: 0, "To deliver": 0, Delivered: 0 };
  for (const lot of flow.lots) counts[lotStage(lot)] += 1;
  const active = counts.Dyeing + counts.Dyed + counts.Compacting + counts["To deliver"];
  return { counts, active, delivered: counts.Delivered, allDelivered: flow.lots.length > 0 && active === 0 };
};

/** The journey step (0 yarn, 1 knitting, 2 dyeing…) a batch that ended in a warehouse (or at a party) finished on. */
const endedStep = (flow: FabricFlow) => {
  if (flow.knittingDestination === "PARTY") return 1;
  if (flow.dyeingDestination === "PARTY") return 2;
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
  // A process delivered its fabric straight to a party: the batch ended there.
  if (flow.knittingDestination === "PARTY" || flow.dyeingDestination === "PARTY") {
    const party = flow.deliveries.find((d) => d.destination === "CUSTOMER")?.partyName ?? "a party";
    const stage = flow.knittingDestination === "PARTY" ? "Grey fabric" : "Dyed fabric";
    return { label: "Delivered", tone: "success", place: `${stage} delivered to ${party}${flow.finalDate ? ` on ${shortDate(flow.finalDate)}` : ""}`, next: null, action: "" };
  }
  // A knitting batch dyed in lots: each lot goes on by itself; the batch only has grey fabric left (or none).
  if (flow.lots.length) {
    const left = greyLeft(flow) ?? 0;
    const summary = lotSummary(flow);
    const pending = flow.lots.filter((lot) => lotStage(lot) !== "Delivered");
    const pendingText = pending.slice(0, 3).map((lot) => `${lot.color ?? lot.flowNo} (${lotStage(lot).toLowerCase()})`).join(", ");
    const lots = `${flow.lots.length} dyeing lot${flow.lots.length === 1 ? "" : "s"}`;
    if (left > 0.0005) return { label: lots, tone: "info", place: `${pendingText} · ${kg(left)} grey fabric left to assign`, next: "dyeing", action: "Dye another colour" };
    if (summary.allDelivered) return { label: "All colours delivered", tone: "success", place: `${lots} completed and delivered independently`, next: null, action: "" };
    return {
      label: `${summary.active} colour${summary.active === 1 ? "" : "s"} pending`,
      tone: "warning",
      place: `${pendingText}${pending.length > 3 ? ` +${pending.length - 3} more` : ""} · ${summary.delivered} delivered`,
      next: null,
      action: "",
    };
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
      ? { label: "Compacted · part sent", tone: "info", place: `Compacted — ${kg(left)} not sent on yet`, next: "compacting", action: "Send it on" }
      : { label: "Compacted", tone: "info", place: "Compacted — the finished fabric is not sent on yet", next: "compacting", action: "Send it on" };
  }
  return { label: "Delivered", tone: "success", place: "Delivered — all processes complete", next: null, action: "" };
};

/** How far through the processes a batch is: 0 knitting, 1 dyeing, 2 compacting, 3 completed (delivered, or ended in a warehouse). */
const progressOf = (flow: FabricFlow) => {
  if (flow.status === "PURCHASED" || isKnitting(flow)) return 0;
  // A knitting batch with dyeing lots is at dyeing while grey fabric is left, done once all of it is in lots.
  if (flow.lots.length) {
    if ((greyLeft(flow) ?? 0) > 0.0005) return 1;
    const summary = lotSummary(flow);
    if (summary.allDelivered) return 3;
    // Keep the parent batch active while any colour is at dyeing, compacting, or waiting for delivery.
    return summary.counts.Compacting > 0 || summary.counts["To deliver"] > 0 ? 2 : 1;
  }
  const sent = sentToWarehouse(flow);
  if (sent) return sent.stage === "knitting" ? 0 : 1;
  if (completedInWarehouse(flow)) return 3;
  if (flow.status === "KNITTING") return 1;
  if (flow.status === "DYEING" || flow.status === "COMPACTING") return 2;
  // Compacted fabric not sent on yet (older batches) is still compacting's.
  if (flow.status === "AT_OFFICE") return 2;
  return 3;
};
const progressAccent = ["is-knitting", "is-dyeing", "is-compacting", "is-complete"];

/** A batch at the same step longer than this is pointed out (the Dashboard uses the same rule). */
const STUCK_DAYS = 10;
/** When the batch reached the step it is at now (as the Dashboard works it out). */
const stepSince = (flow: FabricFlow) =>
  flow.status === "AT_OFFICE" ? flow.compactingFinishedAt ?? flow.compactingDate
    : flow.status === "COMPACTING" ? flow.compactingDate ?? flow.dyeingFinishedAt
      : flow.status === "DYEING" ? flow.dyeingDate ?? flow.knittingFinishedAt
        : flow.status === "KNITTING" ? flow.knittingFinishedAt ?? flow.knittingDate ?? flow.purchaseDate
          : flow.purchaseDate;
/** Whole days at the current step, for a batch still in process; null once it is completed. */
const daysInStep = (flow: FabricFlow) => {
  if (progressOf(flow) >= 3) return null;
  const since = stepSince(flow);
  if (!since) return null;
  const from = new Date(since);
  from.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - from.getTime()) / 86_400_000));
};
/**
 * Waiting too long at one step. Yarn not started yet doesn't count (as on the Dashboard), nor a knitting batch whose
 * grey fabric is all in dyeing lots: those lots are listed, and timed, on their own.
 */
const isStuck = (flow: FabricFlow) => {
  if (flow.status === "PURCHASED" || (flow.lots.length > 0 && (greyLeft(flow) ?? 0) <= 0.0005)) return false;
  return (daysInStep(flow) ?? 0) > STUCK_DAYS;
};
/** A timestamp's date on this computer's calendar (IST), not UTC's. */
const dayOf = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const batchPath = (flowNo: string) => `/production/fabric-flows/code/${encodeURIComponent(flowNo)}`;
const DIRECTORY_PATH = "/production/fabric-flows/directory";
/** Hovering or focusing a batch starts loading its page, so opening it is instant. */
const prefetchBatch = (flow: FabricFlow) => {
  prefetchApi(batchPath(flow.flowNo));
  prefetchApi(DIRECTORY_PATH);
};

type Filter = "all" | "processing" | "knitting" | "dyeing" | "compacting" | "completed";
type ListOrder = "date" | "code" | "process";
const progressFilter: Filter[] = ["knitting", "dyeing", "compacting", "completed"];
const filters: Array<{ key: Filter; label: string; icon: LucideIcon; accent: string }> = [
  { key: "all", label: "All batches", icon: Layers, accent: "is-all" },
  { key: "processing", label: "Processing", icon: RefreshCw, accent: "is-processing" },
  { key: "knitting", label: "Knitting", icon: Factory, accent: "is-knitting" },
  { key: "dyeing", label: "At dyeing", icon: Droplets, accent: "is-dyeing" },
  { key: "compacting", label: "At compacting", icon: Sparkles, accent: "is-compacting" },
  { key: "completed", label: "Completed", icon: CheckCircle2, accent: "is-complete" },
];
/** Whether a batch belongs under a filter: "processing" is every batch not yet completed (delivered or ended in a warehouse). */
const inFilter = (flow: FabricFlow, filter: Filter) =>
  filter === "all" || (filter === "processing" ? progressOf(flow) < 3 : progressFilter[progressOf(flow)] === filter);

/** Where the batch's yarn came from, by item code (older batches started from a purchase entry). */
const yarnSource = (flow: FabricFlow) =>
  flow.parent ? `Dyeing lot of ${flow.parent.flowNo}` : flow.yarnItemCode ? `Yarn ${flow.yarnItemCode}${flow.yarnWarehouse ? ` · ${flow.yarnWarehouse.code}` : ""}` : "Yarn purchase";
/** A batch's origin in the list: its knitting batch for a dyeing lot, else its yarn. */
const originOf = (flow: FabricFlow) => (flow.parent ? `Lot of ${flow.parent.flowNo}${flow.color ? ` · ${flow.color}` : ""}` : flow.yarnItemCode ? `Yarn ${flow.yarnItemCode}` : flow.yarnCount);

/** Everything that happened to a batch, oldest first: its record, followed by its code. */
function batchRecord(flow: FabricFlow) {
  const events: Array<{ date: string; title: string; detail: string; weight: number | null }> = [];
  const add = (date: string | null, title: string, detail: (string | null | false | undefined)[], weight: number | null = null) => {
    if (date) events.push({ date, title, detail: detail.filter(Boolean).join(" · "), weight });
  };
  if (flow.parent) {
    // A dyeing lot starts with its share of the knitting batch's grey fabric.
    add(flow.purchaseDate, `Grey fabric from ${flow.parent.flowNo}`, [flow.yarnItemCode && `yarn ${flow.yarnItemCode}`, flow.color && `to dye ${flow.color}`, flow.yarnRatePerKg > 0 && `${money(flow.yarnRatePerKg)}/KG`], flow.purchasedWeightKg);
  } else {
    add(
      flow.purchaseDate,
      flow.yarnItemCode ? `Yarn ${flow.yarnItemCode} taken from stock` : "Yarn purchased",
      [flow.yarnCount, flow.yarnWarehouse?.code, flow.yarnLotNo && `lot ${flow.yarnLotNo}`, flow.yarnRatePerKg > 0 && `${money(flow.yarnRatePerKg)}/KG`],
      flow.purchasedWeightKg,
    );
  }
  for (const lot of flow.lots) add(lot.dyeingDate, `Dyeing lot ${lot.flowNo}`, [lot.color, lot.dyeingMillDetails, lotStage(lot).toLowerCase()], toNumber(lot.purchasedWeightKg));
  if (!flow.parent && flow.knittingDate && flow.knittingDate !== flow.knittingFinishedAt) {
    add(flow.knittingDate, "Knitting started", [flow.knittingPartyDetails, flow.knittingMillDetails, flow.knittingExpectedFinishDate && `due ${shortDate(flow.knittingExpectedFinishDate)}`]);
  }
  add(
    flow.parent ? null : flow.knittingFinishedAt ?? (flow.dyeingDeliveryKg !== null ? flow.knittingDate : null),
    "Knitting finished",
    [!!flow.knittingBagCount && `${flow.knittingBagCount} rolls`, flow.knittingDeliveryPlace && `to ${flow.knittingDeliveryPlace}`, flow.knittingExpense > 0 && `charges ${money(flow.knittingExpense)}`],
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


export default function ProductionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Production />
    </Suspense>
  );
}

/**
 * The front shows every batch by code with only its yarn used and the process it is at. Opening a code
 * (`?batch=01SS26-KT01`) shows its full details and stage forms; `?new=1` opens the Start window over the list.
 */
function Production() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // `?code=` is kept from older links.
  const batchParam = (params.get("batch") ?? params.get("code") ?? "").trim();
  const starting = params.get("new") === "1";
  const recordParam = params.get("record");

  // The front loads a light list (kept for the tab, so even a reload shows it at once); a batch's page loads that one
  // batch in full.
  const list = useApiQuery<FlowResponse>(batchParam ? null : "/production/fabric-flows?view=list", { persist: user?.id });
  const batch = useApiQuery<FabricFlow>(batchParam ? batchPath(batchParam) : null);
  const directoryQuery = useApiQuery<FlowDirectory>(batchParam || starting ? DIRECTORY_PATH : null);
  const directory = directoryQuery.data ?? EMPTY_DIRECTORY;
  // Machines and the yarn and fabric in stock (owners and admins only): only the Floor & stock tab shows them, so they
  // load when that tab is first opened rather than with every visit to the list.
  const [floorOpened, setFloorOpened] = useState(false);
  const openFloor = useCallback(() => setFloorOpened(true), []);
  const overview = useApiQuery<ProductionOverview>(batchParam || !isAdmin || !floorOpened ? null : "/production/overview");
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  const { reload: reloadList } = list;
  const { reload: reloadBatch } = batch;
  const { reload: reloadOverview } = overview;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadList(), reloadOverview()]);
    setUpdatedAt(new Date());
    setRefreshing(false);
  }, [reloadList, reloadOverview]);
  const retryOverview = useCallback(() => void reloadOverview(), [reloadOverview]);
  const reloadOne = useCallback(async () => {
    await reloadBatch();
  }, [reloadBatch]);

  const go = (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString();
    router.push(search ? `${pathname}?${search}` : pathname, { scroll: true });
  };

  if (batchParam) {
    if (!batch.data) {
      if (!batch.error) return <BatchSkeleton code={batchParam.toUpperCase()} onBack={() => go({})} />;
      return (
        <div className="production-page mx-auto max-w-xl pt-12">
          <div className="production-empty">
            <span className="production-empty__icon"><Search size={24} /></span>
            <p className="text-lg font-bold text-gray-900">No batch with code {batchParam.toUpperCase()}</p>
            <p className="text-sm text-gray-500">{batch.error}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={() => go({})}><ArrowLeft size={15} /> All batches</Button>
              <Button variant="outline" onClick={() => void batch.reload()}><RefreshCw size={15} /> Try again</Button>
            </div>
          </div>
        </div>
      );
    }
    return <BatchView key={batch.data.id} flow={batch.data} directory={directory} reload={reloadOne} onBack={() => go({})} managerMode={!isAdmin} startInStage={recordParam === "knitting" || recordParam === "dyeing" || recordParam === "compacting" || recordParam === "delivery" ? recordParam : undefined} />;
  }

  if (!list.data) {
    if (!list.error) return <ListSkeleton />;
    return (
      <div className="production-page mx-auto max-w-xl pt-12">
        <div className="production-empty">
          <span className="production-empty__icon text-rose-600"><AlertTriangle size={24} /></span>
          <p className="text-lg font-bold text-gray-900">Production batches unavailable</p>
          <p className="text-sm text-gray-500">{list.error}</p>
          <Button className="mt-4" onClick={() => void refresh()}><RefreshCw size={15} /> Retry</Button>
        </div>
      </div>
    );
  }
  const flows = list.data.data;

  return (
    <>
      <ListView flows={flows} overview={overview.data} overviewError={overview.error} onRetryOverview={retryOverview} onFloorOpen={openFloor} refreshing={refreshing} updatedAt={updatedAt} onRefresh={() => void refresh()} onOpen={(flow) => go({ batch: flow.flowNo })} onRecord={(flow, record) => go({ batch: flow.flowNo, record })} onStart={() => go({ new: "1" })} managerMode={!isAdmin} />
      {starting && isAdmin && <StartDialog directory={directory} flows={flows} onClose={() => go({})} onStarted={(flow) => go({ batch: flow.flowNo })} />}
    </>
  );
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

/** How long a batch has been at the step it is on; red once it is stuck there. */
function StepAge({ days, stuck }: { days: number; stuck: boolean }) {
  return (
    <span className={cn("production-step-age", stuck && "is-stuck")} title={stuck ? `At this step over ${STUCK_DAYS} days` : "Days at this step"}>
      <Timer size={10} aria-hidden /> {days === 0 ? "Today" : `${days}d`} at this step
    </span>
  );
}

/** The front's shape while the batches load for the first time in this tab. */
function ListSkeleton() {
  return (
    <div className="production-page space-y-4 pb-10" role="status" aria-label="Loading production">
      <div className="production-hero prod-head production-skeleton--hero" />
      <div className="production-skeleton production-skeleton--row" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="production-skeleton production-skeleton--tile" />)}
      </div>
      <div className="production-skeleton production-skeleton--row" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="production-skeleton production-skeleton--line" />)}
      </div>
    </div>
  );
}

/** A batch's page while it loads: its code at once, the rest as placeholders. */
function BatchSkeleton({ code, onBack }: { code: string; onBack: () => void }) {
  return (
    <div className="production-page space-y-5 pb-10" role="status" aria-label={`Loading ${code}`}>
      <header className="production-hero">
        <button type="button" className="production-back" onClick={onBack}><ArrowLeft size={14} /> All batches</button>
        <h1 className="production-hero__code mt-4">{code}</h1>
        <div className="production-hero__stats">
          {[0, 1, 2, 3].map((i) => <div key={i} className="production-glass production-skeleton--glass" />)}
        </div>
      </header>
      <div className="production-layout">
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="production-skeleton production-skeleton--card" />)}</div>
        <div className="production-skeleton production-skeleton--card" />
      </div>
    </div>
  );
}

/** Cards shown at first, and how many more each "Show more" adds (the list can run to hundreds). */
const PAGE = 60;
/** How often the Floor & stock tab fetches the machines and stock again while it is on screen. */
const FLOOR_REFRESH_MS = 2 * 60_000;

/**
 * The front, in tabs. Batches (the default, so recent production shows first): status cards (count and weight)
 * filter it; "needs attention" picks out late knitting and fabric not yet received; then the batches as cards (60 at a
 * time) or a table, searchable by code, yarn, fabric, colour or mill. Knitting, Dyeing and Compacting: each process's register (waiting, running, done but not sent on, done). Floor & stock: the figures for what is in
 * process, ready and delivered, and the machines and material.
 */
function ListView({
  flows,
  overview,
  overviewError,
  onRetryOverview,
  onFloorOpen,
  refreshing,
  updatedAt,
  onRefresh,
  onOpen,
  onRecord,
  onStart,
  managerMode = false,
}: {
  flows: FabricFlow[];
  overview?: ProductionOverview;
  overviewError?: string;
  onRetryOverview: () => void;
  /** The Floor & stock tab was opened: its machines and stock start loading. */
  onFloorOpen: () => void;
  refreshing: boolean;
  updatedAt: Date;
  onRefresh: () => void;
  onOpen: (flow: FabricFlow) => void;
  /** Opens a batch with the entry window of its next step. */
  onRecord: (flow: FabricFlow, record: CardKey) => void;
  onStart: () => void;
  managerMode?: boolean;
}) {
  // Batches, a register for each process (what is waiting, running, done but not sent on, and done), or Floor & stock.
  const [view, setViewState] = useState<"batches" | StageKey | "floor">("batches");
  const setView = (next: typeof view) => {
    if (next === "floor") onFloorOpen();
    setViewState(next);
  };
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<"cards" | "table">("table");
  const [filter, setFilter] = useState<Filter>("processing");
  const [listOrder, setListOrder] = useState<ListOrder>("date");
  const [attention, setAttention] = useState<"" | "late" | "waiting" | "stuck">("");
  const [limit, setLimit] = useState(PAGE);
  const q = search.trim().toUpperCase();
  const today = localDate();
  const month = today.slice(0, 7);

  // One pass over the batches for every count and total on the page.
  const stats = useMemo(() => {
    const counts: Record<Filter, number> = { all: flows.length, processing: 0, knitting: 0, dyeing: 0, compacting: 0, completed: 0 };
    const weights: Record<Filter, number> = { all: 0, processing: 0, knitting: 0, dyeing: 0, compacting: 0, completed: 0 };
    const late: FabricFlow[] = [];
    const waiting: FabricFlow[] = [];
    const stuck: FabricFlow[] = [];
    let deliveredMonth = 0;
    let costInProcess = 0;
    for (const flow of flows) {
      const step = progressOf(flow);
      const key = progressFilter[step];
      const weight = flow.metrics.currentWeightKg;
      counts[key]++;
      weights[key] += weight;
      weights.all += weight;
      if (step < 3) {
        counts.processing++;
        weights.processing += weight;
        costInProcess += flow.metrics.totalSpent;
      }
      if (isKnitting(flow) && flow.knittingExpectedFinishDate && flow.knittingExpectedFinishDate.slice(0, 10) < today) late.push(flow);
      if ([...flow.processDeliveries, ...flow.deliveries].some((d) => d.destination === "WAREHOUSE" && !d.receivedAt)) waiting.push(flow);
      if (isStuck(flow)) stuck.push(flow);
      // By the date on this calendar: a delivery made after midnight is that day's, not the day before's (UTC).
      for (const d of flow.deliveries) if (dayOf(d.deliveredAt).slice(0, 7) === month) deliveredMonth += toNumber(d.weightKg);
    }
    // The longest waiting first.
    stuck.sort((a, b) => (daysInStep(b) ?? 0) - (daysInStep(a) ?? 0));
    return { counts, weights, late, waiting, stuck, deliveredMonth, costInProcess };
  }, [flows, today, month]);

  const visible = useMemo(() => {
    const pool = attention ? stats[attention] : flows.filter((f) => inFilter(f, filter));
    // A code, yarn, fabric or colour, any mill or party it went to, or one of its dyeing lots.
    const filtered = q
      ? pool.filter((f) =>
          [
            f.flowNo, f.yarnItemCode, f.yarnCount, f.fabricType, f.color,
            f.knittingMillDetails, f.dyeingMillDetails, f.compactingMillDetails,
            f.knittingPartyDetails, f.dyeingPartyDetails, f.compactingPartyDetails,
            ...f.deliveries.map((d) => d.partyName),
            ...f.lots.flatMap((lot) => [lot.flowNo, lot.color]),
          ].some((v) => v?.toUpperCase().includes(q)),
        )
      : pool;
    // The stuck list stays longest waiting first unless another order is picked.
    if (attention === "stuck" && listOrder === "date") return filtered;
    return [...filtered].sort((a, b) => {
      if (listOrder === "code") return a.flowNo.localeCompare(b.flowNo, undefined, { numeric: true });
      if (listOrder === "process") return progressOf(a) - progressOf(b) || a.flowNo.localeCompare(b.flowNo, undefined, { numeric: true });
      return b.purchaseDate.localeCompare(a.purchaseDate) || b.flowNo.localeCompare(a.flowNo, undefined, { numeric: true });
    });
  }, [flows, filter, q, listOrder, attention, stats]);
  const shown = visible.slice(0, limit);
  const out = useMemo(() => materialOut(flows), [flows]);
  // What is pending or running at each process, for its tab.
  const openAt = useMemo(
    () => Object.fromEntries(stages.map(({ key }) => [key, processRecords(flows, key).filter((r) => r.state !== "SENT").length])) as Record<StageKey, number>,
    [flows],
  );
  useEffect(() => {
    if (view !== "floor") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") onRetryOverview();
    }, FLOOR_REFRESH_MS);
    return () => clearInterval(timer);
  }, [view, onRetryOverview]);
  const shownFilter = filters.find((f) => f.key === filter)!;
  const pick = (next: Filter) => {
    setFilter(next);
    setAttention("");
    setLimit(PAGE);
  };

  return (
    <div className="production-page space-y-4 pb-10">
      <header className="production-hero prod-head">
        <div className="min-w-0">
          <p className="production-eyebrow"><span className="prod-live" aria-hidden /> {managerMode ? "Assigned knitting work" : "Yarn → knitting → dyeing → compacting → delivery"}</p>
          <h1 className="production-hero__title">{managerMode ? "Knitting tasks" : "Production"}</h1>
          <p className="mt-1 max-w-xl text-sm text-white/65">{managerMode ? "Open a task to see its machines and yarn, then finish it with the yarn used and the grey fabric." : "Every batch keeps its code from the yarn to the last delivery. Start a process, complete it with what was used and its cost, and each hand-off gets a delivery challan."}</p>
        </div>
        {!managerMode && view === "floor" && <FloorClock />}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="production-ghost" disabled={refreshing} onClick={onRefresh} title="Refresh the list">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </Button>
          {!managerMode && <Button className="production-cta" onClick={onStart}><Play size={15} /> Start a process</Button>}
        </div>
      </header>

      {!managerMode && (
        <div className="production-order pviews" role="tablist" aria-label="Production view">
          <button type="button" role="tab" aria-selected={view === "batches"} onClick={() => setView("batches")}>
            <Layers size={15} /> Batches <span className="pviews__count">{stats.counts.processing} in process</span>
          </button>
          {stages.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}>
              <Icon size={15} /> {label}{openAt[key] ? <span className="pviews__count">{openAt[key]} open</span> : null}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={view === "floor"} onClick={() => setView("floor")}>
            <Factory size={15} /> Floor &amp; stock{overview ? <span className="pviews__count">{overview.machines.running.length} knitting</span> : null}
          </button>
        </div>
      )}

      {!managerMode && view === "floor" && (
        <>
          <div className="pkpis">
            <div><p>In process</p><strong>{stats.counts.processing}</strong><span>{kg(stats.weights.processing)} of fabric and yarn</span></div>
            <div><p>At knitting</p><strong>{stats.counts.knitting}</strong><span>{kg(stats.weights.knitting)} · yarn in hand or on machines</span></div>
            <div><p>Delivered this month</p><strong>{kg(stats.deliveredMonth)}</strong><span>to parties and warehouses</span></div>
            <div><p>Cost in process</p><strong>{money(stats.costInProcess)}</strong><span>yarn, processes and other costs</span></div>
          </div>
          <Figures overview={overview} out={out} />
          <DailyKnitting overview={overview} error={overviewError} onRetry={onRetryOverview} />
          <MachinesSection overview={overview} error={overviewError} onRetry={onRetryOverview} />
          <StockSection overview={overview} error={overviewError} onRetry={onRetryOverview} out={out} />
          <FabricSection out={out} loading={false} />
        </>
      )}

      {!managerMode && (view === "knitting" || view === "dyeing" || view === "compacting") && (
        <ProcessRegister key={view} flows={flows} stage={view} onOpen={onOpen} onRecord={onRecord} />
      )}

      {(managerMode || view === "batches") && (
        <>
          {!managerMode && (
            <nav className="pstates" aria-label="Show batches by process">
              {filters.map(({ key, label, icon: Icon, accent }) => (
                <button key={key} type="button" aria-pressed={filter === key && !attention} className={cn("pstate", accent)} onClick={() => pick(key)}>
                  <span className="pstate__label"><Icon size={14} aria-hidden /> {label}</span>
                  <strong>{stats.counts[key]}</strong>
                  <span className="pstate__note">{stats.weights[key] > 0 ? kg(stats.weights[key]) : "—"}</span>
                </button>
              ))}
            </nav>
          )}

          {(stats.late.length > 0 || stats.waiting.length > 0 || stats.stuck.length > 0) && (
            <div className="pattention" role="status">
              <AlertTriangle size={17} aria-hidden />
              <span className="font-semibold">Needs attention:</span>
              {/* Each with what it is about (machines, the warehouse, production) as on the Dashboard; late and stuck are urgent. */}
              {([
                ["late", stats.late.length, "knitting past due", "machines", Factory, true],
                ["waiting", stats.waiting.length, "waiting to be received in a warehouse", "warehouse", Warehouse, false],
                ["stuck", stats.stuck.length, `at the same step over ${STUCK_DAYS} days`, "production", Timer, true],
              ] as const).map(([key, count, text, kind, Icon, urgent]) => count > 0 && (
                <button key={key} type="button" className={cn(urgent && "is-urgent")} aria-pressed={attention === key} onClick={() => { setAttention(attention === key ? "" : key); setLimit(PAGE); }} title={ATTENTION_KINDS[kind].label}>
                  <span className={cn("attn-icon is-sm", `is-${kind}`, urgent && "is-urgent")}><Icon size={12} /></span>
                  {count} {text}
                </button>
              ))}
            </div>
          )}

          <div className="production-list-tools">
            <form
              className="production-search"
              onSubmit={(event) => {
                event.preventDefault();
                const exact = visible.find((f) => f.flowNo.toUpperCase() === q);
                if (exact ?? visible.length === 1) onOpen(exact ?? visible[0]);
              }}
            >
              <Search size={17} aria-hidden />
              <Input placeholder="Find a code, yarn, fabric, colour or mill (Enter opens it)" aria-label="Find a batch" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} autoComplete="off" spellCheck={false} />
            </form>
            <div className="production-order" role="group" aria-label="Arrange production batches">
              <button type="button" aria-pressed={listOrder === "date"} onClick={() => setListOrder("date")}><CalendarDays size={15} /> Newest</button>
              <button type="button" aria-pressed={listOrder === "code"} onClick={() => setListOrder("code")}><Hash size={15} /> Code</button>
              <button type="button" aria-pressed={listOrder === "process"} onClick={() => setListOrder("process")}><ListOrdered size={15} /> Process</button>
            </div>
            <div className="production-order" role="group" aria-label="Show as">
              <button type="button" aria-pressed={layout === "cards"} onClick={() => setLayout("cards")}><Layers size={15} /> Cards</button>
              <button type="button" aria-pressed={layout === "table"} onClick={() => setLayout("table")}><ListOrdered size={15} /> Table</button>
            </div>
            <p className="text-sm text-gray-500">
              {visible.length} {visible.length === 1 ? "batch" : "batches"} · {attention === "late" ? "knitting past due" : attention === "waiting" ? "waiting to be received" : attention === "stuck" ? `same step over ${STUCK_DAYS} days` : shownFilter.label.toLowerCase()}
            </p>
          </div>

          {visible.length === 0 ? (
            <div className="production-empty">
              <span className="production-empty__icon">{flows.length ? <Search size={24} /> : <Factory size={24} />}</span>
              <p className="text-base font-bold text-gray-900">{!flows.length ? "No batches yet" : q ? `No batch matches ${search.trim()}` : `No batches ${shownFilter.label.toLowerCase()}`}</p>
              <p className="text-sm text-gray-500">{flows.length ? "Check the code, or show all batches." : "Start a process with yarn or fabric from a warehouse."}</p>
              {flows.length ? (
                <Button variant="outline" className="mt-3" onClick={() => { setSearch(""); pick("all"); }}>Show all batches</Button>
              ) : !managerMode ? (
                <Button className="mt-3" onClick={onStart}><Play size={15} /> Start a process</Button>
              ) : null}
            </div>
          ) : layout === "cards" ? (
            <div className="batch-tiles">
              {shown.map((flow) => <BatchTile key={flow.id} flow={flow} managerMode={managerMode} onOpen={() => onOpen(flow)} onRecord={(record) => onRecord(flow, record)} onIntent={() => prefetchBatch(flow)} />)}
            </div>
          ) : (
            <div className="production-ledger">
              <div className="production-ledger__head" aria-hidden>
                <span>Date</span><span>Batch / yarn code</span><span>Yarn used</span><span>Current process</span><span>Progress</span><span />
              </div>
              {shown.map((flow) => <BatchRow key={flow.id} flow={flow} onOpen={() => onOpen(flow)} onIntent={() => prefetchBatch(flow)} />)}
            </div>
          )}
          {visible.length > shown.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown.length)} more of {visible.length - shown.length}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const railSteps = ["Knit", "Dye", "Compact"];

/** The entry a batch's next step opens: its process, or the deliveries once it is compacted. */
const nextRecord = (flow: FabricFlow): CardKey | null => {
  const next = whereIs(flow).next;
  return next === "compacting" && flow.officeDeliveryKg !== null ? "delivery" : next;
};

/**
 * A batch as a card: its code, yarn and fabric, where it is now, its progress, the weights and cost so far, and the
 * button for its next step (which opens that entry straight away).
 */
function BatchTile({ flow, managerMode, onOpen, onRecord, onIntent }: { flow: FabricFlow; managerMode: boolean; onOpen: () => void; onRecord: (record: CardKey) => void; onIntent: () => void }) {
  const where = whereIs(flow);
  const step = progressOf(flow);
  const ended = endedStep(flow);
  const railDone = ended ?? step;
  const railNow = ended === null ? step : -1;
  const next = nextRecord(flow);
  const fabric = [flow.fabricType, flow.fabricDiameter && `${flow.fabricDiameter} dia`, gsmText(flow.fabricGsm), flow.color].filter(Boolean).join(" · ");
  const challans = (flow.challans ?? []).filter((c) => !c.cancelledAt).length;
  const inStep = daysInStep(flow);
  return (
    <article className={cn("batch-tile", progressAccent[step])} onPointerEnter={onIntent} onFocus={onIntent}>
      <button type="button" className="batch-tile__main" onClick={onOpen} aria-label={`Open ${flow.flowNo}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <strong className="batch-tile__code">{flow.flowNo}</strong>
            <span className="batch-tile__sub">{originOf(flow)} · {shortDate(flow.purchaseDate)}</span>
            {inStep !== null && <StepAge days={inStep} stuck={isStuck(flow)} />}
          </span>
          <Pill tone={where.tone} live={processRunning(flow)}>{where.label}</Pill>
        </span>
        {fabric && <span className="batch-tile__fabric">{fabric}</span>}
        <span className="batch-tile__place">{where.place}</span>
        <span className="production-rail">{railSteps.map((s, i) => <span key={s} className={cn(i < railDone && "is-done", i === railNow && "is-now")} />)}</span>
        <span className="batch-tile__nums">
          <span><small>{flow.parent ? "Grey fabric" : isKnitting(flow) ? "Yarn given" : "Yarn used"}</small>{kg(flow.purchasedWeightKg)}</span>
          <span><small>Weight now</small>{kg(flow.metrics.currentWeightKg)}</span>
          {!managerMode && <span><small>Cost so far</small>{money(flow.metrics.totalSpent)}</span>}
        </span>
      </button>
      <span className="batch-tile__foot">
        <span className="text-[11px] text-gray-500">{challans ? `${challans} delivery challan${challans === 1 ? "" : "s"}` : "No challan yet"}</span>
        {next && where.action ? (
          <Button size="sm" className="batch-tile__cta" onClick={() => onRecord(next)}>{where.action} <ArrowRight size={14} /></Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onOpen}>Open <ArrowRight size={14} /></Button>
        )}
      </span>
    </article>
  );
}

/** A compact ledger row: easier to scan than cards and still shows the full process position. */
function BatchRow({ flow, onOpen, onIntent }: { flow: FabricFlow; onOpen: () => void; onIntent: () => void }) {
  const where = whereIs(flow);
  const step = progressOf(flow);
  // A batch that ended in a warehouse went only as far as that process; later rail steps stay empty.
  const ended = endedStep(flow);
  const railDone = ended ?? step;
  const railNow = ended === null ? step : -1;
  const inStep = daysInStep(flow);
  const change = flow.metrics.currentWeightKg - flow.purchasedWeightKg;
  return (
    <button type="button" className={cn("production-ledger__row", progressAccent[step])} onClick={onOpen} onPointerEnter={onIntent} onFocus={onIntent} aria-label={`${flow.flowNo}: ${kg(flow.purchasedWeightKg)} yarn used, ${where.label}`}>
      <span className="production-ledger__date">
        <small>Started</small>{shortDate(flow.purchaseDate)}
        {inStep !== null && <StepAge days={inStep} stuck={isStuck(flow)} />}
      </span>
      <span className="production-ledger__identity">
        <strong>{flow.flowNo}</strong>
        <small>{originOf(flow)}</small>
      </span>
      <span className="production-ledger__weight">
        <small>{flow.parent ? "Grey fabric" : isKnitting(flow) ? "Yarn given" : "Yarn used"}</small>{kg(flow.purchasedWeightKg)}
        {/* In process after knitting: the weight now against what went in (a batch split into dyeing lots, or one
            already delivered, no longer holds its whole weight, so it would read as a loss). */}
        {inStep !== null && !isKnitting(flow) && flow.status !== "PURCHASED" && flow.lots.length === 0 && (
          <span className="production-ledger__now">
            now {kg(flow.metrics.currentWeightKg)}
            {Math.abs(change) > 0.0005 && flow.purchasedWeightKg > 0 && <b className={change < 0 ? "is-loss" : "is-gain"}>{change < 0 ? "−" : "+"}{((Math.abs(change) / flow.purchasedWeightKg) * 100).toFixed(1)}%</b>}
          </span>
        )}
      </span>
      <span className="production-ledger__status"><Pill tone={where.tone} live={processRunning(flow)}>{where.label}</Pill><small>{where.place}</small></span>
      <span className="production-ledger__progress" aria-hidden>
        <span className="production-rail">{railSteps.map((s, i) => <span key={s} className={cn(i < railDone && "is-done", i === railNow && "is-now")} />)}</span>
        <span className="production-rail-labels">{railSteps.map((s, i) => <span key={s} className={cn(i < railDone && "is-done", i === railNow && "is-now")}>{s}</span>)}</span>
      </span>
      <span className="production-ledger__open">Open <ArrowRight size={14} /></span>
    </button>
  );
}

/** Everything about one batch: its journey, process forms, documents, weights and production costs. */
function BatchView({ flow, directory, reload, onBack, managerMode = false, startInStage }: { flow: FabricFlow; directory: FlowDirectory; reload: () => Promise<void>; onBack: () => void; managerMode?: boolean; startInStage?: CardKey }) {
  const where = whereIs(flow);
  const ended = completedInWarehouse(flow);
  const [activeStage, setActiveStage] = useState<StageKey>(managerMode ? "knitting" : startInStage === "delivery" ? "compacting" : startInStage ?? where.next ?? "compacting");
  // After a batch ended in a warehouse, the processes after that one haven't started; the next can be started from that stock.
  const startable = ended ? nextAfter[ended.stage] : null;
  const notStarted = !!ended && stages.findIndex((stage) => stage.key === activeStage) > stages.findIndex((stage) => stage.key === ended.stage);
  /** The entry window open over the batch: a process's form, or the deliveries. */
  const [modal, setModal] = useState<CardKey | null>(managerMode && isKnitting(flow) ? "knitting" : startInStage ?? null);
  /** A delivery challan open to print or share (one just issued opens by itself). */
  const [challanId, setChallanId] = useState<string | null>(null);
  const openCard = (key: CardKey) => {
    setActiveStage(key === "delivery" ? "compacting" : key);
    setNotice(null);
    setModal(key);
  };
  const openStage = (stage: StageKey) => openCard(stage === "compacting" && flow.officeDeliveryKg !== null && flow.status === "AT_OFFICE" ? "delivery" : stage);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Saves a stage and reloads the batch; the entry window closes, and a delivery challan the save issued (the fabric
   * left for the next process, a warehouse or a party) opens to print. Resolves true when saved.
   */
  const run: RunStage = async (action, next) => {
    setSaving(true);
    setNotice(null);
    try {
      const before = new Set((flow.challans ?? []).map((c) => c.id));
      const saved = await action();
      const issued = (saved.challans ?? []).filter((c) => !before.has(c.id) && !c.cancelledAt);
      const text = `${saved.flowNo} saved. Weight and production cost were recalculated.`;
      setNotice({ tone: "success", text });
      toast.success(issued.length && !managerMode ? `${text} Delivery challan ${issued[issued.length - 1].challanNo} issued.` : text, "Stage saved");
      if (next) setActiveStage(next);
      setModal(null);
      // Challans are office documents (admins); a manager finishing knitting doesn't open one.
      if (issued.length && !managerMode) setChallanId(issued[issued.length - 1].id);
      await reload();
      return true;
    } catch (error) {
      // api() has already shown the error as a toast; the window repeats it at its top.
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

  const weightVariance = flow.metrics.currentWeightKg - flow.purchasedWeightKg;
  const left = leftToDeliver(flow);
  const openable: Record<CardKey, boolean> = {
    // A dyeing lot's knitting is its knitting batch's, recorded there.
    knitting: !flow.parent,
    // A knitting batch dyes while grey fabric is left that isn't in a lot.
    dyeing: (stageOpen.dyeing || stageDone.dyeing || startable === "dyeing") && (greyLeft(flow) ?? 1) > 0.0005,
    compacting: stageOpen.compacting || stageDone.compacting || startable === "compacting",
    delivery: flow.officeDeliveryKg !== null,
  };
  const actionOf = (key: CardKey) => {
    if (key === "delivery") return flow.officeDeliveryKg === null ? "After compacting" : left !== null && left > 0.0005 ? "Deliver" : "Deliveries";
    if (startable === key) return `Start ${key}`;
    if (key === "knitting" && isKnitting(flow)) return where.next === "knitting" ? where.action : "Open knitting";
    if (key === "dyeing" && dyeingLocked) return "View dyeing";
    if (stageDone[key]) return "View & edit";
    if (inProgress[key]) return `Complete ${key}`;
    if (awaitingStart[key]) return `Start ${key}`;
    return stageOpen[key] ? `Open ${key}` : "Waiting";
  };
  const modalTitle = modal === "delivery" ? "Delivery" : modal ? processName[modal] : "";

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
            {flow.parent && <Link href={`/production?batch=${encodeURIComponent(flow.parent.flowNo)}`} className="mr-3 mt-1 inline-block text-xs font-semibold text-emerald-200 underline underline-offset-2 hover:text-white">Knitting batch {flow.parent.flowNo}</Link>}
            {flow.yarnItemCode && <Link href={itemHref(flow.yarnItemCode)} className="mt-1 inline-block text-xs font-semibold text-emerald-200 underline underline-offset-2 hover:text-white">Yarn code {flow.yarnItemCode} · view full details</Link>}
            <p className="mt-1.5 text-sm text-white/70">{where.place}</p>
          </div>
          {where.next && (!managerMode || where.next === "knitting") && (
            <Button className="production-cta" onClick={() => openStage(where.next!)}>{where.action} <ArrowRight size={15} /></Button>
          )}
        </div>
        <div className="production-hero__stats">
          {isKnitting(flow) ? (
            <Glass label="Yarn given" value={kg(flow.yarnReceivedKg ?? flow.purchasedWeightKg)} note="What was used is entered when knitting finishes" />
          ) : (
            <Glass label={flow.parent ? "Grey fabric" : "Yarn used"} value={kg(flow.purchasedWeightKg)} note={managerMode ? (flow.yarnItemCode ?? undefined) : `${money(flow.yarnRatePerKg)} / KG`} />
          )}
          <Glass label="Weight now" value={kg(flow.metrics.currentWeightKg)} note={`Delivered ${kg(flow.finalDeliveredKg ?? 0)}`} />
          {isKnitting(flow) ? (
            <Glass label="Knitted so far" value={kg(flow.knittingDeliveryKg ?? 0)} note="Loss is worked out when knitting finishes, from the yarn used" />
          ) : (
            <Glass
              label="Weight variance"
              value={`${weightVariance > 0 ? "+" : weightVariance < 0 ? "−" : ""}${kg(Math.abs(weightVariance))}`}
              note={(flow.metrics.yarnReturnedKg ?? 0) > 0.0005 ? `Against the yarn used · ${kg(flow.metrics.yarnReturnedKg ?? 0)} back in the warehouse` : "Yarn used compared with current weight"}
            />
          )}
          {!managerMode && <Glass label="Production cost" value={money(flow.metrics.totalSpent)} note="Yarn, processes and other expenses" />}
        </div>
      </header>


      <div className="production-layout">
        <div className="min-w-0 space-y-5">
          <ProcessCards flow={flow} managerMode={managerMode} stateOf={stageState} openable={openable} actionOf={actionOf} onOpen={openCard} onChallan={setChallanId} />
          {!managerMode && (
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
          )}
        </div>
        <aside className="space-y-5">
          <section className="production-card">
            <CardHead eyebrow="Batch calculation" title="Weight & production cost" />
            <BatchCalculation flow={flow} active={activeStage} />
          </section>
          {!managerMode && <ExpenseLedger flow={flow} reload={reload} />}
        </aside>
      </div>

      {modal && (
        <ProcessDialog title={`${modalTitle} · ${flow.flowNo}`} caption={modal === "delivery" ? "The finished fabric to a party or a warehouse; each delivery gets its delivery challan" : `${stageState(modal)} · each finished process sends its fabric on with a delivery challan`} busy={saving} onClose={() => setModal(null)}>
          {notice?.tone === "error" && <div className="mb-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle size={17} />{notice.text}</div>}
          {modal === "delivery" ? (
            <DeliveryForm key={`delivery-${flow.updatedAt}`} flow={flow} saving={saving} run={run} onFilesChanged={() => void reload()} onChallan={setChallanId} parties={directory.deliveryParties} />
          ) : (
            <>
              {(activeStage === "knitting" || activeStage === "dyeing") && <WarehouseNotice flow={flow} stage={activeStage} />}
              {activeStage === "knitting" && <KnittingForm key={`knitting-${flow.updatedAt}`} flow={flow} directory={directory} saving={saving} run={run} onFilesChanged={() => void reload()} showPrices={!managerMode} managerMode={managerMode} />}
              {activeStage !== "knitting" && (
                startable === activeStage ? (
                  <StartProcessForm key={`start-${activeStage}-${flow.updatedAt}`} flow={flow} process={activeStage} directory={directory} saving={saving} run={run} fromWarehouse />
                ) : notStarted || !stageOpen[activeStage] ? (
                  <div className="flex gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    <Building2 className="mt-0.5 shrink-0 text-gray-400" size={17} />
                    <div>
                      <p className="font-bold">Not started</p>
                      <p className="mt-1 text-xs">{ended && startable ? `The batch's ${ended.stage === "knitting" ? "grey" : "dyed"} fabric is in ${ended.delivery.warehouse?.code ?? "the warehouse"}. Start ${startable} first; ${processName[activeStage].toLowerCase()} follows it.` : "Complete the process before it and send its fabric on first."}</p>
                    </div>
                  </div>
                ) : awaitingStart[activeStage] ? (
                  <StartProcessForm key={`start-${activeStage}-${flow.updatedAt}`} flow={flow} process={activeStage} directory={directory} saving={saving} run={run} fromWarehouse={false} />
                ) : activeStage === "dyeing" ? (
                  <DyeingForm key={`dyeing-${flow.updatedAt}`} flow={flow} directory={directory} saving={saving} run={run} onFilesChanged={() => void reload()} showPrices={!managerMode} />
                ) : (
                  <CompactingForm key={`compacting-${flow.updatedAt}`} flow={flow} directory={directory} saving={saving} run={run} onFilesChanged={() => void reload()} showPrices={!managerMode} />
                )
              )}
            </>
          )}
        </ProcessDialog>
      )}
      {challanId && <ProcessChallanDialog challanId={challanId} onClose={() => setChallanId(null)} />}
    </div>
  );
}

/** The entry window for a process or the deliveries, over the batch page (it keeps the production styles). */
function ProcessDialog({ title, caption, busy, onClose, children }: { title: string; caption: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog production-page production-modal" aria-describedby="production-modal-caption" onEscapeKeyDown={keepDialogForOpenDropdown}>
          <div className="users-dialog__head">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-bold text-[#123f35]">{title}</Dialog.Title>
              <Dialog.Description id="production-modal-caption" className="text-xs text-gray-500">{caption}</Dialog.Description>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <div className="users-dialog__body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    { key: "yarn", label: flow.parent ? "Grey fabric in" : isKnitting(flow) ? "Yarn given" : flow.yarnItemCode ? "Yarn used" : "Yarn purchased", value: yarn, accent: "is-yarn", icon: Boxes },
    { key: "knitting", label: "After knitting", value: flow.dyeingDeliveryKg, accent: "is-knitting", icon: Factory },
    { key: "dyeing", label: "After dyeing", value: flow.compactingDeliveryKg, accent: "is-dyeing", icon: Droplets },
    { key: "compacting", label: "After compacting", value: flow.officeDeliveryKg, accent: "is-compacting", icon: Sparkles },
  ];
  const max = Math.max(yarn, ...rows.map((r) => r.value ?? 0)) || 1;
  const now = flow.metrics.currentWeightKg;
  // While knitting nothing is lost yet: the fabric so far is weighed against the yarn used once it finishes.
  const knittingNow = isKnitting(flow);
  const yieldPct = yarn && !knittingNow ? (now / yarn) * 100 : 0;
  const change = now - yarn;
  const delivered = flow.finalDeliveredKg ?? 0;
  const compacted = flow.officeDeliveryKg;

  const costs = [
    { label: flow.parent ? `Grey fabric · ${flow.parent.flowNo}` : "Yarn", value: flow.metrics.yarnAmount, accent: "is-yarn" },
    { label: "Knitting", value: flow.knittingExpense, accent: "is-knitting" },
    { label: "Dyeing", value: flow.dyeingExpense, accent: "is-dyeing" },
    { label: "Compacting", value: flow.compactingExpense, accent: "is-compacting" },
    { label: "Delivery & other", value: flow.otherExpense + flow.purchaseOtherCost, accent: "is-other" },
    // A knitting batch's cost moves with its grey fabric into its dyeing lots.
    ...(flow.metrics.lots ? [{ label: `Into ${flow.metrics.lots.count} dyeing lot${flow.metrics.lots.count === 1 ? "" : "s"}`, value: -flow.metrics.lots.allocatedCost, accent: "is-other" }] : []),
  ];
  const spent = flow.metrics.totalSpent || costs.reduce((total, c) => total + c.value, 0);

  return (
    <div className="production-calc">
      <div className="production-calc__head">
        <YieldGauge pct={yieldPct} />
        <div className="min-w-0">
          <p className="production-calc__eyebrow">Weight now</p>
          <p className="production-calc__big">{kg(now)}</p>
          <p className="text-xs text-gray-500">of {kg(yarn)} {flow.parent ? "grey fabric" : knittingNow ? "yarn given · knitting" : flow.yarnItemCode ? "yarn used" : "yarn purchased"}</p>
          {(flow.metrics.yarnReturnedKg ?? 0) > 0.0005 && <p className="text-[11px] font-semibold text-sky-700">{kg(flow.metrics.yarnReturnedKg ?? 0)} yarn back in the warehouse · not a loss</p>}
          <div className="mt-2"><ChangeChip diff={yarn && !knittingNow ? change : null} /></div>
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
