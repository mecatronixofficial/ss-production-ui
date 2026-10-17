import { kg } from "@/lib/utils";
export type FlowStatus = "PURCHASED" | "KNITTING" | "DYEING" | "COMPACTING" | "AT_OFFICE" | "DELIVERED";
export type FlowSource = "PURCHASE" | "STOCK";
export type KnittingMillType = "OWN" | "OTHER";
export type ProcessDeliveryDestination = "NEXT_PROCESS" | "WAREHOUSE";
/** The processes recorded on a batch; deliveries of the compacted fabric are part of compacting. */
export type StageKey = "knitting" | "dyeing" | "compacting";
export type AttachmentStage = "KNITTING" | "DYEING" | "COMPACTING" | "FINAL";

export type FlowAttachment = { id: string; stage: AttachmentStage; fileName: string; mimeType: string; sizeBytes: number; createdAt: string };

/** Finished fabric sent to a party (typed name) or into a warehouse (where it is stock under the batch code). */
export type FlowDelivery = {
  id: string;
  deliveredAt: string;
  /** "CUSTOMER" is a delivery to a party; the value keeps its old name. */
  destination: "CUSTOMER" | "WAREHOUSE";
  partyName: string | null;
  warehouse: { code: string; name: string } | null;
  weightKg: string;
  amount: string;
  expense: string;
  notes: string | null;
  processStage: "KNITTING" | "DYEING" | "FINAL";
  /** Fabric sent to a warehouse is stock only once the warehouse receives it. */
  receivedAt: string | null;
  receivedWeightKg: string | null;
};

export type FlowMetrics = {
  currentWeightKg: number;
  yarnAmount: number;
  yarnLossKg: number;
  knittingLossKg: number;
  dyeingLossKg: number;
  compactingLossKg: number;
  balanceFabricKg: number;
  totalLossKg: number;
  lossPct: number;
  totalSpent: number;
  additionalExpenses: number;
  profit: number;
};

export type FlowExpense = { id: string; expenseDate: string; category: string; description: string | null; amount: string; createdAt: string };

/**
 * A production batch, tracked through every process by its item code. New batches start when knitting takes
 * yarn from a warehouse (`yarnItemCode`…); older ones started with a purchase entry. PI numbers are not used.
 */
export type FabricFlow = {
  id: string;
  /** Changes whenever the batch itself is saved (not when files or expenses are added). */
  updatedAt: string;
  /** Batch code, e.g. SS-2026-003 (the yarn's code) or SS-2026-003-2. */
  flowNo: string;
  status: FlowStatus;
  source: FlowSource;
  yarnItemCode: string | null;
  yarnWarehouseId: string | null;
  yarnWarehouse: { code: string; name: string } | null;
  yarnLotNo: string | null;
  fabricType: string | null;
  fabricDiameter: string | null;
  /** Grams per square metre, as typed (e.g. "180"). */
  fabricGsm: string | null;
  /** Knitting start date on new batches; purchase date on older ones. */
  purchaseDate: string;
  partyDetails: string | null;
  millDetails: string | null;
  /** The yarn's name. */
  yarnCount: string;
  bagCount: number;
  /** Yarn used (new batches) or purchased (older ones), KG. */
  purchasedWeightKg: number;
  yarnRatePerKg: number;
  purchaseOtherCost: number;
  deliveryPlace: string | null;
  knittingDate: string | null;
  /** OWN creates an internal machine task; OTHER is completed from the office's manual record. */
  knittingMillType: KnittingMillType;
  knittingExpectedFinishDate: string | null;
  knittingFinishedAt: string | null;
  knittingPartyDetails: string | null;
  knittingMillDetails: string | null;
  knittingGg: string | null;
  knittingLl: string | null;
  yarnReceivedKg: number | null;
  /** Knitted total weight. */
  knittingDeliveryKg: number | null;
  knittingBagCount: number | null;
  knittingDeliveryPlace: string | null;
  knittingDestination: ProcessDeliveryDestination;
  knittingDestinationWarehouseId: string | null;
  knittingNotes: string | null;
  knittingExpense: number;
  dyeingDeliveryKg: number | null;
  /** When dyeing started (party, mill and fabric received recorded). */
  dyeingDate: string | null;
  /** When dyeing was completed (output recorded and sent on). */
  dyeingFinishedAt: string | null;
  dyeingIssueTxnId: string | null;
  dyeingPartyDetails: string | null;
  dyeingMillDetails: string | null;
  fabricReceivedKg: number | null;
  dyeingGreyWeightKg: number | null;
  color: string | null;
  dyeingCount: string | null;
  rollCount: number | null;
  dyeingOutputWeightKg: number | null;
  dyeingExpense: number;
  dyeingNotes: string | null;
  compactingDeliveryKg: number | null;
  dyeingDestination: ProcessDeliveryDestination;
  dyeingDestinationWarehouseId: string | null;
  /** When compacting started (party, mill and weight received recorded). */
  compactingDate: string | null;
  /** When compacting was completed (compacted weight recorded). */
  compactingFinishedAt: string | null;
  compactingIssueTxnId: string | null;
  compactingPartyDetails: string | null;
  compactingMillDetails: string | null;
  compactingInwardNo: string | null;
  compactingReceivedKg: number | null;
  compactingOutwardNo: string | null;
  /** Compacted weight: the finished fabric ready to deliver (named after the office it used to go to). */
  officeDeliveryKg: number | null;
  compactingExpense: number;
  compactingNotes: string | null;
  finalDate: string | null;
  finalDeliveredKg: number | null;
  collectedAmount: number;
  otherExpense: number;
  notes: string | null;
  attachments: FlowAttachment[];
  /** Totals are in `finalDeliveredKg`, `collectedAmount`, `otherExpense`; older batches have totals only. */
  deliveries: FlowDelivery[];
  processDeliveries: FlowDelivery[];
  expenses: FlowExpense[];
  metrics: FlowMetrics;
};

