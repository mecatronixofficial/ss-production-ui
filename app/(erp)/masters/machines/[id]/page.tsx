"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, CalendarCheck, CheckCircle2, Download, Factory, Pencil, Play, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { ADMIN_ROLES } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, formatDate, humanize, kg, money } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Empty } from "@/components/empty";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { MachineExpensesView } from "../costs";
import { MachineDialog } from "../machine-dialog";
import { MachineProductionReport } from "../production-report";
import { AssignMachinesDialog, DayEntryDialog, FinishRunDialog, MoveRunDialog } from "../run-dialogs";
import { currentShift, dayOf, daysOnMachine, EMPTY, fabricSpec, lastProductionDay, localMonth, monthKg, runHref, runOnDay, SHIFT_LABEL, shiftIndex, shiftText, type KnitBoard, type KnitMachine, type KnitRun, type Shift } from "../types";
import "../machines.css";

type Open = "edit" | "assign" | "day" | "finish" | "move" | null;

/** The shifts during which a run occupied this machine on a production date. */
function shiftsOnDate(run: KnitRun, date: string): Shift[] {
  const first = shiftIndex(run.startedAt.slice(0, 10), run.startShift);
  const last = run.finishedAt && run.finishShift ? shiftIndex(run.finishedAt.slice(0, 10), run.finishShift) : Number.POSITIVE_INFINITY;
  return (["DAY", "NIGHT"] as const).filter((shift) => {
    const point = shiftIndex(date, shift);
    return point >= first && point <= last;
  });
}

const shiftList = (run: KnitRun, date: string) => shiftsOnDate(run, date).map((shift) => SHIFT_LABEL[shift]).join(" + ") || "—";

