import type { LucideIcon } from "lucide-react";
import { Boxes, Droplets, Factory, PackageCheck } from "lucide-react";
import { gsmText } from "@/lib/utils";
import { isCompacting, isDyeing, isKnitting, leftToDeliver, type FabricFlow } from "./types";

export type StockKind = "YARN" | "GREY_FABRIC" | "DYED_FABRIC" | "FINISHED_FABRIC";
export type MachineState = "RUNNING" | "IDLE" | "MAINTENANCE" | "BREAKDOWN";

/**
 * `/production/overview`: every machine and what the running ones knit (with the days so far and the last one),
 * the KG knitted per production day, and the material in stock by kind with every code and its warehouses.
 */
export type ProductionOverview = {
  machines: {
    total: number;
    byStatus: Record<string, number>;
    list: Array<{ id: string; code: string; name: string; type: string | null; status: MachineState; operator: { name: string; mobile: string | null } | null }>;
    running: Array<{
      id: string;
      runNo: string;
      outputKg: number;
      rollCount: number;
      dayCount: number;
      yarnKg: number;
      startedAt: string;
      startShift: "DAY" | "NIGHT";
      machine: { id: string; code: string; name: string };
      operator: { name: string; mobile: string | null } | null;
      productionFlow: { flowNo: string; fabricType: string | null; fabricDiameter: string | null; fabricGsm: string | null; color: string | null; yarnItemCode: string | null; yarnCount: string } | null;
      lastDay: { date: string; outputKg: number; rollCount: number } | null;
    }>;
  };
  knitting: {
    /** Every production day this month (and at least the last two weeks) with fabric knitted. */
    days: Array<{ date: string; kg: number; rolls: number; machines: number }>;
    knittedByFlow: Array<{ flowId: string; kg: number }>;
  };
  stock: Array<{
    category: StockKind;
    kg: number;
    codes: number;
    warehouses: Array<{ id: string; code: string; name: string; kg: number }>;
    items: Array<{ itemCode: string; itemName: string; kg: number; warehouses: Array<{ id: string; code: string; name: string; kg: number }> }>;
  }>;
};
export type RunningRun = ProductionOverview["machines"]["running"][number];

export const KINDS: Record<StockKind, { label: string; icon: LucideIcon; accent: string; atProcess: string; process: string }> = {
  YARN: { label: "Yarn", icon: Boxes, accent: "is-yarn", atProcess: "at knitting", process: "Knitting" },
  GREY_FABRIC: { label: "Grey fabric", icon: Factory, accent: "is-knitting", atProcess: "at dyeing", process: "Dyeing" },
  DYED_FABRIC: { label: "Dyed fabric", icon: Droplets, accent: "is-dyeing", atProcess: "at compacting", process: "Compacting" },
  FINISHED_FABRIC: { label: "Finished fabric", icon: PackageCheck, accent: "is-delivery", atProcess: "ready to deliver", process: "Ready" },
};
export const KIND_KEYS = Object.keys(KINDS) as StockKind[];

export const MACHINE_STATES: Record<MachineState, { label: string; tone: string }> = {
  RUNNING: { label: "Running", tone: "is-running" },
  IDLE: { label: "Idle", tone: "is-idle" },
  BREAKDOWN: { label: "Under repair", tone: "is-repair" },
  MAINTENANCE: { label: "Maintenance", tone: "is-service" },
};
export const MACHINE_STATE_KEYS = Object.keys(MACHINE_STATES) as MachineState[];

/** The warehouse's stock of one kind, across every warehouse or in one. */
export const stockHref = (category: StockKind, warehouseId?: string) => `/warehouses?category=${category}&warehouse=${warehouseId ?? "all"}`;
export const batchHref = (flowNo: string) => `/production?batch=${encodeURIComponent(flowNo)}`;
export const fabricName = (f: { fabricType: string | null; fabricDiameter: string | null; fabricGsm: string | null }) =>
  [f.fabricType, f.fabricDiameter && `${f.fabricDiameter} dia`, gsmText(f.fabricGsm)].filter(Boolean).join(" · ");

export type OutInProcess = { kind: StockKind; at: string; kg: number; flow: FabricFlow };

/** Where each batch's material is out of the warehouses: its kind, the mill holding it and the weight. */
export function materialOut(flows: FabricFlow[]): OutInProcess[] {
  return flows.flatMap((f): OutInProcess[] => {
    if (isKnitting(f)) return [{ kind: "YARN", at: f.knittingMillDetails || "Knitting", kg: f.yarnReceivedKg ?? f.purchasedWeightKg, flow: f }];
    if (isDyeing(f)) return [{ kind: "GREY_FABRIC", at: f.dyeingMillDetails || "Dyeing", kg: f.fabricReceivedKg ?? f.dyeingDeliveryKg ?? 0, flow: f }];
    if (isCompacting(f)) return [{ kind: "DYED_FABRIC", at: f.compactingMillDetails || "Compacting", kg: f.compactingReceivedKg ?? f.compactingDeliveryKg ?? 0, flow: f }];
    const ready = leftToDeliver(f) ?? 0;
    return ready > 0 ? [{ kind: "FINISHED_FABRIC", at: "Ready to deliver", kg: ready, flow: f }] : [];
  });
}

export const outKgOf = (out: OutInProcess[], kind: StockKind) => out.filter((o) => o.kind === kind).reduce((sum, o) => sum + o.kg, 0);

export type FabricGroup = { key: string; name: string; color: string | null; kg: number; batches: FabricFlow[]; stages: number[] };

/** Fabric being made, by type and colour, with its weight at each process (knitting, dyeing, compacting, ready). */
export function fabricGroups(out: OutInProcess[]): FabricGroup[] {
  const groups = new Map<string, FabricGroup>();
  for (const o of out) {
    const f = o.flow;
    if (!f.fabricType) continue;
    const name = fabricName(f);
    const key = `${name}|${f.color ?? ""}`;
    const row = groups.get(key) ?? { key, name, color: f.color, kg: 0, batches: [], stages: [0, 0, 0, 0] };
    const weight = o.kind === "YARN" ? f.metrics.currentWeightKg : o.kg;
    row.kg += weight;
    row.batches.push(f);
    row.stages[KIND_KEYS.indexOf(o.kind)] += weight;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.kg - a.kg);
}

/** The material out at each mill (or ready at the office), the largest first. */
export function byMill(out: OutInProcess[]) {
  const mills = new Map<string, { at: string; kg: number; items: OutInProcess[] }>();
  for (const o of out) {
    const key = `${o.kind}|${o.at}`;
    const row = mills.get(key) ?? { at: o.at, kg: 0, items: [] };
    row.kg += o.kg;
    row.items.push(o);
    mills.set(key, row);
  }
  return [...mills.values()].sort((a, b) => b.kg - a.kg);
}
