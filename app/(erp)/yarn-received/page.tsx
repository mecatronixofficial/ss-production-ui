"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown, CircleDot, GitBranch, ChevronLeft, ChevronRight, Download, FileText, Info, PackagePlus, Pencil, Printer, Search, Trash2, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { downloadCsv } from "@/lib/csv";
import { ADMIN_ROLES, GODOWN_EDIT_ROLES } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { ATTENTION_KINDS, type AttentionKind } from "@/lib/attention";
import { cn, formatDate, kg, money } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { ReceiveCheck } from "@/components/ui/receive-check";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ReceivedChallanDialog } from "@/components/received-challan";
import { StockBillDialog } from "@/components/stock-bill";
import { itemHref } from "../warehouses/item-details";
import type { YarnStory } from "../warehouses/yarn-story";
import { YarnTree } from "../warehouses/yarn-tree";
import { ReceiveYarnDialog, type YarnReceipt } from "./receive-yarn-dialog";
import "./yarn-received.css";

/** A knitting batch a received yarn went into. */
type Knit = { flowNo: string; fabric: string; mill: string | null; startedAt: string | null; done: boolean; yarnKg: number; fabricKg: number | null; colours: number };
type Row = {
  key: string;
  source: "REGISTER" | "PURCHASE";
  receiptId: string;
  receiptNo: string;
  poNo: string | null;
  date: string;
  dcNo: string;
  mill: string;
  agent: string | null;
  warehouse: { id: string; code: string; name: string };
  vehicleNo: string | null;
  notes: string | null;
  count: string;
  bags: string | null;
  bagCount: number | null;
  weightKg: number;
  dcWeightKg: number | null;
  ratePerKg: number | null;
  amount: number | null;
  itemCode: string | null;
  inStockKg: number | null;
  toKnittingKg: number | null;
  returnedKg: number | null;
  otherOutKg: number | null;
  knitting: Knit[];
  /** Its received challan: the stock challan made when it was received, or a purchase order's goods receipt. */
  challan: { kind: "STOCK" | "GRN"; id: string; no: string } | null;
};
/** `limited`: more deliveries in the period than the server lists (it lists the newest). */
type Register = { rows: Row[]; limited?: boolean };

type Mode = "all" | "month" | "range";
type State = "all" | "stock" | "partly" | "used" | "knitting";
/** Rows picked out by "needs attention". */
type Flag = "" | "short" | "idle" | "norate";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const today = () => {
  const d = new Date();
  return `${thisMonth()}-${String(d.getDate()).padStart(2, "0")}`;
};
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthName = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }).toUpperCase();
const bagsText = (r: Row) => r.bags ?? (r.bagCount !== null ? String(r.bagCount) : "");
const EMPTY = 0.0005;
const num = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
/** A timestamp as a day on this computer's calendar (IST), not UTC's. */
const dayOf = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysSince = (value: string) => {
  const from = new Date(value);
  from.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now.getTime() - from.getTime()) / 86_400_000));
};
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Rows shown at first, and how many more each "Show more" adds; printing shows them all. */
const PAGE = 150;
/** A DC weighing more than this much under its paper weight is pointed out (as the weight check marks it). */
const SHORT_PCT = 1;
/** Yarn still untouched this many days after it arrived is pointed out. */
const IDLE_DAYS = 30;

/** Where a code's yarn is now. */
const stateOf = (r: Row): Exclude<State, "all" | "knitting"> | null =>
  r.inStockKg === null ? null : r.inStockKg >= r.weightKg - EMPTY ? "stock" : r.inStockKg > EMPTY ? "partly" : "used";
const STATE_LABEL: Record<Exclude<State, "all">, string> = { stock: "In stock", partly: "Partly used", used: "Used up", knitting: "At knitting" };
const isShort = (r: Row) => r.dcWeightKg !== null && r.dcWeightKg > 0 && ((r.dcWeightKg - r.weightKg) / r.dcWeightKg) * 100 > SHORT_PCT;
const isIdle = (r: Row) => stateOf(r) === "stock" && daysSince(r.date) > IDLE_DAYS;
const atKnitting = (r: Row) => (r.toKnittingKg ?? 0) > EMPTY && r.knitting.some((k) => !k.done);

