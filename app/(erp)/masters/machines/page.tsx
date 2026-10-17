"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardList, Download, Factory, Moon, Pencil, Play, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { cn, gsmText, humanize, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { useAuth } from "@/components/auth-provider";
import { ADMIN_ROLES } from "@/lib/navigation";
import { MachineDialog } from "./machine-dialog";
import { FinishRunDialog, StartRunDialog } from "./run-dialogs";
import {
  currentShift,
  EMPTY,
  localMonth,
  machineHref,
  openTasks,
  runHref,
  SHIFT_HOURS,
  SHIFT_LABEL,
  shiftText,
  type KnitContext,
  type KnitMachine,
  type KnitRun,
  type ProductionTask,
} from "./types";
import "./machines.css";

type Open =
  | { kind: "machine"; machine: KnitMachine | null }
  | { kind: "start"; taskId?: string; machineId?: string }
  | { kind: "finish"; runId: string }
  | null;
type Filter = "ALL" | "RUNNING" | "FINISHED";

/**
 * Knitting machines, running day and night (Day 9 AM–9 PM, Night 9 PM–9 AM). Production knitting tasks are put on
 * machines here, one load at a time, and the fabric taken off goes into a warehouse as grey fabric under the run's
 * own code. Each run has its own page; `?run=CODE` (old links) goes there.
 */
