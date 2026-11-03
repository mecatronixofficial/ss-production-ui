"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, ChevronDown, Factory, Layers, Phone, RefreshCw, Search, Sparkles } from "lucide-react";
import { cn, formatDate, kg } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { itemHref } from "../warehouses/item-details";
import { machineHref, runHref, SHIFT_LABEL } from "../masters/machines/types";
import {
  batchHref,
  byMill,
  fabricGroups,
  fabricName,
  KIND_KEYS,
  KINDS,
  MACHINE_STATE_KEYS,
  MACHINE_STATES,
  materialOut,
  outKgOf,
  stockHref,
  type MachineState,
  type ProductionOverview,
  type RunningRun,
  type StockKind,
} from "./floor-data";
import { localDate } from "./types";

/*
 * The Floor & stock tab of the Production front: figures for machines, knitting and every material; the KG knitted
 * each production day; every machine with its operator and, when running, the batch, yarn, fabric, days and output;
 * every yarn and fabric code in stock by warehouse (linked to Warehouses) with what is out at each mill; and the
 * fabric being made by type and colour, by process.
 */

/** The figures across the top. */
export function Figures({ overview, out }: { overview?: ProductionOverview; out: ReturnType<typeof materialOut> }) {
  const m = overview?.machines;
  const days = overview?.knitting.days ?? [];
  const last = days.at(-1);
  const month = localDate().slice(0, 7);
  const monthKg = days.filter((d) => d.date.startsWith(month)).reduce((sum, d) => sum + d.kg, 0);
  const stock = (k: StockKind) => overview?.stock.find((s) => s.category === k)?.kg ?? 0;
  const tiles: Array<{ label: string; value: string; note: string; accent: string; href?: string }> = [
    { label: "Machines running", value: m ? `${m.running.length} / ${m.total}` : "—", note: m ? `${m.byStatus.IDLE ?? 0} idle · ${m.byStatus.BREAKDOWN ?? 0} repair · ${m.byStatus.MAINTENANCE ?? 0} service` : "", accent: "is-knitting", href: "#machines" },
    { label: last ? `Knitted ${formatDate(last.date)}` : "Knitted (last day)", value: last ? kg(last.kg) : "—", note: last ? `${last.rolls} rolls · ${last.machines} machine entries` : "no day recorded", accent: "is-knitting", href: "#knitting" },
    { label: "Knitted this month", value: kg(monthKg), note: `${days.filter((d) => d.date.startsWith(month)).length} production days`, accent: "is-knitting", href: "#knitting" },
    ...KIND_KEYS.map((k) => ({
      label: k === "YARN" ? "Total yarn" : KINDS[k].label,
      value: kg(stock(k) + outKgOf(out, k)),
      note: `${kg(stock(k))} in stock · ${kg(outKgOf(out, k))} ${KINDS[k].atProcess}`,
      accent: KINDS[k].accent,
      href: stockHref(k),
    })),
  ];
  return (
    <div className="floor-figures">
      {tiles.map((t) => {
        const body = (
          <>
            <p>{t.label}</p>
            <strong>{t.value}</strong>
            <span>{t.note}</span>
          </>
        );
        return t.href ? <Link key={t.label} href={t.href} className={cn("floor-figure", t.accent)}>{body}</Link> : <div key={t.label} className={cn("floor-figure", t.accent)}>{body}</div>;
      })}
    </div>
  );
}

