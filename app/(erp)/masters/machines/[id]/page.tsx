"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Factory, Pencil, Play } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { ADMIN_ROLES } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, humanize, kg, money } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Empty } from "@/components/empty";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { MachineDialog } from "../machine-dialog";
import { FinishRunDialog, StartRunDialog } from "../run-dialogs";
import { EMPTY, localMonth, openTasks, runHref, shiftText, type KnitContext, type KnitMachine, type KnitRun, type ProductionTask } from "../types";
import "../machines.css";

type Open = "edit" | "start" | "finish" | null;

/** `/masters/machines/<id>`: one knitting machine — its setup, the run on it now, and every run it has knitted. */
export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const context = useApiQuery<KnitContext>("/knitting/context");
  const runsQuery = useApiQuery<KnitRun[]>("/knitting/runs");
  const tasksQuery = useApiQuery<{ data: ProductionTask[] }>("/production/fabric-flows");
  const [open, setOpen] = useState<Open>(null);
  const [filter, setFilter] = useState<"ALL" | "RUNNING" | "FINISHED">("ALL");

  const runs = useMemo(() => (runsQuery.data ?? []).filter((r) => r.machine.id === id), [runsQuery.data, id]);
  const tasks = useMemo(() => openTasks(tasksQuery.data?.data ?? []), [tasksQuery.data]);

  const back = <Link href="/masters/machines" className="purchases-back-link"><ArrowLeft size={15} /> Machines</Link>;
  const reload = () => Promise.all([context.reload(), runsQuery.reload(), tasksQuery.reload()]);

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
  const finishedRuns = runs.filter((r) => r.status === "FINISHED");
  const month = localMonth();
  const thisMonth = finishedRuns.filter((r) => r.finishedAt?.slice(0, 7) === month);
  const fabricKg = finishedRuns.reduce((sum, r) => sum + (r.outputKg ?? 0), 0);
  const yarnFinishedKg = finishedRuns.reduce((sum, r) => sum + r.yarnKg, 0);
  const shifts = finishedRuns.reduce((sum, r) => sum + (r.shifts ?? 0), 0);
  const charges = finishedRuns.reduce((sum, r) => sum + (r.knittingCharge ?? 0), 0);
  const operators = [...new Map(runs.flatMap((r) => (r.operator ? [[r.operator.id, r.operator] as const] : []))).values()];
  const down = known.status === "MAINTENANCE" || known.status === "BREAKDOWN";
  const removed = !machine;
  const capacity = known.capacityKg;
  const pct = current && capacity > 0 ? Math.min(100, (current.yarnKg / capacity) * 100) : 0;
  const visible = filter === "ALL" ? runs : runs.filter((r) => r.status === filter);

  const done = (text: string) => {
    toast.success(text);
    setOpen(null);
    void reload();
  };

  const exportRuns = () =>
    downloadCsv(
      `${known.code}-runs-${month}.csv`,
      ["Code", "Status", "Fabric type", "Operator", "Yarn codes", "Yarn KG", "Fabric KG", "Change KG", "Started", "Finished", "Shifts", "Rolls", ...(isAdmin ? ["Knitting charge", "Final total"] : [])],
      visible.map((r) => [
        r.runNo,
        r.status === "RUNNING" ? "Knitting" : "Finished",
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
        ...(isAdmin ? [r.knittingCharge?.toFixed(2) ?? "", r.totalCost.toFixed(2)] : []),
      ]),
    );

  const specs: Array<[string, React.ReactNode]> = [
    ["Code", known.code],
    ["Name", known.name],
    ["Knitting type / model", known.type ?? "—"],
    ["Yarn capacity per load", kg(capacity)],
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
            <Button className="knit-btn is-blue" onClick={() => setOpen("finish")}><CheckCircle2 size={15} /> Finish {current.runNo}</Button>
          ) : (
            machine && !down && (
              <Button className="knit-btn" disabled={tasks.length === 0} title={tasks.length ? undefined : "No knitting task is waiting"} onClick={() => setOpen("start")}>
                <Play size={14} /> Assign task
              </Button>
            )
          )}
        </div>
      </header>

      {removed && <p className="knit-alert is-warn">This machine was removed. Its runs stay in the record below.</p>}
      {down && !removed && <p className="knit-alert is-warn">Out of service ({humanize(known.status).toLowerCase()}). Set it back to Idle to give it new work.</p>}

      <div className="knit-machine-stats">
        <div className="knit-figure"><p className="knit-figure__label">Runs</p><p className="knit-figure__value">{runs.length}</p><p className="knit-figure__note">{finishedRuns.length} finished{current ? " · 1 knitting" : ""}</p></div>
        <div className="knit-figure"><p className="knit-figure__label">Fabric knitted</p><p className="knit-figure__value">{kg(fabricKg)}</p><p className="knit-figure__note">from {kg(yarnFinishedKg)} of yarn{yarnFinishedKg > 0 ? ` · ${fabricKg - yarnFinishedKg >= 0 ? "+" : "−"}${kg(Math.abs(fabricKg - yarnFinishedKg))}` : ""}</p></div>
        <div className="knit-figure"><p className="knit-figure__label">This month</p><p className="knit-figure__value">{kg(thisMonth.reduce((sum, r) => sum + (r.outputKg ?? 0), 0))}</p><p className="knit-figure__note">{thisMonth.length} run{thisMonth.length === 1 ? "" : "s"} finished</p></div>
        <div className="knit-figure"><p className="knit-figure__label">Shifts worked</p><p className="knit-figure__value">{shifts}</p><p className="knit-figure__note">{finishedRuns.length ? `about ${(shifts / finishedRuns.length).toFixed(1)} per run` : "No finished runs yet"}</p></div>
        {isAdmin && <div className="knit-figure"><p className="knit-figure__label">Knitting charges</p><p className="knit-figure__value">{money(charges)}</p><p className="knit-figure__note">{fabricKg > EMPTY ? `${money(charges / fabricKg)} per KG on average` : "All finished runs"}</p></div>}
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
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-gray-600">{current ? `${kg(current.yarnKg)} loaded` : "Empty"}</span>
                <span className="text-gray-400">capacity {kg(capacity)}</span>
              </div>
              <div className="knit-loadbar mt-1.5"><span style={{ width: `${pct}%` }} /></div>
            </div>
            {current ? (
              <>
                <Link href={runHref(current.runNo)} className="knit-machine__run">
                  <span className="knit-code">{current.runNo}</span>
                  <span className="text-xs text-gray-500">{current.fabricType ?? `${current.yarns.length} yarn${current.yarns.length === 1 ? "" : "s"}`}</span>
                </Link>
                <div className="flex flex-wrap gap-1">
                  {current.yarns.map((y) => <span key={y.id} className="knit-chip">{y.itemCode} · {kg(y.kg)}</span>)}
                </div>
                <p className="text-xs text-gray-500">Since {shiftText(current.startedAt, current.startShift)}{current.operator ? ` · ${current.operator.name}` : ""}</p>
                <p className="text-xs text-gray-500">Expect {kg(current.expectedMinKg)} – {kg(current.expectedMaxKg)} of fabric</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                {removed ? "Removed machines take no new work." : down ? "Out of service." : tasks.length ? `${tasks.length} knitting task${tasks.length === 1 ? "" : "s"} waiting — use Assign task.` : "No knitting task is waiting."}
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Record</p>
            <h2 className="knit-card__title">Runs on {known.code}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="knit-tabs" role="tablist" aria-label="Show runs">
              {(["ALL", "RUNNING", "FINISHED"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={cn(filter === value && "is-active")} onClick={() => setFilter(value)}>
                  {value === "ALL" ? "All" : value === "RUNNING" ? "Knitting" : "Finished"} <span>{value === "ALL" ? runs.length : runs.filter((r) => r.status === value).length}</span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={visible.length === 0} onClick={exportRuns}><Download size={14} /> Export CSV</Button>
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
                  <tr><th>Code</th><th>Yarn</th><th className="text-right">Loaded</th><th className="text-right">Fabric</th><th className="text-right">Change</th><th>Shifts</th><th>Operator</th>{isAdmin && <th className="text-right">Final total</th>}<th>Status</th></tr>
                </thead>
                <tbody>
                  {visible.map((run) => {
                    const outside = run.changeKg !== null && Math.abs(run.changeKg) > ctx.toleranceKg + EMPTY;
                    return (
                      <tr key={run.id} onClick={() => router.push(runHref(run.runNo))}>
                        <td><Link href={runHref(run.runNo)} className="knit-code is-button" onClick={(e) => e.stopPropagation()}>{run.runNo}</Link>{run.fabricType && <span className="block text-xs text-gray-500">{run.fabricType}</span>}</td>
                        <td>{run.yarns.map((y) => <span key={y.id} className="block whitespace-nowrap text-xs"><span className="font-mono font-semibold text-gray-700">{y.itemCode}</span> <span className="text-gray-500">{kg(y.kg)}</span></span>)}</td>
                        <td className="text-right font-semibold">{kg(run.yarnKg)}</td>
                        <td className="text-right font-semibold">{run.outputKg === null ? "—" : kg(run.outputKg)}</td>
                        <td className={cn("text-right font-semibold", run.changeKg === null ? "text-gray-400" : outside ? "text-amber-700" : run.changeKg > EMPTY ? "text-emerald-700" : run.changeKg < -EMPTY ? "text-rose-700" : "text-gray-600")}>
                          {run.changeKg === null ? "—" : `${run.changeKg >= 0 ? "+" : "−"}${kg(Math.abs(run.changeKg))}`}
                        </td>
                        <td className="whitespace-nowrap text-xs text-gray-600">{shiftText(run.startedAt, run.startShift)}<span className="block">{run.finishedAt ? `→ ${shiftText(run.finishedAt, run.finishShift)}` : "→ knitting"}</span></td>
                        <td className="text-xs text-gray-600">{run.operator?.name ?? "—"}</td>
                        {isAdmin && <td className="text-right font-bold">{money(run.totalCost)}</td>}
                        <td><span className={cn("knit-pill", run.status === "RUNNING" ? "is-live" : "is-done")}>{run.status === "RUNNING" ? "Knitting" : "Finished"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {open === "edit" && machine && (
        <MachineDialog
          machine={machine}
          defaultCapacityKg={ctx.defaultCapacityKg}
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
      {open === "start" && machine && (
        <StartRunDialog
          context={ctx}
          busyMachines={new Set(runsQuery.data.filter((r) => r.status === "RUNNING").map((r) => r.machine.id))}
          tasks={tasks}
          machineId={machine.id}
          onClose={() => setOpen(null)}
          onStarted={(run) => done(`${run.runNo} started on ${run.machine.code} with ${kg(run.yarnKg)} of yarn.`)}
          showPrices={isAdmin}
        />
      )}
      {open === "finish" && current && (
        <FinishRunDialog
          run={current}
          context={ctx}
          showPrices={isAdmin}
          onClose={() => setOpen(null)}
          onFinished={(run) => done(`${run.runNo} finished: ${kg(run.outputKg ?? 0)} of grey fabric put into ${run.warehouse?.code ?? "stock"}.${isAdmin ? ` Final total ${money(run.totalCost)}.` : ""}`)}
        />
      )}
    </div>
  );
}