/** `/masters/machines/<id>`: one knitting machine — its setup, the work on it now, its days and every run it has knitted. */
export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  // The floor (shared with the Machines page, so usually already loaded) and this machine's own runs.
  const context = useApiQuery<KnitBoard>("/knitting/board");
  const runsQuery = useApiQuery<KnitRun[]>(`/knitting/runs?machineId=${encodeURIComponent(id)}`);
  const [open, setOpen] = useState<Open>(null);
  const [filter, setFilter] = useState<"ALL" | "RUNNING" | "FINISHED">("ALL");

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const tasks = context.data?.tasks ?? [];

  const back = <Link href="/masters/machines" className="purchases-back-link"><ArrowLeft size={15} /> Machines</Link>;
  const reload = () => Promise.all([context.reload(), runsQuery.reload()]);

  if ((!context.data && context.error) || (!runsQuery.data && runsQuery.error)) {
    return <div className="knit-page space-y-4">{back}<ErrorState message={context.error || runsQuery.error} onRetry={() => void reload()} /></div>;
  }
  if (!context.data || !runsQuery.data) return <Loading />;

  const ctx = context.data;
  const machine: KnitMachine | undefined = ctx.machines.find((m) => m.id === id);
  // A removed (disabled) machine is no longer in the machine list; its runs still say what it was.
  const known = machine ?? (runs[0] ? { ...runs[0].machine, ratePerKg: 0, manufacturer: null, status: "DISABLED" as const } : undefined);
  if (!known) {
    return (
      <div className="knit-page space-y-4">
        {back}
        <Empty title="Machine not found" description="It may have been removed. Open a machine from the Machines page." />
      </div>
    );
  }

  const current = runs.find((r) => r.status === "RUNNING");
  const today = currentShift().date;
  const lastDay = lastProductionDay();
  const month = localMonth();
  const fabricKg = runs.reduce((sum, r) => sum + (r.outputKg ?? 0), 0);
  const rolls = runs.reduce((sum, r) => sum + (r.rollCount ?? 0), 0);
  const days = runs.flatMap((r) => r.days.map((d) => ({ ...d, run: r }))).sort((a, b) => b.date.localeCompare(a.date) || a.run.runNo.localeCompare(b.run.runNo));
  const worked = days.filter((d) => d.outputKg > EMPTY);
  const charges = runs.reduce((sum, r) => sum + (r.knittingCharge ?? 0), 0);
  const operators = [...new Map(runs.flatMap((r) => (r.operator ? [[r.operator.id, r.operator] as const] : []))).values()];
  const down = known.status === "MAINTENANCE" || known.status === "BREAKDOWN";
  const removed = !machine;
  const visible = filter === "ALL" ? runs : runs.filter((r) => r.status === filter);
  const busyMachines = new Set(ctx.busyMachineIds);
  const yesterdayDue = !!current && runOnDay(current, lastDay) && !dayOf(current, lastDay);

  const done = (text: string) => {
    toast.success(text);
    setOpen(null);
    void reload();
  };
  const backInService = async () => {
    try {
      await api(`/masters/machines/${known.id}`, { method: "PATCH", body: JSON.stringify({ status: "IDLE" }) });
      done(`${known.code} is back in service.`);
    } catch (e) {
      toast.error(errorMessage(e, "Could not change the machine"));
    }
  };

  const exportDays = () =>
    downloadCsv(
      `${known.code}-days-${month}.csv`,
      ["Production day", "Shifts active", "Run", "Task", "Fabric specification", "Yarn", "Operator", "Fabric KG (day total)", "Rolls (day total)", "Warehouse", "Note"],
      days.map((d) => [d.date, shiftList(d.run, d.date), d.run.runNo, d.run.productionFlow?.flowNo ?? "", fabricSpec({ ...d.run.productionFlow, fabricType: d.run.fabricType }), d.run.yarns.map((y) => y.itemCode).join(", "), d.run.operator?.name ?? "", d.outputKg.toFixed(3), d.rollCount, d.warehouse.code, d.notes ?? ""]),
    );

  const specs: Array<[string, React.ReactNode]> = [
    ["Code", known.code],
    ["Name", known.name],
    ["Knitting type / model", known.type ?? "—"],
    ...(isAdmin ? ([["Knitting charge", known.ratePerKg ? `${money(known.ratePerKg)} / KG of fabric` : "Not set"]] as Array<[string, React.ReactNode]>) : []),
    ["Manufacturer", known.manufacturer ?? "—"],
    ["Status", removed ? "Removed" : current ? "Knitting" : humanize(known.status)],
    ["Operators", operators.length ? operators.map((o) => o.name).join(", ") : "None recorded"],
  ];

  return (
    <div className="knit-page space-y-4 pb-10">
      {back}

      <header className="knit-run-head">
        <span className={cn("knit-dialog__icon", current ? "is-gold" : down || removed ? "is-blue" : "is-green")}><Factory size={17} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#123f35]">
            <span className="font-mono">{known.code}</span>
            <span className={cn("knit-pill", current ? "is-live" : down || removed ? "is-down" : "is-idle")}>
              {removed ? "Removed" : current ? "Knitting" : down ? humanize(known.status) : "Idle"}
            </span>
          </h1>
          <p className="text-sm text-gray-500">{known.name}{known.type ? ` · ${known.type}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && machine && <Button variant="outline" onClick={() => setOpen("edit")}><Pencil size={15} /> Edit machine</Button>}
          {current ? (
            <>
              <Button variant="outline" onClick={() => setOpen("day")}><CalendarCheck size={15} /> Enter day</Button>
              {current.productionFlow && <Button variant="outline" onClick={() => setOpen("move")}><ArrowRightLeft size={15} /> Change machine</Button>}
              <Button className="knit-btn is-blue" onClick={() => setOpen("finish")}><CheckCircle2 size={15} /> Stop {current.runNo}</Button>
            </>
          ) : machine && down ? (
            <Button variant="outline" onClick={() => void backInService()}><Wrench size={15} /> Back in service</Button>
          ) : (
            machine && (
              <Button className="knit-btn" disabled={tasks.length === 0} title={tasks.length ? undefined : "No knitting task is open"} onClick={() => setOpen("assign")}>
                <Play size={14} /> Assign task
              </Button>
            )
          )}
        </div>
      </header>

      {removed && <p className="knit-alert is-warn">This machine was removed. Its runs stay in the record below.</p>}
      {down && !removed && <p className="knit-alert is-warn">Out of service ({humanize(known.status).toLowerCase()}). Put it back in service when it&apos;s repaired to give it new work.</p>}

      <div className="knit-machine-stats">
        <div className="knit-figure"><p className="knit-figure__label">Fabric knitted</p><p className="knit-figure__value">{kg(fabricKg)}</p><p className="knit-figure__note">{rolls} rolls · {runs.length} run{runs.length === 1 ? "" : "s"}</p></div>
        <div className="knit-figure"><p className="knit-figure__label">This month</p><p className="knit-figure__value">{kg(monthKg(runs, month))}</p><p className="knit-figure__note">{days.filter((d) => d.date.slice(0, 7) === month).length} day{days.filter((d) => d.date.slice(0, 7) === month).length === 1 ? "" : "s"} entered</p></div>
        <div className="knit-figure"><p className="knit-figure__label">Days knitted</p><p className="knit-figure__value">{worked.length}</p><p className="knit-figure__note">{days.length - worked.length ? `${days.length - worked.length} stood still` : "Entered at day end"}</p></div>
        <div className="knit-figure"><p className="knit-figure__label">Per day</p><p className="knit-figure__value">{worked.length ? kg(worked.reduce((sum, d) => sum + d.outputKg, 0) / worked.length) : "—"}</p><p className="knit-figure__note">average of the days it knitted</p></div>
        {isAdmin && <div className="knit-figure"><p className="knit-figure__label">Knitting charges</p><p className="knit-figure__value">{money(charges)}</p><p className="knit-figure__note">{fabricKg > EMPTY ? `${money(charges / fabricKg)} per KG on average` : "Nothing knitted yet"}</p></div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="knit-card">
          <div className="knit-card__head"><div><p className="knit-card__eyebrow">Setup</p><h2 className="knit-card__title">Machine details</h2></div></div>
          <div className="p-4">
            <dl className="knit-facts">
              {specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="knit-card">
          <div className="knit-card__head"><div><p className="knit-card__eyebrow">Now</p><h2 className="knit-card__title">{current ? "On the machine" : "Nothing knitting"}</h2></div></div>
          <div className="space-y-3 p-4">
            {current ? (
              <>
                <Link href={runHref(current.runNo)} className="knit-machine__run">
                  <span className="knit-code">{current.runNo}</span>
                  <span className="text-xs text-gray-500">{current.productionFlow?.flowNo ?? ""}{current.fabricType ? ` · ${current.fabricType}` : ""}</span>
                </Link>
                <dl className="knit-spec">
                  <div><dt>Fabric</dt><dd>{fabricSpec({ ...current.productionFlow, fabricType: current.fabricType }) || "—"}</dd></div>
                  <div><dt>Yarn</dt><dd>{[current.yarns.map((y) => y.itemCode).join(", "), current.productionFlow?.yarnCount, current.yarns[0]?.lotNo && `lot ${current.yarns[0].lotNo}`].filter(Boolean).join(" · ") || "—"}</dd></div>
                  <div><dt>Operator</dt><dd>{current.operator ? `${current.operator.name} · ${current.operator.code}` : "Not recorded"}</dd></div>
                </dl>
                <div className="knit-machine__nums">
                  <div><p>Knitted</p><strong>{kg(current.outputKg ?? 0)}</strong></div>
                  <div><p>Rolls</p><strong>{current.rollCount ?? 0}</strong></div>
                  <div><p>Day</p><strong>{daysOnMachine(current, today)}</strong></div>
                </div>
                {yesterdayDue && (
                  <button type="button" className="knit-day-due" onClick={() => setOpen("day")}>{formatDate(lastDay)} not entered · enter now</button>
                )}
                <p className="text-xs text-gray-500">Since {shiftText(current.startedAt, current.startShift)}{current.operator ? ` · ${current.operator.name}` : ""}{current.avgPerDayKg ? ` · about ${kg(current.avgPerDayKg)} a day` : ""}</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                {removed ? "Removed machines take no new work." : down ? "Out of service." : tasks.length ? `${tasks.length} knitting task${tasks.length === 1 ? "" : "s"} open — use Assign task.` : "No knitting task is open."}
              </p>
            )}
          </div>
        </section>
      </div>

      <MachineProductionReport machineId={id} />
      {isAdmin && machine && <MachineExpensesView machines={[machine]} runs={runs} machineId={machine.id} />}

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Day by day</p>
            <h2 className="knit-card__title">Production on {known.code}</h2>
            <p className="mt-1 text-xs text-gray-500">Full production-day totals, with the Day and Night shifts during which each run occupied the machine.</p>
          </div>
          <Button size="sm" variant="outline" disabled={days.length === 0} onClick={exportDays}><Download size={14} /> Export CSV</Button>
        </div>
        <div className="p-4">
          {days.length === 0 ? (
            <div className="knit-empty">
              <p className="font-bold text-gray-900">No day entered yet</p>
              <p className="text-sm text-gray-500">Each day&apos;s fabric KG and rolls show here once they are entered at day end.</p>
            </div>
          ) : (
            <div className="max-h-[30rem] overflow-auto rounded-xl border">
              <table className="knit-table knit-register w-full min-w-[1120px] text-sm">
                <thead><tr><th>Production day</th><th>Shift run</th><th>Run / batch</th><th>Fabric</th><th>Yarn / operator</th><th className="text-right">Day total KG</th><th className="text-right">Day total rolls</th><th>Into</th><th>Note</th></tr></thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.id} onClick={() => router.push(runHref(d.run.runNo))}>
                      <td className="font-semibold">{formatDate(d.date)}</td>
                      <td><span className="knit-pill is-idle">{shiftList(d.run, d.date)}</span></td>
                      <td><span className="knit-code">{d.run.runNo}</span><span className="block text-xs text-gray-500">{d.run.productionFlow?.flowNo ?? "No batch"}</span></td>
                      <td className="max-w-[260px] text-xs text-gray-600">{fabricSpec({ ...d.run.productionFlow, fabricType: d.run.fabricType }) || "—"}</td>
                      <td className="text-xs text-gray-600"><span className="font-mono">{d.run.yarns.map((y) => y.itemCode).join(", ") || "—"}</span><span className="block">{d.run.operator?.name ?? "No operator"}</span></td>
                      <td className={cn("text-right font-semibold", d.outputKg <= 0 && "text-gray-400")}>{d.outputKg > 0 ? kg(d.outputKg) : "Stood still"}</td>
                      <td className="text-right">{d.rollCount}</td>
                      <td className="text-xs text-gray-600">{d.warehouse.code}</td>
                      <td className="text-xs text-gray-600">{d.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Record</p>
            <h2 className="knit-card__title">Runs on {known.code}</h2>
          </div>
          <div className="knit-tabs" role="tablist" aria-label="Show runs">
            {(["ALL", "RUNNING", "FINISHED"] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className={cn(filter === value && "is-active")} onClick={() => setFilter(value)}>
                {value === "ALL" ? "All" : value === "RUNNING" ? "Knitting" : "Finished"} <span>{value === "ALL" ? runs.length : runs.filter((r) => r.status === value).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          {visible.length === 0 ? (
            <div className="knit-empty">
              <p className="font-bold text-gray-900">{runs.length ? "No runs with this status" : "No runs yet"}</p>
              <p className="text-sm text-gray-500">{runs.length ? "Show all runs." : "Runs appear here once a task is put on this machine."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="knit-table knit-register w-full min-w-[900px] text-sm">
                <thead>
                  <tr><th>Code</th><th>Task / fabric</th><th className="text-right">Days</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th><th>Run date & time</th><th>Operator / yarn</th>{isAdmin && <th className="text-right">Total</th>}<th>Status</th></tr>
                </thead>
                <tbody>
                  {visible.map((run) => (
                    <tr key={run.id} onClick={() => router.push(runHref(run.runNo))}>
                      <td><Link href={runHref(run.runNo)} className="knit-code is-button" onClick={(e) => e.stopPropagation()}>{run.runNo}</Link>{run.fabricType && <span className="block text-xs text-gray-500">{run.fabricType}</span>}</td>
                      <td className="max-w-[260px] text-xs text-gray-600"><span className="font-semibold text-gray-800">{run.productionFlow?.flowNo ?? "—"}</span><span className="block">{fabricSpec({ ...run.productionFlow, fabricType: run.fabricType }) || "No fabric specification"}</span></td>
                      <td className="text-right">{run.days.length || "—"}</td>
                      <td className="text-right font-semibold">{run.outputKg === null ? "—" : kg(run.outputKg)}</td>
                      <td className="text-right">{run.rollCount ?? "—"}</td>
                      <td className="whitespace-nowrap text-xs text-gray-600">
                        {shiftText(run.startedAt, run.startShift)}
                        <span className="block">{run.finishedAt ? `→ ${shiftText(run.finishedAt, run.finishShift)}` : "→ knitting"}</span>
                        <span className="block font-semibold text-gray-700">{run.shifts ? `${run.shifts} shift${run.shifts === 1 ? "" : "s"}` : `${daysOnMachine(run, today)} production day${daysOnMachine(run, today) === 1 ? "" : "s"}`}</span>
                        {run.endReason && <span className="block font-semibold text-amber-700">{run.endReason}</span>}
                      </td>
                      <td className="text-xs text-gray-600">{run.operator?.name ?? "—"}<span className="block font-mono text-[11px] text-gray-500">{run.yarns.map((y) => y.itemCode).join(", ") || "No yarn code"}</span></td>
                      {isAdmin && <td className="text-right font-bold">{money(run.totalCost)}</td>}
                      <td><span className={cn("knit-pill", run.status === "RUNNING" ? "is-live" : "is-done")}>{run.status === "RUNNING" ? "Knitting" : "Finished"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {open === "edit" && machine && (
        <MachineDialog
          machine={machine}
          existingCodes={ctx.machines.map((m) => m.code)}
          knitting={current?.runNo ?? null}
          onClose={() => setOpen(null)}
          onSaved={done}
          onRemoved={(text) => {
            // A removed machine leaves the Machines list, so go back there.
            toast.success(text);
            router.push("/masters/machines");
          }}
        />
      )}
      {open === "assign" && machine && (
        <AssignMachinesDialog
          context={ctx}
          busyMachines={busyMachines}
          tasks={tasks}
          machineId={machine.id}
          onClose={() => setOpen(null)}
          onAssigned={(started) => done(`${started[0]?.productionFlow?.flowNo ?? "Task"} started on ${started.map((r) => r.machine.code).join(", ")}.`)}
          showPrices={isAdmin}
        />
      )}
      {open === "day" && current && (
        <DayEntryDialog context={ctx} runs={runs} runId={current.id} onClose={() => setOpen(null)} onSaved={(_, date) => done(`${formatDate(date)} saved for ${known.code}.`)} />
      )}
      {open === "finish" && current && (
        <FinishRunDialog
          run={current}
          context={ctx}
          showPrices={isAdmin}
          onClose={() => setOpen(null)}
          onFinished={(run) => done(`${known.code} stopped: ${run.runNo} knitted ${kg(run.outputKg ?? 0)} in ${run.days.length} day${run.days.length === 1 ? "" : "s"}.`)}
        />
      )}
      {open === "move" && current && (
        <MoveRunDialog
          run={current}
          context={ctx}
          busyMachines={busyMachines}
          onClose={() => setOpen(null)}
          onMoved={(run) => done(`${known.code} → ${run.machine.code}: the work carries on as ${run.runNo}.`)}
        />
      )}
    </div>
  );
}