export type FlowDirectory = { dealers: string[]; mills: string[]; knittingMills: string[]; dyeingMills: string[]; compactingMills: string[]; yarnStocks: string[]; fabricStocks: string[]; deliveryParties?: string[] };

/** Knitting has started but not finished: the yarn is at the knitting party. */
export const isKnitting = (flow: FabricFlow) => flow.status === "KNITTING" && flow.knittingFinishedAt === null;
/** Dyeing has started but isn't completed: the grey fabric is at the dyeing party. */
export const isDyeing = (flow: FabricFlow) => flow.dyeingDate !== null && !flow.dyeingFinishedAt && flow.dyeingOutputWeightKg === null;
/** Compacting has started but isn't completed: the dyed fabric is at the compacting party. */
export const isCompacting = (flow: FabricFlow) => flow.compactingDate !== null && !flow.compactingFinishedAt && flow.officeDeliveryKg === null;
/**
 * Weight goes up or down by up to this much in each process (1000 KG in: about 900–1100 KG out is normal).
 * Must match WEIGHT_TOLERANCE_KG in the API, which refuses more than this over the input.
 */
export const WEIGHT_TOLERANCE_KG = 100;

/**
 * How a process's output compares with its input: `over` is refused (more than the tolerance gained),
 * `bigLoss` is allowed but worth a second look, `gain` / `loss` are normal.
 */
export function weightCheck(input: number, output: number): { kind: "none" | "gain" | "loss" | "over" | "bigLoss"; diff: number; message: string | null } {
  if (!(input > 0) || !(output > 0)) return { kind: "none", diff: 0, message: null };
  const diff = output - input;
  if (diff > WEIGHT_TOLERANCE_KG + 0.0005) {
    return { kind: "over", diff, message: `More than ${kg(WEIGHT_TOLERANCE_KG)} over the ${kg(input)} that went in (up to ${kg(input + WEIGHT_TOLERANCE_KG)})` };
  }
  if (-diff > WEIGHT_TOLERANCE_KG + 0.0005) return { kind: "bigLoss", diff, message: `${kg(-diff)} less than went in: more than the usual ${kg(WEIGHT_TOLERANCE_KG)}, check the weights` };
  return { kind: diff > 0.0005 ? "gain" : diff < -0.0005 ? "loss" : "none", diff, message: null };
}

/** Compacted fabric not yet delivered (null until compacting is recorded). */
export const leftToDeliver = (flow: FabricFlow) =>
  flow.officeDeliveryKg === null ? null : Math.max(0, flow.officeDeliveryKg - (flow.finalDeliveredKg ?? 0));

/** Where a process's output went into a warehouse instead of on to the next process. */
export const warehouseDelivery = (flow: FabricFlow, stage: "KNITTING" | "DYEING") =>
  flow.processDeliveries.find((delivery) => delivery.processStage === stage && delivery.destination === "WAREHOUSE") ?? null;

type WarehouseHandOff = { stage: "knitting" | "dyeing"; delivery: FlowDelivery };

/** Knitting / dyeing output still being received in a warehouse: the process can be corrected until it is. */
export function sentToWarehouse(flow: FabricFlow): WarehouseHandOff | null {
  const knitted = warehouseDelivery(flow, "KNITTING");
  if (knitted && !knitted.receivedAt && flow.dyeingDate === null && !flow.dyeingIssueTxnId) return { stage: "knitting", delivery: knitted };
  const dyed = warehouseDelivery(flow, "DYEING");
  if (dyed && !dyed.receivedAt && flow.compactingDate === null && !flow.compactingIssueTxnId) return { stage: "dyeing", delivery: dyed };
  return null;
}

/**
 * The batch ended in a warehouse: knitting or dyeing delivered its output there and the warehouse received it, so
 * no later process follows (unless that stock is later started on the next process, which continues the batch).
 */
export function completedInWarehouse(flow: FabricFlow): WarehouseHandOff | null {
  const knitted = warehouseDelivery(flow, "KNITTING");
  if (knitted?.receivedAt && flow.dyeingDate === null && !flow.dyeingIssueTxnId) return { stage: "knitting", delivery: knitted };
  const dyed = warehouseDelivery(flow, "DYEING");
  if (dyed?.receivedAt && flow.compactingDate === null && !flow.compactingIssueTxnId) return { stage: "dyeing", delivery: dyed };
  return null;
}

/** Knitting details can be corrected until dyeing receives the fabric. */
export const knittingEditable = (flow: FabricFlow) => flow.status === "KNITTING" && flow.fabricReceivedKg === null && !flow.processDeliveries.some((delivery) => delivery.processStage === "KNITTING" && delivery.receivedAt);

export const localDate = (value?: string | null) => {
  if (value) return value.slice(0, 10);
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
export const numeric = (value: string) => Number(value || 0);
export const shortDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : null;