/** The KG knitted on each production day, the last two weeks (and this month). */
export function DailyKnitting({ overview, error, onRetry }: { overview?: ProductionOverview; error?: string; onRetry: () => void }) {
  // Every day from the first one returned to today, with the days nothing was recorded as gaps.
  const days = useMemo(() => {
    const recorded = overview?.knitting.days ?? [];
    if (!overview) return [];
    const byDate = new Map(recorded.map((d) => [d.date, d]));
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 13);
    const first = recorded[0]?.date && recorded[0].date < start.toISOString().slice(0, 10) ? new Date(recorded[0].date) : start;
    const rows = [];
    for (const d = new Date(first); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      rows.push(byDate.get(key) ?? { date: key, kg: 0, rolls: 0, machines: 0 });
    }
    return rows;
  }, [overview]);
  const max = Math.max(0, ...days.map((d) => d.kg));
  const worked = days.filter((d) => d.kg > 0);
  const total = worked.reduce((sum, d) => sum + d.kg, 0);

  return (
    <section id="knitting" className="pfloor__card is-knitting floor-section">
      <header className="pfloor__head">
        <span className="pfloor__icon"><BarChart3 size={16} /></span>
        <h2>Knitted each day</h2>
        {worked.length > 0 && <span className="pfloor__note"><b>{kg(total)}</b> over {worked.length} days · average <b>{kg(total / worked.length)}</b> a day</span>}
      </header>
      {!overview ? (
        error ? <Failed error={error} onRetry={onRetry} /> : <p className="pfloor__empty">Loading…</p>
      ) : worked.length === 0 ? (
        <p className="pfloor__empty">No knitting recorded in the last two weeks. Machines record each day&apos;s KG and rolls on the Machines page.</p>
      ) : (
        <div className="floor-days" role="list" aria-label="KG knitted per day">
          {days.map((d) => {
            const date = new Date(`${d.date}T00:00:00`);
            return (
              <div key={d.date} role="listitem" className={cn("floor-day", d.kg === 0 && "is-empty", date.getDay() === 0 && "is-sunday")} title={`${formatDate(d.date)}: ${kg(d.kg)} · ${d.rolls} rolls · ${d.machines} machine entries`}>
                <span className="floor-day__value">{d.kg > 0 ? Math.round(d.kg) : ""}</span>
                <span className="floor-day__bar"><span style={{ height: `${max ? Math.max(3, (d.kg / max) * 100) : 0}%` }} /></span>
                <span className="floor-day__date">{date.getDate()}</span>
                <span className="floor-day__dow">{date.toLocaleDateString("en-IN", { weekday: "narrow" })}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function MachinesSection({ overview, error, onRetry }: { overview?: ProductionOverview; error?: string; onRetry: () => void }) {
  const [state, setState] = useState<MachineState | "ALL">("ALL");
  const [find, setFind] = useState("");
  const m = overview?.machines;
  const runOf = useMemo(() => new Map((m?.running ?? []).map((r) => [r.machine.id, r])), [m]);
  const q = find.trim().toUpperCase();
  const shown = (m?.list ?? []).filter((machine) => {
    if (state !== "ALL" && machine.status !== state) return false;
    if (!q) return true;
    const run = runOf.get(machine.id);
    return [machine.code, machine.name, machine.type, machine.operator?.name, run?.operator?.name, run?.runNo, run?.productionFlow?.flowNo, run?.productionFlow?.fabricType, run?.productionFlow?.yarnItemCode, run?.productionFlow?.color].some((v) => v?.toUpperCase().includes(q));
  });

  return (
    <section id="machines" className="pfloor__card is-knitting floor-section">
      <header className="pfloor__head">
        <span className="pfloor__icon"><Factory size={16} /></span>
        <h2>Machines</h2>
        {m && <span className="pfloor__note"><b>{m.running.length}</b> of {m.total} knitting · <b>{kg(m.running.reduce((sum, r) => sum + r.outputKg, 0))}</b> on the running tasks</span>}
        <Link href="/masters/machines" className="pfloor__more">Open Machines <ArrowRight size={13} /></Link>
      </header>
      {!m ? (
        error ? <Failed error={error} onRetry={onRetry} /> : <p className="pfloor__empty">Loading machines…</p>
      ) : m.total === 0 ? (
        <p className="pfloor__empty">No machines yet. Add them in Machines.</p>
      ) : (
        <>
          <div className="floor-tools">
            <div className="production-order" role="group" aria-label="Show machines">
              <button type="button" aria-pressed={state === "ALL"} onClick={() => setState("ALL")}>All {m.total}</button>
              {MACHINE_STATE_KEYS.map((s) => (
                <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)} className={MACHINE_STATES[s].tone}><i className="floor-dot" aria-hidden /> {MACHINE_STATES[s].label} {m.byStatus[s] ?? 0}</button>
              ))}
            </div>
            <label className="floor-find">
              <Search size={15} aria-hidden />
              <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Machine, operator, batch, yarn or fabric" aria-label="Find a machine" />
            </label>
          </div>
          {shown.length === 0 ? (
            <p className="pfloor__empty">No machine matches.</p>
          ) : (
            <div className="floor-machines">
              {shown.map((machine) => <MachineCard key={machine.id} machine={machine} run={runOf.get(machine.id)} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MachineCard({ machine, run }: { machine: ProductionOverview["machines"]["list"][number]; run?: RunningRun }) {
  const state = MACHINE_STATES[machine.status] ?? MACHINE_STATES.IDLE;
  const operator = run?.operator ?? machine.operator;
  const f = run?.productionFlow;
  const pct = run && run.yarnKg > 0 ? Math.min(100, (run.outputKg / run.yarnKg) * 100) : 0;
  return (
    <article className={cn("floor-machine", state.tone)}>
      <header className="flex items-start justify-between gap-2">
        <Link href={machineHref(machine.id)} className="min-w-0">
          <b className="block font-mono text-sm text-[var(--p-ink)] hover:underline">{machine.code}</b>
          <span className="block truncate text-[11px] text-gray-500">{[machine.name, machine.type].filter(Boolean).join(" · ")}</span>
        </Link>
        <span className="floor-state"><i className="floor-dot" aria-hidden /> {state.label}</span>
      </header>
      <p className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className="truncate font-semibold">{operator?.name ?? "No operator"}</span>
        {operator?.mobile && <a href={`tel:${operator.mobile}`} className="inline-flex items-center gap-0.5 text-[11px] text-gray-500 hover:underline"><Phone size={11} /> {operator.mobile}</a>}
      </p>
      {run ? (
        <>
          <dl className="floor-machine__facts">
            <div><dt>Batch</dt><dd>{f ? <Link href={batchHref(f.flowNo)} className="hover:underline">{f.flowNo}</Link> : "—"} <Link href={runHref(run.runNo)} className="text-[11px] font-normal text-gray-500 hover:underline">{run.runNo}</Link></dd></div>
            <div><dt>Fabric</dt><dd>{f ? fabricName(f) || "—" : "—"}{f?.color ? ` · ${f.color}` : ""}</dd></div>
            <div><dt>Yarn</dt><dd>{f?.yarnItemCode ? <Link href={itemHref(f.yarnItemCode)} className="font-mono hover:underline">{f.yarnItemCode}</Link> : "—"}{f?.yarnCount ? ` · ${f.yarnCount}` : ""}</dd></div>
            <div><dt>Since</dt><dd>{formatDate(run.startedAt)} · {SHIFT_LABEL[run.startShift]} · {run.dayCount} day{run.dayCount === 1 ? "" : "s"} recorded</dd></div>
          </dl>
          <div>
            <p className="flex items-baseline justify-between text-xs">
              <span className="text-gray-500">Knitted <b className="text-[var(--p-ink)]">{kg(run.outputKg)}</b> of {kg(run.yarnKg)} yarn</span>
              <span className="text-gray-500">{run.rollCount} rolls</span>
            </p>
            <span className="pfloor__bar"><span style={{ width: `${pct}%` }} /></span>
          </div>
          <p className="text-[11px] text-gray-500">
            {run.lastDay ? <>Last day {formatDate(run.lastDay.date)}: <b className="text-gray-700">{kg(run.lastDay.outputKg)}</b> · {run.lastDay.rollCount} rolls</> : "No day recorded yet"}
            {run.dayCount > 0 && <> · average {kg(run.outputKg / run.dayCount)} a day</>}
          </p>
        </>
      ) : (
        <p className="floor-machine__idle">{machine.status === "BREAKDOWN" ? "Under repair: give its work to another machine from Machines." : machine.status === "MAINTENANCE" ? "In maintenance." : "No task. Assign one from Machines or a batch's knitting."}</p>
      )}
    </article>
  );
}

export function StockSection({ overview, error, onRetry, out }: { overview?: ProductionOverview; error?: string; onRetry: () => void; out: ReturnType<typeof materialOut> }) {
  const [kind, setKind] = useState<StockKind>("YARN");
  const [warehouse, setWarehouse] = useState("all");
  const [find, setFind] = useState("");
  const row = overview?.stock.find((s) => s.category === kind);
  const meta = KINDS[kind];
  const q = find.trim().toUpperCase();
  const items = (row?.items ?? [])
    .map((item) => (warehouse === "all" ? item : { ...item, warehouses: item.warehouses.filter((w) => w.id === warehouse), kg: item.warehouses.find((w) => w.id === warehouse)?.kg ?? 0 }))
    .filter((item) => item.kg > 0 && (!q || item.itemCode.toUpperCase().includes(q) || item.itemName.toUpperCase().includes(q)));
  const shownKg = items.reduce((sum, item) => sum + item.kg, 0);
  const top = items[0]?.kg ?? 0;
  const mills = byMill(out.filter((o) => o.kind === kind));
  const pick = (k: StockKind) => {
    setKind(k);
    setWarehouse("all");
  };

  return (
    <section id="stock" className={cn("pfloor__card floor-section", meta.accent)}>
      <header className="pfloor__head">
        <span className="pfloor__icon"><Layers size={16} /></span>
        <h2>Stock</h2>
        <Link href={stockHref(kind, warehouse === "all" ? undefined : warehouse)} className="pfloor__more">Open {meta.label.toLowerCase()} in Warehouses <ArrowRight size={13} /></Link>
      </header>
      <div className="pfloor__kinds" role="tablist" aria-label="Material">
        {KIND_KEYS.map((k) => {
          const s = overview?.stock.find((x) => x.category === k);
          const Icon = KINDS[k].icon;
          return (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={cn("pfloor__kind", KINDS[k].accent)} onClick={() => pick(k)}>
              <span className="pfloor__stock-icon"><Icon size={15} /></span>
              <span className="min-w-0 text-left">
                <span className="block text-xs font-bold text-gray-600">{KINDS[k].label}</span>
                <strong className="block text-base font-black tabular-nums text-[var(--p-ink)]">{s ? kg(s.kg) : "—"}</strong>
                <span className="block truncate text-[11px] text-gray-500">{s ? `${s.codes} codes` : "…"} · {kg(outKgOf(out, k))} {KINDS[k].atProcess}</span>
              </span>
            </button>
          );
        })}
      </div>

      {!overview ? (
        error ? <Failed error={error} onRetry={onRetry} /> : <p className="pfloor__empty">Loading stock…</p>
      ) : (
        <div className="floor-stock">
          <div className="min-w-0 space-y-2">
            <div className="floor-tools">
              <div className="production-order" role="group" aria-label="Warehouse">
                <button type="button" aria-pressed={warehouse === "all"} onClick={() => setWarehouse("all")}>All warehouses</button>
                {row?.warehouses.map((w) => (
                  <button key={w.id} type="button" aria-pressed={warehouse === w.id} onClick={() => setWarehouse(w.id)} title={w.name}>{w.code} · {kg(w.kg)}</button>
                ))}
              </div>
              <label className="floor-find">
                <Search size={15} aria-hidden />
                <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find a ${meta.label.toLowerCase()} code or name`} aria-label="Find a code" />
              </label>
            </div>
            <p className="pfloor__label">In warehouses · {items.length} code{items.length === 1 ? "" : "s"} · {kg(shownKg)}</p>
            {items.length === 0 ? (
              <p className="pfloor__empty">{row?.items.length ? "No code matches." : `No ${meta.label.toLowerCase()} in any warehouse.`}</p>
            ) : (
              <div className="floor-table" role="table" aria-label={`${meta.label} in stock`}>
                <div className="floor-table__row is-head" role="row">
                  <span role="columnheader">Code</span><span role="columnheader">Name</span><span role="columnheader">Warehouses</span><span role="columnheader" className="text-right">In stock</span>
                </div>
                {items.map((item) => (
                  <Link key={item.itemCode} role="row" href={itemHref(item.itemCode, warehouse !== "all" ? warehouse : item.warehouses.length === 1 ? item.warehouses[0].id : undefined)} className="floor-table__row" title={`Open ${item.itemCode} in Warehouses`}>
                    <span role="cell" className="truncate font-mono text-xs font-bold text-[var(--p-ink)]">{item.itemCode}</span>
                    <span role="cell" className="truncate text-xs text-gray-600">{item.itemName && item.itemName !== item.itemCode ? item.itemName : "—"}</span>
                    <span role="cell" className="flex min-w-0 flex-wrap gap-1">
                      {item.warehouses.map((w) => <span key={w.id} className="pfloor__chip" title={w.name}>{w.code} {kg(w.kg)}</span>)}
                    </span>
                    <span role="cell" className="text-right">
                      <b className="text-xs tabular-nums">{kg(item.kg)}</b>
                      <span className="pfloor__bar is-thin"><span style={{ width: `${top ? (item.kg / top) * 100 : 0}%` }} /></span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <p className="pfloor__label">Out {meta.atProcess} · {mills.reduce((n, mill) => n + mill.items.length, 0)} batches · {kg(outKgOf(out, kind))}</p>
            {mills.length === 0 ? (
              <p className="pfloor__empty">None {meta.atProcess}.</p>
            ) : (
              mills.map((mill) => (
                <div key={mill.at} className="floor-mill">
                  <p className="flex items-baseline justify-between gap-2 text-xs">
                    <b className="truncate text-[var(--p-ink)]">{mill.at}</b>
                    <b className="shrink-0 tabular-nums">{kg(mill.kg)}</b>
                  </p>
                  <ul className="pfloor__rows">
                    {mill.items.map(({ flow, kg: weight }) => (
                      <li key={flow.id}>
                        <Link href={batchHref(flow.flowNo)} title={`Open batch ${flow.flowNo}`}>
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-xs text-[var(--p-ink)]">{flow.flowNo}{flow.yarnItemCode && kind === "YARN" ? <span className="ml-1 font-mono font-normal text-gray-500">{flow.yarnItemCode}</span> : null}</b>
                            <span className="block truncate text-[11px] text-gray-500">{[fabricName(flow), flow.color].filter(Boolean).join(" · ") || "—"}</span>
                          </span>
                          <b className="shrink-0 text-xs tabular-nums">{kg(weight)}</b>
                          <ArrowRight size={13} className="shrink-0 text-gray-300" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function FabricSection({ out, loading }: { out: ReturnType<typeof materialOut>; loading: boolean }) {
  const groups = useMemo(() => fabricGroups(out), [out]);
  const [open, setOpen] = useState<string | null>(null);
  const totals = groups.reduce((t, g) => t.map((v, i) => v + g.stages[i]), [0, 0, 0, 0]);
  const total = totals.reduce((a, b) => a + b, 0);

  return (
    <section id="fabric" className="pfloor__card is-dyeing floor-section">
      <header className="pfloor__head">
        <span className="pfloor__icon"><Sparkles size={16} /></span>
        <h2>Fabric in process</h2>
        <span className="pfloor__note"><b>{kg(total)}</b> · {groups.reduce((n, g) => n + g.batches.length, 0)} batches · {groups.length} fabrics</span>
      </header>
      {loading ? (
        <p className="pfloor__empty">Loading batches…</p>
      ) : groups.length === 0 ? (
        <p className="pfloor__empty">No fabric in process.</p>
      ) : (
        <div className="floor-table is-fabric" role="table" aria-label="Fabric in process">
          <div className="floor-table__row is-head" role="row">
            <span role="columnheader">Fabric</span>
            {KIND_KEYS.map((k) => <span key={k} role="columnheader" className="text-right">{KINDS[k].process}</span>)}
            <span role="columnheader" className="text-right">Total</span>
            <span role="columnheader" aria-hidden />
          </div>
          {groups.map((g) => (
            <div key={g.key} role="rowgroup">
              <button type="button" role="row" className="floor-table__row" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
                <span role="cell" className="min-w-0 text-left">
                  <b className="block truncate text-xs text-[var(--p-ink)]">{g.name}</b>
                  <span className="block truncate text-[11px] text-gray-500">{g.color ?? "No colour"} · {g.batches.length} batch{g.batches.length === 1 ? "" : "es"}</span>
                  <StageBar stages={g.stages} total={g.kg} />
                </span>
                {g.stages.map((v, i) => <span key={i} role="cell" className={cn("text-right text-xs tabular-nums", v ? "text-gray-800" : "text-gray-300")}>{v ? kg(v) : "—"}</span>)}
                <span role="cell" className="text-right text-xs font-bold tabular-nums">{kg(g.kg)}</span>
                <span role="cell" className="text-right"><ChevronDown size={15} className={cn("inline text-gray-400 transition-transform", open === g.key && "rotate-180")} aria-hidden /></span>
              </button>
              {open === g.key && (
                <div className="floor-batches">
                  {g.batches.map((f) => {
                    const o = out.find((x) => x.flow.id === f.id);
                    return (
                      <Link key={f.id} href={batchHref(f.flowNo)} className="pfloor__chip">
                        {f.flowNo} · {o ? `${KINDS[o.kind].process} ${kg(o.kind === "YARN" ? f.metrics.currentWeightKg : o.kg)}` : ""}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <div className="floor-table__row is-foot" role="row">
            <span role="cell">Total</span>
            {totals.map((v, i) => <span key={i} role="cell" className="text-right tabular-nums">{v ? kg(v) : "—"}</span>)}
            <span role="cell" className="text-right tabular-nums">{kg(total)}</span>
            <span role="cell" />
          </div>
        </div>
      )}
    </section>
  );
}

/** One bar split by process: knitting, dyeing, compacting, ready. */
export function StageBar({ stages, total }: { stages: number[]; total: number }) {
  return (
    <span className="pfloor__stack" aria-hidden>
      {stages.map((v, i) => (v > 0 && total > 0 ? <span key={i} className={KINDS[KIND_KEYS[i]].accent} style={{ width: `${(v / total) * 100}%` }} /> : null))}
    </span>
  );
}

export function Failed({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="pfloor__failed" role="alert">
      <AlertTriangle size={15} aria-hidden />
      <span className="min-w-0 flex-1">Could not load this. {error}</span>
      <button type="button" onClick={onRetry}><RefreshCw size={13} /> Try again</button>
    </div>
  );
}
