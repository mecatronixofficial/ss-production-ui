"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, CalendarCheck, CheckCircle2, Factory, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { ADMIN_ROLES } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, formatDate, kg, money } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Empty } from "@/components/empty";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { itemHref } from "../../../warehouses/item-details";
import { DayEntryDialog, FinishRunDialog, MoveRunDialog } from "../run-dialogs";
import { Figure } from "../knit-dialog";
import { currentShift, daysOnMachine, fabricSpec, machineHref, shiftText, type KnitContext, type KnitRun } from "../types";
import "../machines.css";

type Open = { kind: "day"; date?: string } | { kind: "finish" } | { kind: "move" } | null;

/** `/masters/machines/run?code=01SS26-KT01-R1`: one task's work on one machine, day by day, and what can be done with it. */
function RunPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const code = params.get("code")?.trim() ?? "";
  const context = useApiQuery<KnitContext>("/knitting/context");
  // Only this run: it carries its task's other machines with it.
  const runsQuery = useApiQuery<KnitRun[]>(code ? `/knitting/runs?code=${encodeURIComponent(code)}` : null);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const back = (
    <Link href="/masters/machines" className="purchases-back-link"><ArrowLeft size={15} /> Machines</Link>
  );
  if ((!context.data && context.error) || (!runsQuery.data && runsQuery.error)) {
    return <div className="knit-page space-y-4">{back}<ErrorState message={context.error || runsQuery.error} onRetry={() => void Promise.all([context.reload(), runsQuery.reload()])} /></div>;
  }
  if (!context.data || (code && !runsQuery.data)) return <Loading />;
  const runs = runsQuery.data ?? [];
  const run = runs.find((r) => r.runNo.toUpperCase() === code.toUpperCase());
  if (!run) {
    return (
      <div className="knit-page space-y-4">
        {back}
        <Empty title={code ? `No knitting run ${code}` : "No run code given"} description="It may have been cancelled. Open a run from the Machines page." />
      </div>
    );
  }

  const ctx = context.data;
  const finished = run.status === "FINISHED";
  const batch = run.productionFlow?.flowNo ?? null;
  const today = currentShift().date;
  // The task's other runs: where its work went before or after this machine.
  const sameTask = run.productionFlow ? run.productionFlow.knittingRuns.filter((r) => r.id !== run.id) : [];

  /** Confirms, calls the API, then either reloads or (when the run is gone) returns to the Machines page. */
  const act = async (confirm: Parameters<typeof confirmDialog>[0], action: () => Promise<unknown>, done: string, leave = false) => {
    if (!(await confirmDialog(confirm))) return;
    setBusy(true);
    setError("");
    try {
      await action();
      toast.success(done);
      if (leave) router.push("/masters/machines");
      else await runsQuery.reload();
    } catch (e) {
      setError(errorMessage(e, "Could not change the run"));
    } finally {
      setBusy(false);
    }
  };
  const saved = (text: string, next?: KnitRun) => {
    setOpen(null);
    toast.success(text);
    // A move starts a new run on the new machine; follow the work there.
    if (next && next.runNo !== run.runNo) router.push(`/masters/machines/run?code=${encodeURIComponent(next.runNo)}`);
    void runsQuery.reload();
  };

  const facts: Array<[string, React.ReactNode]> = [
    ["Machine", <Link key="machine" href={machineHref(run.machine.id)} className="text-[#1b3c55] hover:underline">{run.machine.code} · {run.machine.name}</Link>],
    ["Fabric", fabricSpec({ ...run.productionFlow, fabricType: run.fabricType }) || "—"],
    ["Yarn", [run.yarns.map((y) => y.itemCode).join(", "), run.productionFlow?.yarnCount, run.yarns[0]?.lotNo && `lot ${run.yarns[0].lotNo}`].filter(Boolean).join(" · ") || "—"],
    ["Operator", run.operator ? `${run.operator.name} · ${run.operator.code}` : "—"],
    ["Started", shiftText(run.startedAt, run.startShift)],
    ["Stopped", finished ? shiftText(run.finishedAt, run.finishShift) : "Knitting now"],
    ["On the machine", `${daysOnMachine(run, today)} day${daysOnMachine(run, today) === 1 ? "" : "s"}${run.shifts ? ` · ${run.shifts} shifts` : ""}`],
    [
      "Fabric in stock",
      run.outputKg ? (
        <Link href={itemHref(run.runNo, run.warehouse?.id)} className="text-[#1b3c55] hover:underline">{run.runNo}{run.warehouse ? ` in ${run.warehouse.code}` : ""}</Link>
      ) : (
        "—"
      ),
    ],
  ];
  if (batch) facts.push(["Production batch", <Link key="batch" href={`/production?batch=${encodeURIComponent(batch)}`} className="text-[#1b3c55] hover:underline">{batch}</Link>]);

  return (
    <div className="knit-page space-y-4 pb-10">
      {back}

      <header className="knit-run-head">
        <span className={cn("knit-dialog__icon", finished ? "is-green" : "is-gold")}><Factory size={17} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#123f35]">
            <span className="font-mono">{run.runNo}</span>
            <span className={cn("knit-pill", finished ? "is-done" : "is-live")}>{finished ? "Finished" : "Knitting"}</span>
          </h1>
          <p className="text-sm text-gray-500">On {run.machine.code}{batch ? ` for ${batch}` : ""}{run.fabricType ? ` · ${run.fabricType}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin &&
            (finished ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(
                    {
                      title: `Undo finish of ${run.runNo}?`,
                      description: run.days.length
                        ? `${run.runNo} is knitting on ${run.machine.code} again; its days and fabric stay as entered.`
                        : `${kg(run.outputKg ?? 0)} of fabric comes back out of ${run.warehouse?.code ?? "stock"} and the run is knitting again. Not possible if the fabric has been issued from there.`,
                      confirmLabel: "Undo finish",
                      tone: "danger",
                    },
                    () => api(`/knitting/runs/${run.id}/reopen`, { method: "POST" }),
                    `${run.runNo} is knitting again.`,
                  )
                }
              >
                <Undo2 size={15} /> Undo finish
              </Button>
            ) : (
              run.days.length === 0 && (
                <Button
                  variant="outline"
                  className="text-red-600"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      {
                        title: `Cancel ${run.runNo}?`,
                        description: batch ? `Nothing is entered for it yet. The run is removed and ${run.machine.code} is free; ${batch} stays open for another machine.` : "The run is removed and its yarn goes back into stock.",
                        confirmLabel: "Cancel run",
                        tone: "danger",
                      },
                      () => api(`/knitting/runs/${run.id}`, { method: "DELETE" }),
                      `${run.runNo} cancelled.`,
                      true,
                    )
                  }
                >
                  <RotateCcw size={15} /> Cancel run
                </Button>
              )
            ))}
          {!finished && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setOpen({ kind: "day" })}><CalendarCheck size={15} /> Enter day</Button>
              {batch && <Button variant="outline" disabled={busy} onClick={() => setOpen({ kind: "move" })}><ArrowRightLeft size={15} /> Change machine</Button>}
              <Button className="knit-btn is-blue" disabled={busy} onClick={() => setOpen({ kind: "finish" })}><CheckCircle2 size={15} /> Stop machine</Button>
            </>
          )}
        </div>
      </header>

      {error && <p className="knit-alert is-error" role="alert">{error}</p>}
      {run.endReason && <p className="knit-alert is-warn">{run.endReason}</p>}

      <section className="knit-card p-4">
        <dl className="knit-facts">
          {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>

      <div className="knit-figures">
        <Figure label="Fabric knitted" value={kg(run.outputKg ?? 0)} note={run.productionFlow ? `of ${kg(run.productionFlow.purchasedWeightKg)} yarn on ${batch}` : undefined} />
        <Figure label="Rolls" value={run.rollCount ?? 0} />
        <Figure label="Days entered" value={run.days.length} note={`${daysOnMachine(run, today)} on the machine`} />
        <Figure label="Per day" value={run.avgPerDayKg === null ? "—" : kg(run.avgPerDayKg)} note="average of the days it knitted" />
      </div>

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Day by day</p>
            <h2 className="knit-card__title">Production entered</h2>
          </div>
          {!finished && <Button size="sm" className="knit-btn" onClick={() => setOpen({ kind: "day" })}><CalendarCheck size={14} /> Enter day</Button>}
        </div>
        <div className="p-4">
          {run.days.length === 0 ? (
            <div className="knit-empty">
              <p className="font-bold text-gray-900">No day entered yet</p>
              <p className="text-sm text-gray-500">{run.outputKg !== null ? `This run was finished in one go: ${kg(run.outputKg)} and ${run.rollCount ?? 0} rolls.` : "At the end of each day, enter the machine's fabric KG and rolls."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="knit-table w-full min-w-[640px] text-sm">
                <thead><tr><th>Production day</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th><th>Into</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {run.days.map((day) => (
                    <tr key={day.id}>
                      <td className="font-semibold">{formatDate(day.date)}<span className="block text-[11px] font-normal text-gray-500">Day + Night shift</span></td>
                      <td className={cn("text-right font-semibold", day.outputKg <= 0 && "text-gray-400")}>{day.outputKg > 0 ? kg(day.outputKg) : "Stood still"}</td>
                      <td className="text-right">{day.rollCount}</td>
                      <td className="text-xs text-gray-600">{day.warehouse.code}</td>
                      <td className="text-xs text-gray-600">{day.notes ?? ""}</td>
                      <td>
                        <span className="flex justify-end gap-1">
                          <button type="button" className="knit-icon-btn" aria-label={`Change ${formatDate(day.date)}`} title="Change this day" onClick={() => setOpen({ kind: "day", date: day.date })}><Pencil size={14} /></button>
                          {isAdmin && (
                            <button
                              type="button"
                              className="knit-icon-btn"
                              aria-label={`Remove ${formatDate(day.date)}`}
                              title="Remove this day"
                              disabled={busy || (finished && run.days.length === 1)}
                              onClick={() =>
                                void act(
                                  { title: `Remove ${formatDate(day.date)}?`, description: `${kg(day.outputKg)} comes back out of ${day.warehouse.code}. Not possible if that fabric has been issued from there.`, confirmLabel: "Remove day", tone: "danger" },
                                  () => api(`/knitting/days/${day.id}`, { method: "DELETE" }),
                                  `${formatDate(day.date)} removed from ${run.runNo}.`,
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>Total</td><td className="text-right">{kg(run.outputKg ?? 0)}</td><td className="text-right">{run.rollCount ?? 0}</td><td colSpan={3} /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </section>

      {sameTask.length > 0 && (
        <section className="knit-card">
          <div className="knit-card__head"><div><p className="knit-card__eyebrow">{batch}</p><h2 className="knit-card__title">Other machines on this task</h2></div></div>
          <div className="flex flex-wrap gap-2 p-4">
            {sameTask.map((r) => (
              <Link key={r.id} href={`/masters/machines/run?code=${encodeURIComponent(r.runNo)}`} className="knit-machine__run w-auto">
                <span className="knit-code">{r.runNo}</span>
                <span className="text-xs text-gray-500">{r.machine.code} · {kg(r.outputKg ?? 0)} · {r.status === "RUNNING" ? "knitting" : "stopped"}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="knit-card p-4">
          <dl className="knit-money">
            <div><dt>Yarn used</dt><dd>{money(run.yarnCost)}<small>{` · ${kg(run.yarnKg)} × ${money(run.yarns[0]?.ratePerKg ?? 0)}`}</small></dd></div>
            <div><dt>Knitting charge</dt><dd>{money(run.knittingCharge ?? 0)}<small>{` · ${kg(run.outputKg ?? 0)} × ${money(run.ratePerKg)}`}</small></dd></div>
            <div className="is-total"><dt>{finished ? "Final total" : "Total so far"}</dt><dd>{money(run.totalCost)}</dd></div>
            <div><dt>Cost per KG of fabric</dt><dd>{run.costPerKg === null ? "—" : money(run.costPerKg)}</dd></div>
          </dl>
        </section>
      )}

      {run.notes && <p className="rounded-xl bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">{run.notes}</p>}

      {open?.kind === "day" && (
        <DayEntryDialog
          context={ctx}
          runs={runs}
          runId={run.id}
          date={open.date}
          onClose={() => setOpen(null)}
          onSaved={(_, date) => saved(`${formatDate(date)} saved for ${run.runNo}.`)}
        />
      )}
      {open?.kind === "finish" && (
        <FinishRunDialog
          run={run}
          context={ctx}
          showPrices={isAdmin}
          onClose={() => setOpen(null)}
          onFinished={(r) => saved(`${r.machine.code} stopped: ${r.runNo} knitted ${kg(r.outputKg ?? 0)} in ${r.days.length} day${r.days.length === 1 ? "" : "s"}.`)}
        />
      )}
      {open?.kind === "move" && (
        <MoveRunDialog
          run={run}
          context={ctx}
          busyMachines={new Set(ctx.busyMachineIds)}
          onClose={() => setOpen(null)}
          onMoved={(r) => saved(`${run.machine.code} → ${r.machine.code}: the work carries on as ${r.runNo}.`, r)}
        />
      )}
    </div>
  );
}

export default function KnittingRunPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RunPage />
    </Suspense>
  );
}
