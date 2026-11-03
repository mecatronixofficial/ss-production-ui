"use client";

import Link from "next/link";
import { ArrowRight, Boxes, Droplets, Layers, Shrink, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { cn, formatDate, gsmText, humanize, kg, money, unitQty } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { shiftText } from "../masters/machines/types";

type Shift = "DAY" | "NIGHT";
export type JourneyRun = {
  runNo: string;
  status: "RUNNING" | "FINISHED";
  fabricType: string | null;
  machine: { id: string; code: string; name: string };
  operator: string | null;
  startedAt: string;
  startShift: Shift;
  finishedAt: string | null;
  finishShift: Shift | null;
  yarnKg: number;
  outputKg: number | null;
  rollCount: number | null;
  yarns: Array<{ itemCode: string; itemName: string; kg: number; lotNo: string | null; ratePerKg: number | null }>;
  ratePerKg: number | null;
  charge: number | null;
  yarnCost: number | null;
  warehouse: string | null;
};
type Delivery = {
  id: string;
  stage: "KNITTING" | "DYEING" | "FINAL";
  deliveredAt: string;
  destination: "CUSTOMER" | "WAREHOUSE";
  to: string;
  weightKg: number;
  amount: number | null;
  expense: number | null;
  receivedAt: string | null;
  receivedWeightKg: number | null;
  notes: string | null;
};
export type JourneyBatch = {
  flowNo: string;
  status: string;
  role: "YARN" | "FABRIC" | "KNITTED" | "LOT" | "KNITTING_BATCH";
  parentFlowNo: string | null;
  fabric: { type: string | null; diameter: string | null; gsm: string | null; gg: string | null; ll: string | null; color: string | null; count: string | null };
  yarn: { itemCode: string | null; name: string; kg: number; warehouse: string | null; lotNo: string | null; ratePerKg: number | null; amount: number | null; startedAt: string };
  knitting: {
    millType: "OWN" | "OTHER";
    party: string | null;
    mill: string | null;
    startedAt: string | null;
    expectedFinish: string | null;
    finishedAt: string | null;
    rolls: number | null;
    outputKg: number | null;
    destination: "NEXT_PROCESS" | "WAREHOUSE";
    deliveryPlace: string | null;
    expense: number | null;
    runs: JourneyRun[];
  };
  dyeing: { party: string | null; mill: string | null; startedAt: string | null; finishedAt: string | null; receivedKg: number | null; outputKg: number | null; sentKg: number | null; color: string | null; rolls: number | null; destination: string; expense: number | null } | null;
  compacting: { party: string | null; mill: string | null; startedAt: string | null; finishedAt: string | null; receivedKg: number | null; outputKg: number | null; inwardNo: string | null; outwardNo: string | null; expense: number | null } | null;
  handOffs: Delivery[];
  deliveries: Delivery[];
  totals: { currentKg: number; lossKg: number; lossPct: number; deliveredKg: number; leftKg: number; spent: number | null; collected: number | null; profit: number | null };
};
export type JourneySale = {
  saleId: string;
  saleNo: string;
  challanNo: string | null;
  saleDate: string;
  dispatchedAt: string | null;
  party: string;
  status: "PENDING" | "REJECTED" | "DISPATCHED" | "CANCELLED";
  warehouse: string;
  itemCode: string;
  itemName: string;
  lotNo: string | null;
  unit: string;
  quantity: number;
  rate: number | null;
  amount: number | null;
};
export type MovementTotal = { txnType: string; unit: string; quantityIn: number; quantityOut: number };

/** How each kind of movement reads in the summary. */
const IN_GROUP: Record<string, string> = {
  PURCHASE_IN: "Bought (received)",
  GREY_FABRIC_IN: "Made in production",
  DYEING_OUTPUT: "Made in production",
  FINISHING_OUTPUT: "Made in production",
  PRODUCTION_IN: "Made in production",
  QC_APPROVED: "Made in production",
  TRANSFER_IN: "From other warehouses",
  RETURN_IN: "Returned",
  KNITTING_RETURN: "Returned",
};
const OUT_GROUP: Record<string, string> = {
  KNITTING_ISSUE: "Used in production",
  DYEING_ISSUE: "Used in production",
  PRODUCTION_ISSUE: "Used in production",
  DISPATCH_OUT: "Sold (dispatched)",
  TRANSFER_OUT: "To other warehouses",
  WASTE: "Waste",
};

/** Received, made, used, sold, moved and in stock: every movement of the code added up. */
export function ItemSummary({ totals }: { totals: MovementTotal[] }) {
  const rows = new Map<string, Map<string, number>>();
  const add = (label: string, unit: string, value: number) => {
    if (Math.abs(value) < 0.0005) return;
    const byUnit = rows.get(label) ?? new Map<string, number>();
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + value);
    rows.set(label, byUnit);
  };
  const stock = new Map<string, number>();
  for (const t of totals) {
    add(IN_GROUP[t.txnType] ?? "Other in", t.unit, t.quantityIn);
    add(OUT_GROUP[t.txnType] ?? "Other out", t.unit, t.quantityOut);
    stock.set(t.unit, (stock.get(t.unit) ?? 0) + t.quantityIn - t.quantityOut);
  }
  const order = ["Bought (received)", "Made in production", "From other warehouses", "Returned", "Other in", "Used in production", "Sold (dispatched)", "To other warehouses", "Waste", "Other out"];
  const text = (byUnit?: Map<string, number>) => (byUnit ? [...byUnit.entries()].map(([unit, value]) => unitQty(value, unit)).join(" · ") : "—");
  const outLabels = new Set(Object.values(OUT_GROUP).concat("Other out"));
  if (!totals.length) return null;
  return (
    <div className="journey-summary">
      {order
        .filter((label) => rows.has(label))
        .map((label) => (
          <div key={label} className={cn("journey-summary__tile", outLabels.has(label) ? "is-out" : "is-in")}>
            <p className="journey-summary__label">{label}</p>
            <p className="journey-summary__value">{text(rows.get(label))}</p>
          </div>
        ))}
      <div className="journey-summary__tile is-stock">
        <p className="journey-summary__label">In stock now</p>
        <p className="journey-summary__value">{text(stock) || "Nothing"}</p>
      </div>
    </div>
  );
}

