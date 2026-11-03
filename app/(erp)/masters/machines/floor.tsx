"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRightLeft, CalendarCheck, CheckCircle2, Moon, Pencil, Phone, Play, Sun, Timer, Wrench } from "lucide-react";
import { cn, formatDate, formatDateTime, kg, money } from "@/lib/utils";
import { prefetchApi } from "@/lib/use-api-query";
import { Button } from "@/components/ui/button";
import { TaskProgress } from "./run-dialogs";
import {
  currentShift,
  dayOf,
  elapsedText,
  fabricSpec,
  FLOOR_LABEL,
  machineHref,
  runHref,
  runOnDay,
  SHIFT_HOURS,
  SHIFT_LABEL,
  shiftStart,
  shiftText,
  type FloorState,
  type KnitMachine,
  type KnitOperator,
  type KnitRun,
} from "./types";

const SHIFT_MS = 12 * 3_600_000;

/** The clock on the floor: time to the second, the shift running now and how much of it is left. Ticks on its own, so the page doesn't. */
export function FloorClock() {
  // Rendered after mount: the server's time would never match the browser's.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <div className="knit-clock" aria-hidden />;
  const { date, shift } = currentShift(now);
  const start = shiftStart(date, shift).getTime();
  const pct = Math.min(100, Math.max(0, ((now.getTime() - start) / SHIFT_MS) * 100));
  return (
    <div className="knit-clock">
      <p className="knit-clock__time" aria-live="off">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}</p>
      <p className="knit-clock__date">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</p>
      <div className="knit-clock__shift">
        <span>{shift === "DAY" ? <Sun size={13} /> : <Moon size={13} />} {SHIFT_LABEL[shift]} shift · {SHIFT_HOURS[shift]}</span>
        <span>{elapsedText(start + SHIFT_MS - now.getTime())} left</span>
      </div>
      <div className="knit-clock__bar" role="progressbar" aria-label={`${SHIFT_LABEL[shift]} shift`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** "Running 2d 5h", kept up to date every minute. */
function Elapsed({ since, prefix }: { since: Date; prefix: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return <>{prefix} {elapsedText(now - since.getTime())}</>;
}

/** The fabric, yarn and operator of a run, as the operator needs them at the machine. */
function RunSpec({ run }: { run: KnitRun }) {
  const flow = run.productionFlow;
  const yarn = run.yarns[0];
  const fabric = fabricSpec({ ...flow, fabricType: run.fabricType });
  return (
    <dl className="knit-spec">
      <div><dt>Fabric</dt><dd>{fabric || "—"}</dd></div>
      <div>
        <dt>Yarn</dt>
        <dd>
          {yarn ? <span className="font-mono font-bold">{yarn.itemCode}</span> : "—"}
          {flow?.yarnCount ? ` · ${flow.yarnCount}` : ""}
          {yarn?.lotNo ? ` · lot ${yarn.lotNo}` : ""}
          {run.yarns.length > 1 ? ` + ${run.yarns.slice(1).map((y) => y.itemCode).join(", ")}` : ""}
        </dd>
      </div>
      <div><dt>Operator</dt><dd>{run.operator ? `${run.operator.name} · ${run.operator.code}` : <span className="text-gray-400">Not recorded</span>}</dd></div>
    </dl>
  );
}

/**
 * One machine on the floor. Running: its task, fabric, yarn, operator, how long it has run, what it has knitted and
 * whether yesterday is entered. Stopped, under repair or in maintenance: since when and why, and what to do next.
 */
export function MachineTile({
  machine,
  run,
  lastRun,
  state,
  lastDay,
  today,
  tasksOpen,
  onEdit,
  onAssign,
  onDay,
  onMove,
  onFinish,
  onBackInService,
  canManage,
  showPrices,
}: {
  machine: KnitMachine;
  run: KnitRun | undefined;
  /** The last run that stopped on it, for when and why it stopped. */
  lastRun: KnitRun | undefined;
  state: FloorState;
  lastDay: string;
  today: string;
  tasksOpen: number;
  onEdit: () => void;
  onAssign: () => void;
  onDay: (run: KnitRun) => void;
  onMove: (run: KnitRun) => void;
  onFinish: (run: KnitRun) => void;
  onBackInService: () => void;
  canManage: boolean;
  showPrices: boolean;
}) {
  const flow = run?.productionFlow;
  const yesterday = run ? dayOf(run, lastDay) : undefined;
  const todayEntry = run ? dayOf(run, today) : undefined;
  const yesterdayDue = !!run && runOnDay(run, lastDay) && !yesterday;
  const others = flow ? flow.knittingRuns.filter((r) => r.status === "RUNNING" && r.id !== run?.id) : [];
  const stoppedAt = lastRun?.finishedAt && lastRun.finishShift ? new Date(shiftStart(lastRun.finishedAt, lastRun.finishShift).getTime() + SHIFT_MS) : null;
  const down = state === "repair" || state === "maintenance";

  return (
    // Pointing at a machine starts loading its page (its runs), so opening it is instant.
    <article className={cn("knit-tile", `is-${state}`)} onPointerEnter={() => prefetchApi(`/knitting/runs?machineId=${encodeURIComponent(machine.id)}`)}>
      <header className="knit-tile__head">
        <div className="min-w-0">
          <Link href={machineHref(machine.id)} className="knit-tile__code" title={`Open ${machine.code}`}>{machine.code}</Link>
          <p className="knit-tile__name">{machine.name}{machine.type ? ` · ${machine.type}` : ""}</p>
        </div>
        <span className="flex items-center gap-1">
          <span className={cn("knit-state", `is-${state}`)}>{FLOOR_LABEL[state]}</span>
          {canManage && <button type="button" className="knit-icon-btn" aria-label={`Edit ${machine.code}`} title="Edit machine" onClick={onEdit}><Pencil size={14} /></button>}
        </span>
      </header>

      {run ? (
        <div className="knit-tile__body">
          {down && (
            <p className="knit-tile__alert">
              <AlertTriangle size={14} aria-hidden /> Still has {run.runNo} on it. Change machine to carry the work on elsewhere.
            </p>
          )}
          <p className="knit-tile__since">
            <Timer size={13} aria-hidden /> <Elapsed prefix="Running" since={shiftStart(run.startedAt, run.startShift)} /> <span>· since {shiftText(run.startedAt, run.startShift)}</span>
          </p>
          <Link href={runHref(run.runNo)} className="knit-tile__task">
            <span className="knit-code">{run.runNo}</span>
            <span>{flow ? `Task ${flow.flowNo}` : "Open run"}</span>
          </Link>
          <RunSpec run={run} />
          <div className="knit-machine__nums">
            <div><p>Knitted</p><strong>{kg(run.outputKg ?? 0)}</strong></div>
            <div><p>Rolls</p><strong>{run.rollCount ?? 0}</strong></div>
            <div><p>Per day</p><strong>{run.avgPerDayKg ? kg(run.avgPerDayKg) : "—"}</strong></div>
          </div>
          {flow && (
            <div>
              <TaskProgress compact={false} knittedKg={flow.knittedKg} yarnKg={flow.purchasedWeightKg} />
              {others.length > 0 && <p className="mt-0.5 text-[11px] text-gray-500">Also on {others.map((r) => r.machine.code).join(", ")}</p>}
            </div>
          )}
          {yesterdayDue ? (
            <button type="button" className="knit-day-due" onClick={() => onDay(run)}>
              <AlertTriangle size={13} aria-hidden /> {formatDate(lastDay)} not entered · enter now
            </button>
          ) : (
            <p className="text-xs text-gray-600">
              {todayEntry ? (
                <>Today: <strong>{kg(todayEntry.outputKg)}</strong> · {todayEntry.rollCount} rolls</>
              ) : yesterday ? (
                <>{formatDate(lastDay)}: <strong>{kg(yesterday.outputKg)}</strong> · {yesterday.rollCount} rolls</>
              ) : (
                "First day on the machine"
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="knit-tile__body">
          {state === "stopped" ? (
            <p className="knit-tile__since">
              <Timer size={13} aria-hidden /> {stoppedAt ? <><Elapsed prefix="Stopped" since={stoppedAt} /> <span>· since {shiftText(lastRun!.finishedAt, lastRun!.finishShift)}</span></> : "No work on it recently"}
            </p>
          ) : (
            <p className={cn("knit-tile__alert", state === "maintenance" && "is-maint")}>
              <Wrench size={14} aria-hidden /> {state === "repair" ? "Under repair" : "In maintenance"}
              {machine.updatedAt ? ` since ${formatDateTime(machine.updatedAt)}` : ""}
            </p>
          )}
          {lastRun && (
            <p className="text-xs text-gray-600">
              Last: <Link href={runHref(lastRun.runNo)} className="font-mono font-semibold text-[#17644f] hover:underline">{lastRun.runNo}</Link> · {kg(lastRun.outputKg ?? 0)}
              {lastRun.endReason && <span className="block text-amber-700">{lastRun.endReason}</span>}
            </p>
          )}
          {state === "stopped" && (
            <p className="text-xs text-gray-500">{tasksOpen ? `${tasksOpen} knitting task${tasksOpen === 1 ? "" : "s"} open; assign one to start.` : "No knitting task is open."}</p>
          )}
          {showPrices && <p className="text-[11px] text-gray-400">{machine.ratePerKg ? `${money(machine.ratePerKg)} / KG knitting` : "No knitting charge set"}</p>}
        </div>
      )}

      <footer className="knit-tile__foot">
        {run && !down ? (
          <>
            <span className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => onDay(run)} title="Enter this machine's KG and rolls for a day"><CalendarCheck size={13} /> Day</Button>
              {flow && <Button size="sm" variant="outline" onClick={() => onMove(run)} title="Breakdown or repair: move the work to another machine"><ArrowRightLeft size={13} /> Change</Button>}
            </span>
            <Button size="sm" className="knit-btn is-blue" onClick={() => onFinish(run)}><CheckCircle2 size={13} /> Stop</Button>
          </>
        ) : down ? (
          <>
            {run && flow ? <Button size="sm" variant="outline" onClick={() => onMove(run)}><ArrowRightLeft size={13} /> Change machine</Button> : <span />}
            <Button size="sm" variant="outline" onClick={onBackInService}><Wrench size={13} /> Back in service</Button>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-500">Ready for work</span>
            {tasksOpen > 0 ? <Button size="sm" className="knit-btn" onClick={onAssign}><Play size={13} /> Assign task</Button> : <span className="text-xs font-semibold text-gray-400">No task open</span>}
          </>
        )}
      </footer>
    </article>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");

/** Who is on which machine now: each operator with their machines, task, fabric, and since when. */
export function OperatorsPanel({ running, operators }: { running: KnitRun[]; operators: KnitOperator[] }) {
  const byOperator = new Map<string, { operator: KnitOperator | { id: string; code: string; name: string }; runs: KnitRun[] }>();
  for (const run of running) {
    if (!run.operator) continue;
    const entry = byOperator.get(run.operator.id) ?? { operator: operators.find((o) => o.id === run.operator!.id) ?? run.operator, runs: [] };
    entry.runs.push(run);
    byOperator.set(run.operator.id, entry);
  }
  const onMachines = [...byOperator.values()].sort((a, b) => a.operator.name.localeCompare(b.operator.name));
  const unassigned = running.filter((r) => !r.operator);
  const free = operators.filter((o) => !byOperator.has(o.id) && /knit|machine|production/i.test(o.department));

  return (
    <div className="space-y-4">
      {onMachines.length === 0 ? (
        <div className="knit-empty">
          <p className="font-bold text-gray-900">No operator on a running machine</p>
          <p className="text-sm text-gray-500">Choose the operator when putting a task on a machine.</p>
        </div>
      ) : (
        <div className="knit-ops">
          {onMachines.map(({ operator, runs }) => {
            const details = operator as KnitOperator;
            return (
              <article key={operator.id} className="knit-op">
                <header className="flex items-center gap-3">
                  <span className="knit-op__avatar" aria-hidden>{initials(operator.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-[#0f2a24]">{operator.name}</p>
                    <p className="text-xs text-gray-500">{operator.code}{details.department ? ` · ${details.department}` : ""}{details.shift ? ` · ${details.shift} shift` : ""}</p>
                  </div>
                  {details.mobile && <a href={`tel:${details.mobile}`} className="knit-icon-btn" aria-label={`Call ${operator.name}`} title={details.mobile}><Phone size={14} /></a>}
                </header>
                <ul className="mt-3 space-y-2">
                  {runs.map((run) => (
                    <li key={run.id}>
                      <Link href={runHref(run.runNo)} className="knit-op__run">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-extrabold text-[#0f2a24]">{run.machine.code}</span>
                          <span className="text-xs font-semibold text-gray-600">{kg(run.outputKg ?? 0)}</span>
                        </span>
                        <span className="block truncate text-xs text-gray-600">{run.productionFlow?.flowNo ?? run.runNo} · {fabricSpec({ ...run.productionFlow, fabricType: run.fabricType }) || "Fabric"}</span>
                        <span className="block text-[11px] text-gray-400">Since {shiftText(run.startedAt, run.startShift)} · <Elapsed prefix="running" since={shiftStart(run.startedAt, run.startShift)} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
      {unassigned.length > 0 && (
        <p className="knit-alert is-warn">No operator recorded on {unassigned.map((r) => r.machine.code).join(", ")}.</p>
      )}
      {free.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Not on a machine now · {free.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {free.map((o) => <span key={o.id} className="knit-chip">{o.name} · {o.code}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}