/** Where a row's yarn is now, as a small bar (in stock, at knitting, knitted) with a word or two. */
function YarnNow({ row }: { row: Row }) {
  const state = stateOf(row);
  if (!state) return <span className="text-xs text-gray-400">—</span>;
  const stock = Math.max(0, row.inStockKg ?? 0);
  const knitted = row.knitting.filter((k) => k.done).reduce((t, k) => t + k.yarnKg, 0);
  const knitting = Math.max(0, (row.toKnittingKg ?? 0) - knitted);
  const pct = (v: number) => `${row.weightKg ? Math.min(100, (v / row.weightKg) * 100) : 0}%`;
  const label = state === "stock" ? "In stock" : state === "partly" ? `${kg(stock)} left` : "Used up";
  return (
    <span className="yarn-now" title={`In stock ${kg(stock)} · at knitting ${kg(knitting)} · knitted ${kg(knitted)}`}>
      <span className={cn("yarn-state", state === "stock" ? "is-stock" : state === "partly" ? "is-part" : "is-used")}>{label}</span>
      <span className="yarn-now__bar" aria-hidden>
        <span className="is-knitted" style={{ width: pct(knitted) }} />
        <span className="is-knitting" style={{ width: pct(knitting) }} />
        <span className="is-stock" style={{ width: pct(stock) }} />
      </span>
    </span>
  );
}

/** Totals of a set of rows, and the same by count and by mill. */
function summarise(rows: Row[]) {
  const sum = (pick: (r: Row) => number) => rows.reduce((t, r) => t + pick(r), 0);
  const group = (key: (r: Row) => string) => {
    const out = new Map<string, { kg: number; bags: number; dcs: Set<string>; stock: number }>();
    for (const r of rows) {
      const g = out.get(key(r)) ?? { kg: 0, bags: 0, dcs: new Set<string>(), stock: 0 };
      g.kg += r.weightKg;
      g.bags += r.bagCount ?? 0;
      g.dcs.add(r.receiptId);
      g.stock += Math.max(0, r.inStockKg ?? 0);
      out.set(key(r), g);
    }
    return [...out].map(([name, g]) => ({ name, kg: g.kg, bags: g.bags, dcs: g.dcs.size, stock: g.stock })).sort((a, b) => b.kg - a.kg);
  };
  const priced = rows.filter((r) => r.amount !== null);
  return {
    dcs: new Set(rows.map((r) => r.receiptId)).size,
    weightKg: sum((r) => r.weightKg),
    bags: sum((r) => r.bagCount ?? 0),
    inStockKg: sum((r) => Math.max(0, r.inStockKg ?? 0)),
    toKnittingKg: sum((r) => r.toKnittingKg ?? 0),
    returnedKg: sum((r) => r.returnedKg ?? 0),
    fabricKg: sum((r) => r.knitting.reduce((t, k) => t + (k.fabricKg ?? 0), 0)),
    amount: priced.length ? priced.reduce((t, r) => t + (r.amount ?? 0), 0) : null,
    byCount: group((r) => r.count.toUpperCase()),
    byMill: group((r) => r.mill.toUpperCase()),
  };
}

/**
 * Every yarn received: S/No, date, the mill's DC no, mill, agent, count, bags and weight (rates and value for admins),
 * each count's yarn code and where its yarn is now. All of it, a month or a range of days; searched and filtered by
 * mill, count and state, with what needs attention (DCs that weighed short, yarn lying unused, codes without a rate).
 * A row opens into its full details: the delivery, the weight checked against the DC, the yarn in stock, at knitting
 * and back, and every knitting batch it went into with the fabric made. Deliveries against purchase orders are in it
 * too. Totals by count and by mill, CSV and print (printed like the paper register).
 */