export default function MachinesPage() {
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const showPrices = isAdmin;
  const context = useApiQuery<KnitContext>("/knitting/context");
  const runsQuery = useApiQuery<KnitRun[]>("/knitting/runs");
  const tasksQuery = useApiQuery<{ data: ProductionTask[] }>("/production/fabric-flows");
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  useNewParam(() => setOpen({ kind: "machine", machine: null }));
  // The current shift label follows the clock.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Old `?run=CODE` links (item details, production) now open the run's own page.
  const linked = params.get("run");
  useEffect(() => {
    if (linked) router.replace(runHref(linked));
  }, [linked, router]);

  const runs = runsQuery.data;
  const reload = async () => {
    setRefreshing(true);
    await Promise.all([context.reload(), runsQuery.reload(), tasksQuery.reload()]);
    setRefreshing(false);
  };
  const done = (text: string) => {
    toast.success(text);
    setOpen(null);
    void reload();
  };

  const q = search.trim().toUpperCase();
  const visible = useMemo(
    () =>
      (runs ?? []).filter(
        (r) =>
          (filter === "ALL" || r.status === filter) &&
          (!q ||
            [r.runNo, r.machine.code, r.fabricType ?? "", r.operator?.name ?? "", ...r.yarns.map((y) => y.itemCode)].some((v) => v.toUpperCase().includes(q))),
      ),
    [runs, filter, q],
  );
  const tasks = useMemo(() => openTasks(tasksQuery.data?.data ?? []), [tasksQuery.data]);

  if ((!context.data && context.error) || (!runs && runsQuery.error)) {
    return <ErrorState message={context.error || runsQuery.error} onRetry={() => void reload()} />;
  }
  if (!context.data || !runs) return <Loading />;
  const ctx = context.data;

  const running = runs.filter((r) => r.status === "RUNNING");
  const runOn = new Map(running.map((r) => [r.machine.id, r]));
  const month = localMonth();
  const thisMonth = runs.filter((r) => r.status === "FINISHED" && r.finishedAt?.slice(0, 7) === month);
  const down = ctx.machines.filter((m) => m.status === "MAINTENANCE" || m.status === "BREAKDOWN").length;
  const free = ctx.machines.filter((m) => !runOn.has(m.id) && (m.status === "IDLE" || m.status === "RUNNING")).length;
  const shiftNow = currentShift();
  const finishRun = open?.kind === "finish" ? runs.find((r) => r.id === open.runId) : undefined;

  const exportRuns = () =>
    downloadCsv(
      `knitting-runs-${shiftNow.date}.csv`,
      ["Code", "Status", "Machine", "Fabric type", "Operator", "Yarn codes", "Yarn KG", "Fabric KG", "Change KG", "Started", "Finished", "Shifts", "Rolls", ...(showPrices ? ["Yarn cost", "Knitting charge", "Final total", "Cost per KG"] : [])],
      visible.map((r) => [
        r.runNo,
        r.status === "RUNNING" ? "Knitting" : "Finished",
        r.machine.code,
        r.fabricType ?? "",
        r.operator?.name ?? "",
        r.yarns.map((y) => `${y.itemCode} ${y.kg}`).join("; "),
        r.yarnKg.toFixed(3),
        r.outputKg?.toFixed(3) ?? "",
        r.changeKg?.toFixed(3) ?? "",
        shiftText(r.startedAt, r.startShift),
        r.finishedAt ? shiftText(r.finishedAt, r.finishShift) : "",
        r.shifts ?? "",
        r.rollCount ?? "",
        ...(showPrices ? [r.yarnCost.toFixed(2), r.knittingCharge?.toFixed(2) ?? "", r.totalCost.toFixed(2), r.costPerKg?.toFixed(2) ?? ""] : []),
      ]),
    );

  return (
    <div className="knit-page space-y-5 pb-10">
      <header className="knit-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="knit-eyebrow">Knitting machines · Day and night</p>
            <h1 className="knit-hero__title">Machines</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/65">Put Production knitting tasks on free machines, then take the fabric off into a warehouse as grey fabric under the run&apos;s own code.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="knit-shift-now">{shiftNow.shift === "DAY" ? <Sun size={15} /> : <Moon size={15} />} {SHIFT_LABEL[shiftNow.shift]} shift now · {SHIFT_HOURS[shiftNow.shift]}</span>
            {isAdmin && <Button variant="ghost" className="knit-ghost" onClick={() => setOpen({ kind: "machine", machine: null })}><Plus size={15} /> Add machine</Button>}
          </div>
        </div>
        <div className="knit-hero__stats">
          <div className="knit-glass"><p>Knitting now</p><strong>{running.length} <small>of {ctx.machines.length} machines</small></strong><span>{free} free{down ? ` · ${down} out of service` : ""}</span></div>
          <div className="knit-glass"><p>Tasks waiting</p><strong>{tasks.length}</strong><span>{kg(tasks.reduce((sum, t) => sum + t.remainingKg, 0))} of yarn to load</span></div>
          <div className="knit-glass"><p>Yarn on machines</p><strong>{kg(running.reduce((sum, r) => sum + r.yarnKg, 0))}</strong></div>
          <div className="knit-glass"><p>Fabric this month</p><strong>{kg(thisMonth.reduce((sum, r) => sum + (r.outputKg ?? 0), 0))}</strong><span>{thisMonth.length} run{thisMonth.length === 1 ? "" : "s"} finished{showPrices ? ` · ${money(thisMonth.reduce((sum, r) => sum + (r.knittingCharge ?? 0), 0))} charges` : ""}</span></div>
        </div>
      </header>

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Production</p>
            <h2 className="knit-card__title">Knitting tasks</h2>
          </div>
          <span className="text-xs font-semibold text-gray-500">{tasks.length} to put on machines</span>
        </div>
        <div className="p-4">
          {!tasksQuery.data ? (
            tasksQuery.error ? (
              <p className="knit-alert is-warn">Production tasks could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void tasksQuery.reload()}>Try again</button></p>
            ) : (
              <Loading />
            )
          ) : tasks.length === 0 ? (
            <div className="knit-empty">
              <ClipboardList size={24} />
              <p className="font-bold text-gray-900">No knitting tasks</p>
              <p className="text-sm text-gray-500">Tasks created on the Production page appear here until all their yarn is on machines.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="knit-table w-full min-w-[860px] text-sm">
                <thead><tr><th>Task</th><th>Fabric details</th><th>Yarn code</th><th className="text-right">Left to load</th><th>Required by</th><th>Rounds</th><th /></tr></thead>
                <tbody>
                  {tasks.map((task) => {
                    const due = task.knittingExpectedFinishDate?.slice(0, 10);
                    const late = !!due && due < shiftNow.date;
                    return (
                      <tr key={task.id}>
                        <td>
                          <Link href={`/production?batch=${encodeURIComponent(task.flowNo)}`} className="knit-code is-button">{task.flowNo}</Link>
                          <span className="block text-xs text-gray-500">{task.knittingPartyDetails ?? "Knitting"}</span>
                        </td>
                        <td><span className="font-semibold">{task.fabricType ?? "Fabric"}{task.fabricDiameter ? ` · ${task.fabricDiameter}` : ""}{task.fabricGsm ? ` · ${gsmText(task.fabricGsm)}` : ""}</span><span className="block text-xs text-gray-500">{[task.knittingGg, task.knittingLl].filter(Boolean).join(" · ") || "No GG / LL specified"}</span></td>
                        <td><span className="font-mono font-semibold">{task.yarnItemCode ?? "—"}</span><span className="block text-xs text-gray-500">{task.yarnCount}</span></td>
                        <td className="text-right font-semibold">{kg(task.remainingKg)}<span className="block text-xs font-normal text-gray-500">of {kg(task.purchasedWeightKg)}</span></td>
                        <td className={cn("text-xs", late ? "font-semibold text-red-600" : "text-gray-600")}>
                          {due ? shiftText(due, null) : "No due date"}
                          {late && <span className="block">Overdue</span>}
                        </td>
                        <td className="text-xs text-gray-600">
                          {task.knittingRuns.length === 0 ? "Not started" : task.knittingRuns.map((r) => r.machine.code).join(", ")}
                        </td>
                        <td className="text-right">
                          <Button size="sm" className="knit-btn is-blue" disabled={free === 0} title={free === 0 ? "No machine is free" : undefined} onClick={() => setOpen({ kind: "start", taskId: task.id })}>
                            <Play size={13} /> Select machine
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="knit-section-title">Machines</h2>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void reload()}>
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {ctx.machines.length === 0 ? (
          <div className="knit-empty">
            <Factory size={24} />
            <p className="font-bold text-gray-900">No machines yet</p>
            <p className="text-sm text-gray-500">Add your knitting machines with their yarn capacity (240 KG) and knitting charge per KG.</p>
            {isAdmin && <Button className="knit-btn mt-2" onClick={() => setOpen({ kind: "machine", machine: null })}><Plus size={15} /> Add machine</Button>}
          </div>
        ) : (
          <div className="knit-machines">
            {ctx.machines.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                run={runOn.get(machine.id)}
                tasksWaiting={tasks.length}
                onEdit={() => setOpen({ kind: "machine", machine })}
                onAssign={() => setOpen({ kind: "start", machineId: machine.id })}
                onFinish={(run) => setOpen({ kind: "finish", runId: run.id })}
                canManage={isAdmin}
                showPrices={showPrices}
              />
            ))}
          </div>
        )}
      </section>

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Record</p>
            <h2 className="knit-card__title">{isAdmin ? "Knitting runs" : "Machine work"}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="knit-tabs" role="tablist" aria-label="Show runs">
              {(["ALL", "RUNNING", "FINISHED"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={cn(filter === value && "is-active")} onClick={() => setFilter(value)}>
                  {value === "ALL" ? "All" : value === "RUNNING" ? "Knitting" : "Finished"} <span>{value === "ALL" ? runs.length : runs.filter((r) => r.status === value).length}</span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={visible.length === 0} onClick={exportRuns} title="Download the runs shown">
              <Download size={14} /> Export CSV
            </Button>
          </div>
        </div>
        <div className="p-4">
          <form
            className="knit-search"
            onSubmit={(event) => {
              event.preventDefault();
              const exact = runs.find((r) => r.runNo.toUpperCase() === q);
              const only = exact ?? (visible.length === 1 ? visible[0] : undefined);
              if (only) router.push(runHref(only.runNo));
            }}
          >
            <Search size={17} aria-hidden />
            <Input placeholder="Find a run, machine or yarn code, e.g. SS-2026-004 (Enter opens it)" aria-label="Find a run, machine or yarn code" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" spellCheck={false} />
          </form>
          {visible.length === 0 ? (
            <div className="knit-empty mt-4">
              <p className="font-bold text-gray-900">{runs.length ? `No run matches${q ? ` ${q}` : ""}` : "No runs yet"}</p>
              <p className="text-sm text-gray-500">{runs.length ? "Check the code, or show all runs." : "Put a knitting task on a machine to start the first run."}</p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="knit-table knit-register w-full min-w-[980px] text-sm">
                <thead>
                  <tr>
                    <th>Code</th><th>Machine</th><th>Yarn</th><th className="text-right">Loaded</th><th className="text-right">Fabric</th><th className="text-right">Change</th><th>Shifts</th>{showPrices && <th className="text-right">Final total</th>}<th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((run) => (
                    <tr key={run.id} onClick={() => router.push(runHref(run.runNo))}>
                      <td><Link href={runHref(run.runNo)} className="knit-code is-button" onClick={(e) => e.stopPropagation()}>{run.runNo}</Link></td>
                      <td><Link href={machineHref(run.machine.id)} className="font-semibold text-[#1b3c55] hover:underline" onClick={(e) => e.stopPropagation()}>{run.machine.code}</Link>{run.fabricType && <span className="block text-xs text-gray-500">{run.fabricType}</span>}</td>
                      <td>{run.yarns.map((y) => <span key={y.id} className="block whitespace-nowrap text-xs"><span className="font-mono font-semibold text-gray-700">{y.itemCode}</span> <span className="text-gray-500">{kg(y.kg)}</span></span>)}</td>
                      <td className="text-right font-semibold">{kg(run.yarnKg)}</td>
                      <td className="text-right font-semibold">{run.outputKg === null ? "—" : kg(run.outputKg)}</td>
                      <td className="text-right"><ChangeText run={run} tolerance={ctx.toleranceKg} /></td>
                      <td className="whitespace-nowrap text-xs text-gray-600">{shiftText(run.startedAt, run.startShift)}<span className="block">{run.finishedAt ? `→ ${shiftText(run.finishedAt, run.finishShift)}` : "→ knitting"}</span></td>
                      {showPrices && <td className="text-right font-bold">{money(run.totalCost)}{run.costPerKg !== null && <span className="block text-xs font-normal text-gray-500">{money(run.costPerKg)} / KG</span>}</td>}
                      <td><span className={cn("knit-pill", run.status === "RUNNING" ? "is-live" : "is-done")}>{run.status === "RUNNING" ? "Knitting" : "Finished"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {open?.kind === "machine" && (
        <MachineDialog
          machine={open.machine}
          defaultCapacityKg={ctx.defaultCapacityKg}
          existingCodes={ctx.machines.map((m) => m.code)}
          knitting={open.machine ? runOn.get(open.machine.id)?.runNo ?? null : null}
          onClose={() => setOpen(null)}
          onSaved={done}
        />
      )}
      {open?.kind === "start" && (
        <StartRunDialog
          context={ctx}
          busyMachines={new Set(runOn.keys())}
          tasks={tasks}
          taskId={open.taskId}
          machineId={open.machineId}
          onClose={() => setOpen(null)}
          onStarted={(run) => done(`${run.runNo} started on ${run.machine.code} with ${kg(run.yarnKg)} of yarn.`)}
          showPrices={showPrices}
        />
      )}
      {finishRun && (
        <FinishRunDialog
          run={finishRun}
          context={ctx}
          onClose={() => setOpen(null)}
          onFinished={(run) => done(`${run.runNo} finished: ${kg(run.outputKg ?? 0)} of grey fabric put into ${run.warehouse?.code ?? "stock"}.${showPrices ? ` Final total ${money(run.totalCost)}.` : ""}`)}
          showPrices={showPrices}
        />
      )}
    </div>
  );
}

function ChangeText({ run, tolerance }: { run: KnitRun; tolerance: number }) {
  if (run.changeKg === null) return <span className="text-gray-400">—</span>;
  const outside = Math.abs(run.changeKg) > tolerance + EMPTY;
  return (
    <span className={cn("font-semibold", outside ? "text-amber-700" : run.changeKg > EMPTY ? "text-emerald-700" : run.changeKg < -EMPTY ? "text-rose-700" : "text-gray-600")} title={outside ? `More than ${tolerance} KG off the yarn loaded` : undefined}>
      {run.changeKg >= 0 ? "+" : "−"}{kg(Math.abs(run.changeKg))}
    </span>
  );
}

/** A machine and its current run. An idle machine can be given a waiting task straight from here. */
function MachineCard({
  machine,
  run,
  tasksWaiting,
  onEdit,
  onAssign,
  onFinish,
  canManage,
  showPrices,
}: {
  machine: KnitMachine;
  run: KnitRun | undefined;
  tasksWaiting: number;
  onEdit: () => void;
  onAssign: () => void;
  onFinish: (run: KnitRun) => void;
  canManage: boolean;
  showPrices: boolean;
}) {
  const down = machine.status === "MAINTENANCE" || machine.status === "BREAKDOWN";
  const state = run ? "knitting" : down ? "down" : "idle";
  const loaded = run?.yarnKg ?? 0;
  const pct = machine.capacityKg > 0 ? Math.min(100, (loaded / machine.capacityKg) * 100) : 0;
  return (
    <article className={cn("knit-machine", `is-${state}`)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={machineHref(machine.id)} className="knit-machine__code hover:underline" title={`Open ${machine.code}`}>{machine.code}</Link>
          <p className="truncate text-xs text-gray-500">{machine.name}{machine.type ? ` · ${machine.type}` : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("knit-pill", run ? "is-live" : down ? "is-down" : "is-idle")}>{run ? "Knitting" : down ? humanize(machine.status) : "Idle"}</span>
          {canManage && <button type="button" className="knit-icon-btn" aria-label={`Edit ${machine.code}`} title="Edit machine" onClick={onEdit}><Pencil size={14} /></button>}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-gray-600">{run ? `${kg(loaded)} loaded` : "Empty"}</span>
          <span className="text-gray-400">capacity {kg(machine.capacityKg)}</span>
        </div>
        <div className="knit-loadbar mt-1.5"><span style={{ width: `${pct}%` }} /></div>
      </div>

      {run ? (
        <div className="space-y-2">
          <Link href={runHref(run.runNo)} className="knit-machine__run">
            <span className="knit-code">{run.runNo}</span>
            <span className="text-xs text-gray-500">{run.fabricType ?? `${run.yarns.length} yarn${run.yarns.length === 1 ? "" : "s"}`}</span>
          </Link>
          <div className="flex flex-wrap gap-1">
            {run.yarns.map((y) => <span key={y.id} className="knit-chip">{y.itemCode} · {y.sharePct.toFixed(0)}%</span>)}
          </div>
          <p className="text-xs text-gray-500">Since {shiftText(run.startedAt, run.startShift)}{run.operator ? ` · ${run.operator.name}` : ""}</p>
          <p className="text-xs text-gray-500">Expect {kg(run.expectedMinKg)} – {kg(run.expectedMaxKg)} of fabric</p>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {down
            ? `Out of service (${humanize(machine.status).toLowerCase()}). Set it back to Idle before assigning a task.`
            : tasksWaiting
              ? `${tasksWaiting} knitting task${tasksWaiting === 1 ? "" : "s"} waiting for a machine.`
              : "Waiting for a Production knitting task."}
        </p>
      )}

      <div className="knit-machine__foot">
        <span className="text-xs text-gray-500">{showPrices ? (machine.ratePerKg ? `${money(machine.ratePerKg)} / KG knitting` : "No knitting charge set") : run ? "Work in progress" : "Ready for work"}</span>
        {run ? (
          <Button size="sm" className="knit-btn is-blue" onClick={() => onFinish(run)}><CheckCircle2 size={14} /> Finish</Button>
        ) : !down && tasksWaiting > 0 ? (
          <Button size="sm" className="knit-btn" onClick={onAssign}><Play size={13} /> Assign task</Button>
        ) : (
          <span className="text-xs font-semibold text-gray-400">{down ? "Out of service" : "No task waiting"}</span>
        )}
      </div>
    </article>
  );
}