const Fact = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) =>
  value === null || value === undefined || value === "" ? null : (
    <div className="journey-fact">
      <span className="journey-fact__label">{label}</span>
      <span className={cn("journey-fact__value", tone)}>{value}</span>
    </div>
  );

const change = (input: number | null | undefined, output: number | null | undefined) => {
  if (input === null || input === undefined || output === null || output === undefined || !input) return null;
  const diff = output - input;
  if (Math.abs(diff) < 0.0005) return "No change";
  return `${diff > 0 ? "+" : "−"}${kg(Math.abs(diff))} (${((Math.abs(diff) / input) * 100).toFixed(2)}%)`;
};

/** Machine runs as a table: machine, operator, start and finish with shifts, kg in and out, rolls, rate and charge. */
export function RunsTable({ runs, showPrices }: { runs: JourneyRun[]; showPrices: boolean }) {
  return (
    <div className="journey-table overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <th>Run</th><th>Machine</th><th>Operator</th><th>Started</th><th>Finished</th>
            <th className="text-right">Yarn</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th>
            {showPrices && <th className="text-right">Rate</th>}
            {showPrices && <th className="text-right">Charge</th>}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runNo}>
              <td>
                <Link href={`/masters/machines/run?code=${encodeURIComponent(r.runNo)}`} className="font-mono font-semibold text-[#1b3c55] hover:underline">{r.runNo}</Link>
                <span className="block text-[11px] text-gray-500">{r.yarns.map((y) => `${y.itemCode} ${kg(y.kg)}`).join(" + ")}</span>
              </td>
              <td><Link href={`/masters/machines/${r.machine.id}`} className="font-semibold hover:underline">{r.machine.code}</Link><span className="block text-[11px] text-gray-500">{r.machine.name}</span></td>
              <td>{r.operator ?? "—"}</td>
              <td className="whitespace-nowrap">{shiftText(r.startedAt, r.startShift)}</td>
              <td className="whitespace-nowrap">{r.finishedAt && r.finishShift ? shiftText(r.finishedAt, r.finishShift) : <Badge tone="warning">Knitting</Badge>}</td>
              <td className="whitespace-nowrap text-right">{kg(r.yarnKg)}</td>
              <td className="whitespace-nowrap text-right font-semibold">{r.outputKg !== null ? kg(r.outputKg) : "—"}{r.outputKg !== null && <span className="block text-[11px] font-normal text-gray-500">{change(r.yarnKg, r.outputKg)}</span>}</td>
              <td className="text-right">{r.rollCount ?? "—"}</td>
              {showPrices && <td className="whitespace-nowrap text-right">{r.ratePerKg !== null ? `${money(r.ratePerKg)}/kg` : "—"}</td>}
              {showPrices && <td className="whitespace-nowrap text-right font-semibold">{r.charge !== null ? money(r.charge) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step({ icon: Icon, tone, title, when, children }: { icon: typeof Boxes; tone: string; title: string; when?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className={cn("journey-step", tone)}>
      <span className="journey-step__node"><Icon size={15} /></span>
      <div className="min-w-0 flex-1">
        <p className="journey-step__title">{title}{when && <span className="journey-step__when">{when}</span>}</p>
        <div className="journey-step__body">{children}</div>
      </div>
    </li>
  );
}

const dates = (from: string | null | undefined, to: string | null | undefined, running = "in progress") =>
  from ? `${formatDate(from)} → ${to ? formatDate(to) : running}` : null;
const ROLE: Record<JourneyBatch["role"], string> = {
  YARN: "Made from this yarn",
  FABRIC: "This fabric's batch",
  KNITTED: "Knitted on this code's run",
  LOT: "Dyeing lot of this batch",
  KNITTING_BATCH: "This lot's knitting batch",
};

/** One production batch from yarn to delivery: every process, machine, date, weight and (for admins) cost. */
export function BatchJourney({ batch: b, itemCode, showPrices }: { batch: JourneyBatch; itemCode: string; showPrices: boolean }) {
  const f = b.fabric;
  const k = b.knitting;
  // The dia is labelled (as elsewhere), so "23 dia" can't be mistaken for a count of 23.
  const spec = [f.type, f.diameter && (/dia/i.test(f.diameter) ? f.diameter : `${f.diameter} dia`), gsmText(f.gsm), f.gg && `GG ${f.gg}`, f.ll && `LL ${f.ll}`, f.color, f.count].filter(Boolean) as string[];
  const deliveryRows = [...b.handOffs, ...b.deliveries];
  return (
    <article className="journey-batch">
      <header className="journey-batch__head">
        <div className="min-w-0">
          <p className="journey-batch__role">{ROLE[b.role]}</p>
          <Link href={`/production?batch=${encodeURIComponent(b.flowNo)}`} className="journey-batch__code">{b.flowNo} <ArrowRight size={14} className="inline" /></Link>
          {spec.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{spec.map((s, i) => <span key={`${i}-${s}`} className="journey-chip">{s}</span>)}</p>}
        </div>
        <Badge tone={b.status === "DELIVERED" ? "success" : b.status === "AT_OFFICE" ? "info" : "warning"}>{b.status === "AT_OFFICE" ? "Ready to deliver" : humanize(b.status)}</Badge>
      </header>

      <div className="journey-batch__totals">
        <Fact label="Yarn in" value={kg(b.yarn.kg)} />
        <Fact label="Weight now" value={kg(b.totals.currentKg)} />
        <Fact label="Loss" value={b.totals.lossKg > 0.0005 ? `${kg(b.totals.lossKg)} (${b.totals.lossPct.toFixed(2)}%)` : "None"} tone={b.totals.lossKg > 0.0005 ? "text-rose-700" : undefined} />
        <Fact label="Delivered" value={kg(b.totals.deliveredKg)} />
        <Fact label="Left to deliver" value={b.totals.leftKg > 0.0005 ? kg(b.totals.leftKg) : null} />
        {showPrices && <Fact label="Production cost" value={b.totals.spent !== null ? money(b.totals.spent) : null} />}
        {showPrices && <Fact label="Collected" value={b.totals.collected !== null ? money(b.totals.collected) : null} />}
        {showPrices && b.totals.profit !== null && <Fact label="Profit" value={money(b.totals.profit)} tone={b.totals.profit < 0 ? "text-rose-700" : "text-emerald-700"} />}
      </div>

      <ol className="journey-steps">
        <Step icon={Boxes} tone="is-yarn" title="Yarn" when={formatDate(b.yarn.startedAt)}>
          <div className="journey-facts">
            <Fact
              label="Yarn code"
              value={b.yarn.itemCode ? (b.yarn.itemCode === itemCode ? b.yarn.itemCode : <Link href={`/warehouses/item?code=${encodeURIComponent(b.yarn.itemCode)}`} className="text-[#1b3c55] hover:underline">{b.yarn.itemCode}</Link>) : "From a purchase"}
            />
            <Fact label="Yarn" value={b.yarn.name} />
            <Fact label="Weight" value={kg(b.yarn.kg)} />
            <Fact label="Taken from" value={[b.yarn.warehouse, b.yarn.lotNo && `lot ${b.yarn.lotNo}`].filter(Boolean).join(" · ") || null} />
            {showPrices && <Fact label="Price" value={b.yarn.ratePerKg !== null ? `${money(b.yarn.ratePerKg)}/kg = ${money(b.yarn.amount ?? 0)}` : null} />}
          </div>
        </Step>

        <Step icon={Layers} tone="is-knitting" title={`Knitting · ${k.millType === "OWN" ? "own machines" : "other mill"}`} when={dates(k.startedAt, k.finishedAt)}>
          <div className="journey-facts">
            <Fact label="Party · mill" value={[k.party, k.mill].filter(Boolean).join(" · ") || null} />
            <Fact label="Expected finish" value={!k.finishedAt && k.expectedFinish ? formatDate(k.expectedFinish) : null} />
            <Fact label="Grey fabric" value={k.outputKg !== null ? kg(k.outputKg) : null} />
            <Fact label="Change" value={change(b.yarn.kg, k.outputKg)} />
            <Fact label="Rolls" value={k.rolls} />
            <Fact label="Sent to" value={k.finishedAt ? (k.destination === "WAREHOUSE" ? `Warehouse ${k.deliveryPlace ?? ""}` : (k.deliveryPlace ?? "Dyeing")) : null} />
            {showPrices && <Fact label="Knitting charges" value={k.expense !== null && k.expense > 0 ? money(k.expense) : null} />}
          </div>
          {k.runs.length > 0 && <RunsTable runs={k.runs} showPrices={showPrices} />}
        </Step>

        {b.dyeing && (
          <Step icon={Droplets} tone="is-dyeing" title="Dyeing" when={dates(b.dyeing.startedAt, b.dyeing.finishedAt)}>
            <div className="journey-facts">
              <Fact label="Dyed at" value={[b.dyeing.party, b.dyeing.mill !== b.dyeing.party && b.dyeing.mill].filter(Boolean).join(" · ") || null} />
              <Fact label="Fabric received" value={b.dyeing.receivedKg !== null ? kg(b.dyeing.receivedKg) : null} />
              <Fact label="Dyed output" value={b.dyeing.outputKg !== null ? kg(b.dyeing.outputKg) : null} />
              <Fact label="Change" value={change(b.dyeing.receivedKg, b.dyeing.outputKg)} />
              <Fact label="Colour" value={b.dyeing.color} />
              <Fact label="Rolls" value={b.dyeing.rolls} />
              <Fact label={b.dyeing.destination === "WAREHOUSE" ? "Sent to warehouse" : "Sent to compacting"} value={b.dyeing.sentKg !== null ? kg(b.dyeing.sentKg) : null} />
              {showPrices && <Fact label="Dyeing cost" value={b.dyeing.expense !== null && b.dyeing.expense > 0 ? money(b.dyeing.expense) : null} />}
            </div>
          </Step>
        )}

        {b.compacting && (
          <Step icon={Shrink} tone="is-compacting" title="Compacting" when={dates(b.compacting.startedAt, b.compacting.finishedAt)}>
            <div className="journey-facts">
              <Fact label="Compacted at" value={[b.compacting.party, b.compacting.mill !== b.compacting.party && b.compacting.mill].filter(Boolean).join(" · ") || null} />
              <Fact label="Received" value={b.compacting.receivedKg !== null ? kg(b.compacting.receivedKg) : null} />
              <Fact label="Compacted" value={b.compacting.outputKg !== null ? kg(b.compacting.outputKg) : null} />
              <Fact label="Change" value={change(b.compacting.receivedKg, b.compacting.outputKg)} />
              <Fact label="Inward · outward" value={[b.compacting.inwardNo, b.compacting.outwardNo].filter(Boolean).join(" · ") || null} />
              {showPrices && <Fact label="Compacting cost" value={b.compacting.expense !== null && b.compacting.expense > 0 ? money(b.compacting.expense) : null} />}
            </div>
          </Step>
        )}

        {deliveryRows.length > 0 && (
          <Step icon={Truck} tone="is-delivery" title="Deliveries & warehouses">
            <div className="journey-table overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead><tr><th>Date</th><th>What</th><th>To</th><th className="text-right">Weight</th><th>Status</th>{showPrices && <th className="text-right">Collected</th>}</tr></thead>
                <tbody>
                  {deliveryRows.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">{formatDate(d.deliveredAt)}</td>
                      <td>{d.stage === "KNITTING" ? "Grey fabric" : d.stage === "DYEING" ? "Dyed fabric" : "Finished fabric"}</td>
                      <td>
                        <span className="inline-flex items-center gap-1">{d.destination === "WAREHOUSE" ? <WarehouseIcon size={13} className="text-gray-400" /> : <Truck size={13} className="text-gray-400" />}{d.to}</span>
                        {d.notes && <span className="block text-[11px] text-gray-500">{d.notes}</span>}
                      </td>
                      <td className="whitespace-nowrap text-right font-semibold">{kg(d.receivedWeightKg ?? d.weightKg)}</td>
                      <td>
                        {d.destination === "CUSTOMER" ? <Badge tone="success">Delivered</Badge> : d.receivedAt ? <Badge tone="success">Received {formatDate(d.receivedAt)}</Badge> : <Badge tone="warning">On the way</Badge>}
                      </td>
                      {showPrices && <td className="whitespace-nowrap text-right">{d.amount !== null && d.amount > 0 ? money(d.amount) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Step>
        )}
      </ol>
    </article>
  );
}

/** Every sale of the code and of fabric made from it. */
export function SalesTable({ sales, itemCode, showPrices }: { sales: JourneySale[]; itemCode: string; showPrices: boolean }) {
  return (
    <div className="journey-table overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <th>Date</th><th>Bill / challan</th><th>Party</th><th>Item</th><th>From</th><th className="text-right">Quantity</th>
            {showPrices && <th className="text-right">Rate</th>}
            {showPrices && <th className="text-right">Amount</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, index) => (
            <tr key={`${s.saleId}-${s.itemCode}-${index}`}>
              <td className="whitespace-nowrap">{formatDate(s.dispatchedAt ?? s.saleDate)}</td>
              <td className="whitespace-nowrap">
                {showPrices ? <Link href={`/sales/${s.saleId}`} className="font-semibold text-[#1b3c55] hover:underline">{s.saleNo}</Link> : <b>{s.saleNo}</b>}
                {s.challanNo && <span className="block text-[11px] text-gray-500">{s.challanNo}</span>}
              </td>
              <td>{s.party}</td>
              <td>
                {s.itemCode === itemCode ? <span className="font-mono text-xs">{s.itemCode}</span> : <Link href={`/warehouses/item?code=${encodeURIComponent(s.itemCode)}`} className="font-mono text-xs text-[#1b3c55] hover:underline">{s.itemCode}</Link>}
                <span className="block text-[11px] text-gray-500">{s.itemName}{s.lotNo ? ` · lot ${s.lotNo}` : ""}</span>
              </td>
              <td>{s.warehouse}</td>
              <td className="whitespace-nowrap text-right font-semibold">{unitQty(s.quantity, s.unit)}</td>
              {showPrices && <td className="whitespace-nowrap text-right">{s.rate !== null ? money(s.rate) : "—"}</td>}
              {showPrices && <td className="whitespace-nowrap text-right font-semibold">{s.amount !== null ? money(s.amount) : "—"}</td>}
              <td><Badge tone={s.status === "DISPATCHED" ? "success" : s.status === "REJECTED" ? "danger" : "warning"}>{s.status === "DISPATCHED" ? "Dispatched" : s.status === "REJECTED" ? "Sent back" : "Waiting"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