export default function YarnReceivedPage() {
  const { user } = useAuth();
  const showPrices = !!user && ADMIN_ROLES.includes(user.role);
  const canEdit = !!user && GODOWN_EDIT_ROLES.includes(user.role);
  const [mode, setMode] = useState<Mode>("all");
  const [month, setMonth] = useState(thisMonth);
  const [range, setRange] = useState({ from: `${thisMonth()}-01`, to: today() });
  const query = mode === "all" ? qs({ all: "1" }) : mode === "month" ? qs({ month }) : qs({ from: range.from || undefined, to: range.to || undefined });
  // The whole register is kept for the browser tab, so coming back (or reloading) shows it at once while it refreshes.
  const { data, error, reload } = useApiQuery<Register>(`/inventory/yarn-receipts${query}`, { persist: mode === "all" ? user?.id : undefined });
  const [editing, setEditing] = useState<YarnReceipt | "new" | null>(null);
  const [find, setFind] = useState("");
  const [mill, setMill] = useState("");
  const [count, setCount] = useState("");
  const [state, setState] = useState<State>("all");
  const [flag, setFlag] = useState<Flag>("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  /** The received challan open to print or share. */
  const [challan, setChallan] = useState<Row["challan"]>(null);

  // Printing (the button or Ctrl+P) prints every row, not only the ones shown so far.
  useEffect(() => {
    const all = () => flushSync(() => setLimit(Number.POSITIVE_INFINITY));
    window.addEventListener("beforeprint", all);
    return () => window.removeEventListener("beforeprint", all);
  }, []);

  const all = useMemo(() => data?.rows ?? [], [data]);
  const mills = useMemo(() => [...new Set(all.map((r) => r.mill.toUpperCase()))].sort(), [all]);
  const counts = useMemo(() => [...new Set(all.map((r) => r.count.toUpperCase()))].sort(), [all]);
  const q = find.trim().toUpperCase();
  const rows = useMemo(() => {
    const kept = all.filter((r) => {
      if (mill && r.mill.toUpperCase() !== mill) return false;
      if (count && r.count.toUpperCase() !== count) return false;
      if (state === "knitting" && !atKnitting(r)) return false;
      if (state !== "all" && state !== "knitting" && stateOf(r) !== state) return false;
      if (flag === "short" && !isShort(r)) return false;
      if (flag === "idle" && !isIdle(r)) return false;
      if (flag === "norate" && r.ratePerKg !== null) return false;
      if (!q) return true;
      return [r.itemCode, r.count, r.mill, r.agent ?? "Direct", r.dcNo, r.receiptNo, r.poNo, r.warehouse.code, ...r.knitting.map((k) => k.flowNo)].some((v) => v?.toUpperCase().includes(q));
    });
    return newestFirst ? [...kept].reverse() : kept;
  }, [all, mill, count, state, flag, q, newestFirst]);
  const totals = useMemo(() => summarise(rows), [rows]);
  const stateCounts = useMemo(() => {
    const c: Record<State, number> = { all: all.length, stock: 0, partly: 0, used: 0, knitting: 0 };
    for (const r of all) {
      const s = stateOf(r);
      if (s) c[s] += 1;
      if (atKnitting(r)) c.knitting += 1;
    }
    return c;
  }, [all]);
  const flags = useMemo(() => {
    const short = all.filter(isShort);
    const idle = all.filter(isIdle);
    const norate = showPrices ? all.filter((r) => r.ratePerKg === null) : [];
    return { short, idle, norate };
  }, [all, showPrices]);
  const filtered = !!(q || mill || count || state !== "all" || flag);
  const shown = rows.slice(0, limit);

  // What needs someone, with what it is about (as on the Dashboard); clicking one shows just those rows.
  const attention: Array<{ flag: Exclude<Flag, "">; tone: "warning" | "info"; kind: AttentionKind; text: string }> = [];
  if (flags.short.length) {
    const lostKg = flags.short.reduce((t, r) => t + ((r.dcWeightKg ?? 0) - r.weightKg), 0);
    attention.push({ flag: "short", tone: "warning", kind: "warehouse", text: `${plural(flags.short.length, "yarn code")} weighed over ${SHORT_PCT}% less than the mill's DC · ${kg(lostKg)} short in all` });
  }
  if (flags.idle.length)
    attention.push({ flag: "idle", tone: "info", kind: "warehouse", text: `${plural(flags.idle.length, "yarn code")} received over ${IDLE_DAYS} days ago and not used yet · ${kg(flags.idle.reduce((t, r) => t + r.weightKg, 0))}` });
  if (flags.norate.length)
    attention.push({ flag: "norate", tone: "info", kind: "money", text: `${plural(flags.norate.length, "yarn code")} without a rate, so the value is incomplete` });

  const pickFlag = (next: Exclude<Flag, "">) => {
    setFlag(flag === next ? "" : next);
    setState("all");
    setLimit(PAGE);
  };

  const correct = async (receiptId: string) => setEditing(await api<YarnReceipt>(`/inventory/yarn-receipts/${receiptId}`));
  const remove = async (row: Row) => {
    const ok = await confirmDialog({
      title: `Delete DC ${row.dcNo}?`,
      description: "Every count on it leaves stock. Refused if any of its yarn has already gone to knitting.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await api(`/inventory/yarn-receipts/${row.receiptId}`, { method: "DELETE" });
    toast.success(`DC ${row.dcNo} deleted.`, "Yarn receipt deleted");
    void reload();
  };

  const periodText = mode === "all" ? "ALL" : mode === "month" ? monthName(month) : `${range.from ? formatDate(range.from) : "START"} TO ${range.to ? formatDate(range.to) : "TODAY"}`;
  const title = `YARN RECEIVED DETAIL ${periodText}${filtered ? " (FILTERED)" : ""}`;
  const exportCsv = () =>
    downloadCsv(
      `yarn-received-${mode === "month" ? month : mode === "range" ? `${range.from}-to-${range.to}` : "all"}.csv`,
      ["S/No", "Date", "DC No", "Mill name", "Agent name", "Count", "No of bags", "DC weight", "Weight", ...(showPrices ? ["Rate", "Amount"] : []), "Yarn code", "Warehouse", "In stock KG", "At knitting KG", "Back from knitting KG", "Fabric made KG", "Knitting batches"],
      rows.map((r, i) => [
        i + 1,
        dayOf(r.date),
        r.dcNo,
        r.mill,
        r.agent ?? "DIRECT",
        r.count,
        bagsText(r),
        r.dcWeightKg ?? "",
        r.weightKg,
        ...(showPrices ? [r.ratePerKg ?? "", r.amount ?? ""] : []),
        r.itemCode ?? "",
        r.warehouse.code,
        r.inStockKg ?? "",
        r.toKnittingKg ?? "",
        r.returnedKg ?? "",
        r.knitting.reduce((t, k) => t + (k.fabricKg ?? 0), 0) || "",
        r.knitting.map((k) => `${k.flowNo} ${k.fabric}`).join("; "),
      ]),
    );
  const clearFilters = () => {
    setFind("");
    setMill("");
    setCount("");
    setState("all");
    setFlag("");
    setLimit(PAGE);
  };
  const cols = 9 + (showPrices ? 2 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="purchases-page yarn-reg">
      <div className="purchases-page-header yarn-reg__noprint">
        <span className="purchases-page-icon"><PackagePlus size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold md:text-xl">Yarn received</h2>
          <p className="text-xs text-gray-500">Every yarn delivery by its mill DC: count, bags and weight, its yarn code, where that yarn is now and the fabric it made. Open a row for its full details.</p>
        </div>
        {canEdit && <Button onClick={() => setEditing("new")}><PackagePlus size={15} /> Receive yarn</Button>}
      </div>

      <div className="yarn-reg__bar yarn-reg__noprint">
        <div className="yarn-reg__modes" role="tablist" aria-label="Period">
          {([["all", "All yarn"], ["month", "By month"], ["range", "From – to"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setLimit(PAGE); }}>{label}</button>
          ))}
        </div>
        {mode === "month" && (
          <div className="yarn-reg__month" role="group" aria-label="Month">
            <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => shift(m, -1))}><ChevronLeft size={16} /></button>
            <input type="month" className="erp-input" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
            <button type="button" aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth((m) => shift(m, 1))}><ChevronRight size={16} /></button>
          </div>
        )}
        {mode === "range" && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="erp-input w-40" value={range.from} max={range.to || today()} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
            <span className="text-xs text-gray-500">to</span>
            <input type="date" className="erp-input w-40" value={range.to} min={range.from || undefined} max={today()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" disabled={!rows.length} onClick={exportCsv}><Download size={15} /> CSV</Button>
          <Button variant="outline" disabled={!rows.length} onClick={() => window.print()}><Printer size={15} /> Print</Button>
        </div>
      </div>

      {!data ? (
        error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error} <button type="button" className="underline" onClick={() => void reload()}>Try again</button></p> : <Loading />
      ) : (
        <>
          <div className="yarn-reg__tiles yarn-reg__noprint">
            <div><p>Deliveries (DC)</p><strong>{totals.dcs}</strong><span>{plural(rows.length, "yarn code")}</span></div>
            <div><p>Yarn received</p><strong>{kg(totals.weightKg)}</strong><span>{totals.bags} bags</span></div>
            <div className="is-stock"><p>In stock now</p><strong>{kg(totals.inStockKg)}</strong><span>{totals.weightKg ? `${Math.round((totals.inStockKg / totals.weightKg) * 100)}% of it still here` : "of this yarn"}</span></div>
            <div className="is-knitting"><p>Given to knitting</p><strong>{kg(totals.toKnittingKg)}</strong><span>{totals.returnedKg > EMPTY ? `${kg(totals.returnedKg)} came back` : "given, not back"}</span></div>
            <div className="is-fabric"><p>Fabric made</p><strong>{kg(totals.fabricKg)}</strong><span>from this yarn&apos;s knitting</span></div>
            {showPrices && <div><p>Value</p><strong>{totals.amount === null ? "—" : money(totals.amount)}</strong><span>where a rate was given</span></div>}
          </div>

          {attention.length > 0 && (
            <section className="dashboard-attention yarn-reg__noprint" aria-label="Needs attention">
              <ul>
                {attention.map((item) => {
                  const { icon: KindIcon, label } = ATTENTION_KINDS[item.kind];
                  const ToneIcon = item.tone === "warning" ? CircleDot : Info;
                  return (
                    <li key={item.flag}>
                      <button type="button" aria-pressed={flag === item.flag} onClick={() => pickFlag(item.flag)} className={cn("dashboard-attention__item sales-attention w-full text-left", `is-${item.tone}`)}>
                        <span className={cn("attn-icon", `is-${item.kind}`)}><KindIcon size={15} /></span>
                        <span className="dashboard-attention__text flex-1">
                          <span className={cn("attn-kind-chip", `is-${item.kind}`)}>{label}</span>
                          {item.text}
                        </span>
                        <ToneIcon size={14} className="shrink-0" aria-hidden />
                        <ArrowRight size={14} className="shrink-0 opacity-60" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="yarn-reg__filters yarn-reg__noprint">
            <label className="yarn-reg__find">
              <Search size={15} aria-hidden />
              <Input value={find} onChange={(e) => { setFind(e.target.value); setLimit(PAGE); }} placeholder="Find a yarn code, count, mill, DC, agent or knitting batch" aria-label="Find" />
            </label>
            <select className="erp-input w-44" value={mill} onChange={(e) => { setMill(e.target.value); setLimit(PAGE); }} aria-label="Mill">
              <option value="">All mills</option>
              {mills.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="erp-input w-40" value={count} onChange={(e) => { setCount(e.target.value); setLimit(PAGE); }} aria-label="Count">
              <option value="">All counts</option>
              {counts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="yarn-reg__states" role="group" aria-label="Where the yarn is">
              {(["all", "stock", "partly", "used", "knitting"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={state === s} className={cn(s !== "all" && `is-${s}`)} onClick={() => { setState(s); setLimit(PAGE); }}>
                  {s === "all" ? "All" : STATE_LABEL[s]} <b>{stateCounts[s]}</b>
                </button>
              ))}
            </div>
            <button type="button" className="yarn-reg__sort" onClick={() => setNewestFirst((v) => !v)}>{newestFirst ? "Newest first" : "Oldest first"}</button>
            {filtered && <button type="button" className="yarn-reg__clear" onClick={clearFilters}><X size={13} /> Clear</button>}
          </div>

          <section className="yarn-sheet">
            <div className="yarn-sheet__head">
              <h1 className="yarn-sheet__title">{title}</h1>
              <p className="yarn-sheet__meta yarn-reg__noprint">
                {plural(rows.length, "yarn code")} · {plural(totals.dcs, "DC")} · {kg(totals.weightKg)}
                {flag && <> · <b>{flag === "short" ? "weighed short" : flag === "idle" ? `unused over ${IDLE_DAYS} days` : "without a rate"}</b></>}
              </p>
            </div>
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">
                {all.length ? "No yarn matches." : `No yarn received${mode === "all" ? " yet" : " in this period"}.`}
                {!all.length && canEdit ? " Use Receive yarn to add a delivery." : ""}
              </p>
            ) : (
              <div className="yarn-grid__scroll">
                <table className={cn("yarn-grid", showPrices && "has-rate")}>
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Received · DC</th>
                      <th>Mill · agent</th>
                      <th>Count</th>
                      <th className="num">Bags</th>
                      <th className="num">Weight (KG)</th>
                      {showPrices && <><th className="num">Rate</th><th className="num">Amount</th></>}
                      <th>Yarn code</th>
                      <th className="yarn-reg__noprint">Where it is now</th>
                      <th className="yarn-reg__noprint">Challan</th>
                      {canEdit && <th className="yarn-reg__noprint" aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => {
                      // Further counts of the same DC leave its date, DC, mill and agent blank, as on paper.
                      const sameDc = i > 0 && shown[i - 1].receiptId === r.receiptId;
                      const isOpen = open === r.key;
                      const state = stateOf(r);
                      return (
                        <Fragment key={r.key}>
                          <tr
                            className={cn("yarn-row", sameDc ? "is-same" : "is-first", isOpen && "is-open", state && `is-${state}`, isShort(r) && "is-short")}
                            onClick={() => setOpen(isOpen ? null : r.key)}
                            aria-expanded={isOpen}
                          >
                            <td className="num yarn-grid__sno">{i + 1}</td>
                            <td>
                              {!sameDc && (
                                <>
                                  <b className="yarn-grid__date">{formatDate(r.date)}</b>
                                  <span className="yarn-grid__sub">
                                    DC <span className="font-mono">{r.dcNo || "—"}</span>
                                    {r.poNo && <span className="yarn-po yarn-reg__noprint" title={`Received on ${r.poNo} (${r.receiptNo})`}>PO</span>}
                                  </span>
                                </>
                              )}
                            </td>
                            <td>
                              {!sameDc && (
                                <>
                                  <b className="yarn-grid__mill">{r.mill.toUpperCase()}</b>
                                  <span className="yarn-grid__sub">{(r.agent ?? "Direct").toUpperCase()} · {r.warehouse.code}</span>
                                </>
                              )}
                            </td>
                            <td><span className="yarn-count">{r.count.toUpperCase()}</span></td>
                            <td className="num">{bagsText(r) || "—"}</td>
                            <td className="num">
                              <b className="yarn-grid__kg">{num(r.weightKg)}</b>
                              {r.dcWeightKg !== null && Math.abs(r.dcWeightKg - r.weightKg) > EMPTY && (
                                <span className="block yarn-reg__noprint" title={`DC ${r.dcWeightKg} KG`}><ReceiveCheck sent={r.dcWeightKg} received={r.weightKg} unit="KG" /></span>
                              )}
                            </td>
                            {showPrices && (
                              <>
                                <td className="num">{r.ratePerKg === null ? <span className="yarn-grid__missing">no rate</span> : money(r.ratePerKg)}</td>
                                <td className="num font-semibold">{r.amount === null ? "—" : money(r.amount)}</td>
                              </>
                            )}
                            <td>{r.itemCode ? <Link href={itemHref(r.itemCode)} onClick={(e) => e.stopPropagation()} className="yarn-code" title="Yarn story">{r.itemCode}</Link> : "—"}</td>
                            <td className="yarn-reg__noprint">
                              <span className="flex items-center gap-2">
                                <YarnNow row={r} />
                                <ChevronDown size={14} className={cn("shrink-0 text-gray-400 transition-transform", isOpen && "rotate-180")} aria-hidden />
                              </span>
                            </td>
                            <td className="yarn-reg__noprint" onClick={(e) => e.stopPropagation()}>
                              {!sameDc && r.challan ? (
                                <button type="button" className="yarn-challan" onClick={() => setChallan(r.challan)} title={`Open received challan ${r.challan.no} to print or share`}>
                                  <FileText size={12} aria-hidden /> {r.challan.no}
                                </button>
                              ) : sameDc ? null : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            {canEdit && (
                              <td className="yarn-reg__noprint" onClick={(e) => e.stopPropagation()}>
                                {r.source === "REGISTER" && !sameDc && (
                                  <span className="flex justify-end gap-1">
                                    <button type="button" className="yarn-icon" aria-label={`Correct DC ${r.dcNo}`} onClick={() => void correct(r.receiptId)}><Pencil size={14} /></button>
                                    <button type="button" className="yarn-icon is-danger" aria-label={`Delete DC ${r.dcNo}`} onClick={() => void remove(r)}><Trash2 size={14} /></button>
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                          {isOpen && (
                            <tr className="yarn-detail-row yarn-reg__noprint">
                              <td colSpan={cols}><YarnDetail row={r} showPrices={showPrices} onChallan={() => setChallan(r.challan)} /></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Total · {plural(totals.dcs, "DC")}{shown.length < rows.length ? ` · ${rows.length} rows` : ""}</td>
                      <td className="num">{totals.bags}</td>
                      <td className="num">{num(totals.weightKg)}</td>
                      {showPrices && <><td /><td className="num">{totals.amount === null ? "—" : money(totals.amount)}</td></>}
                      <td /><td className="yarn-reg__noprint" /><td className="yarn-reg__noprint" />{canEdit && <td className="yarn-reg__noprint" />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {shown.length < rows.length && (
              <div className="yarn-sheet__more yarn-reg__noprint">
                <span>Showing {shown.length} of {rows.length} · totals cover all of them</span>
                <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown.length)} more</Button>
                <Button size="sm" variant="ghost" onClick={() => setLimit(Number.POSITIVE_INFINITY)}>Show all</Button>
              </div>
            )}
            {data.limited && <p className="yarn-sheet__more yarn-reg__noprint text-amber-800"><AlertTriangle size={13} /> More deliveries than the register lists: these are the newest. Pick a month or dates for older ones.</p>}
          </section>

          {rows.length > 0 && (
            <div className="yarn-reg__groups">
              {([["By count", totals.byCount], ["By mill", totals.byMill]] as const).map(([label, groups]) => (
                <section key={label} className="yarn-sheet">
                  <h2 className="yarn-sheet__sub">{label}</h2>
                  <table className="yarn-grid is-small">
                    <thead><tr><th>{label === "By count" ? "Count" : "Mill"}</th><th className="num">DCs</th><th className="num">Bags</th><th className="num">Received</th><th className="num">In stock</th><th className="yarn-reg__noprint">Share</th></tr></thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.name} className="cursor-pointer" onClick={() => { if (label === "By count") setCount(g.name); else setMill(g.name); setLimit(PAGE); }} title={`Show only ${g.name}`}>
                          <td className="font-semibold">{g.name}</td>
                          <td className="num">{g.dcs}</td>
                          <td className="num">{g.bags || "—"}</td>
                          <td className="num font-semibold">{kg(g.kg)}</td>
                          <td className="num">{kg(g.stock)}</td>
                          <td className="yarn-reg__noprint"><span className="yarn-share"><span style={{ width: `${totals.weightKg ? (g.kg / totals.weightKg) * 100 : 0}%` }} /></span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <ReceiveYarnDialog
          receipt={editing === "new" ? undefined : editing}
          showPrices={showPrices}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            const fresh = editing === "new";
            setEditing(null);
            void reload();
            if (fresh && saved.challan) setChallan({ kind: "STOCK", id: saved.challan.id, no: saved.challan.no });
          }}
        />
      )}
      {challan?.kind === "STOCK" && <StockBillDialog billId={challan.id} canManage={showPrices} onClose={() => setChallan(null)} onChanged={() => void reload()} />}
      {challan?.kind === "GRN" && <ReceivedChallanDialog receiptId={challan.id} onClose={() => setChallan(null)} />}
    </div>
  );
}

/** One received yarn in full: the delivery, the weight against the DC, where the yarn is now and what it made. */
function YarnDetail({ row: r, showPrices, onChallan }: { row: Row; showPrices: boolean; onChallan: () => void }) {
  const stock = Math.max(0, r.inStockKg ?? 0);
  const atKnitting = r.toKnittingKg ?? 0;
  const knitted = r.knitting.filter((k) => k.done).reduce((t, k) => t + k.yarnKg, 0);
  const fabric = r.knitting.reduce((t, k) => t + (k.fabricKg ?? 0), 0);
  const share = (v: number) => `${r.weightKg ? Math.min(100, (v / r.weightKg) * 100) : 0}%`;
  // The yarn's tree (knitting → dyeing → compacting → delivered), loaded when asked for.
  const [tree, setTree] = useState(false);
  const { data: story, loading: treeLoading } = useApiQuery<YarnStory>(tree && r.itemCode ? `/inventory/yarn-story${qs({ code: r.itemCode })}` : null);
  return (
    <div className="yarn-detail">
      <div className="yarn-detail__grid">
        <dl className="yarn-detail__facts">
          <div><dt>Yarn code</dt><dd className="font-mono">{r.itemCode ?? "—"}</dd></div>
          <div><dt>{r.poNo ? "Goods receipt" : "Yarn receipt"}</dt><dd>{r.receiptNo}{r.poNo ? ` · ${r.poNo}` : ""}{r.challan ? ` · challan ${r.challan.no}` : ""}</dd></div>
          <div><dt>Received</dt><dd>{formatDate(r.date)} into {r.warehouse.code}</dd></div>
          <div><dt>Mill · agent</dt><dd>{r.mill} · {r.agent ?? "Direct"}</dd></div>
          <div><dt>DC no</dt><dd>{r.dcNo || "—"}{r.vehicleNo ? ` · ${r.vehicleNo}` : ""}</dd></div>
          <div><dt>Bags</dt><dd>{r.bags ? `${r.bags}${r.bagCount !== null && r.bags !== String(r.bagCount) ? ` = ${r.bagCount}` : ""}` : "—"}</dd></div>
          <div><dt>Weight</dt><dd>{kg(r.weightKg)}{r.dcWeightKg !== null ? <> · DC {kg(r.dcWeightKg)} <ReceiveCheck sent={r.dcWeightKg} received={r.weightKg} unit="KG" /></> : null}</dd></div>
          {showPrices && <div><dt>Rate · value</dt><dd>{r.ratePerKg === null ? "—" : `${money(r.ratePerKg)} / KG · ${money(r.amount ?? 0)}`}</dd></div>}
          {r.notes && <div className="sm:col-span-2"><dt>Notes</dt><dd>{r.notes}</dd></div>}
        </dl>

        <div className="yarn-detail__now">
          <p className="yarn-detail__label">Where this yarn is now</p>
          <div className="yarn-detail__bar" aria-hidden>
            <span className="is-knitted" style={{ width: share(knitted) }} />
            <span className="is-knitting" style={{ width: share(Math.max(0, atKnitting - knitted)) }} />
            <span className="is-stock" style={{ width: share(stock) }} />
          </div>
          <ul className="yarn-detail__legend">
            <li className="is-stock"><span />In stock <b>{kg(stock)}</b></li>
            <li className="is-knitting"><span />At knitting <b>{kg(Math.max(0, atKnitting - knitted))}</b></li>
            <li className="is-knitted"><span />Knitted (used) <b>{kg(knitted)}</b></li>
            {(r.returnedKg ?? 0) > EMPTY && <li><span className="is-back" />Came back from knitting <b>{kg(r.returnedKg ?? 0)}</b></li>}
            {(r.otherOutKg ?? 0) > EMPTY && <li><span className="is-other" />Out otherwise <b>{kg(r.otherOutKg ?? 0)}</b></li>}
          </ul>
        </div>
      </div>

      <div>
        <p className="yarn-detail__label">Knitting batches from this yarn{fabric > 0 ? ` · ${kg(fabric)} fabric made` : ""}</p>
        {r.knitting.length === 0 ? (
          <p className="text-xs text-gray-500">Not knitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="yarn-detail__knits">
              <thead><tr><th>Batch</th><th>Fabric</th><th>Knitted at</th><th className="num">Yarn</th><th className="num">Fabric made</th><th>Check</th><th>Now</th></tr></thead>
              <tbody>
                {r.knitting.map((k) => (
                  <tr key={k.flowNo}>
                    <td><Link href={`/production?batch=${encodeURIComponent(k.flowNo)}`} className="font-mono font-semibold text-[#1b3c55] hover:underline">{k.flowNo}</Link></td>
                    <td>{k.fabric}{k.colours ? <span className="text-gray-500"> · {k.colours} colour{k.colours === 1 ? "" : "s"}</span> : null}</td>
                    <td className="text-gray-600">{k.mill ?? "—"}{k.startedAt ? ` · ${formatDate(k.startedAt)}` : ""}</td>
                    <td className="num">{kg(k.yarnKg)}<span className="block text-[10px] text-gray-400">{k.done ? "used" : "given"}</span></td>
                    <td className="num font-semibold">{k.fabricKg !== null ? kg(k.fabricKg) : "—"}</td>
                    <td>{k.done && k.fabricKg !== null ? <ReceiveCheck sent={k.yarnKg} received={k.fabricKg} unit="KG" warnPct={5} /> : <span className="text-[11px] text-gray-400">when finished</span>}</td>
                    <td><span className={cn("yarn-state", k.done ? "is-used" : "is-part")}>{k.done ? "Knitted" : "Knitting"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tree && (
        <div>
          <p className="yarn-detail__label">Yarn tree: knitting → dyeing → compacting → delivered</p>
          {story ? <YarnTree story={story} /> : treeLoading ? <Loading /> : <p className="text-xs text-gray-500">No production from this yarn yet.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {r.itemCode && r.knitting.length > 0 && (
          <button type="button" className="yarn-detail__story is-light" aria-expanded={tree} onClick={() => setTree(!tree)}><GitBranch size={14} /> {tree ? "Hide yarn tree" : "Show yarn tree"}</button>
        )}
        {r.challan && (
          <button type="button" className="yarn-detail__story is-light" onClick={onChallan}><FileText size={14} /> Received challan {r.challan.no}</button>
        )}
        {r.itemCode && (
          <Link href={itemHref(r.itemCode)} className="yarn-detail__story">Full yarn story: fabrics, colours and weight checks <ArrowRight size={14} /></Link>
        )}
      </div>
    </div>
  );
}
