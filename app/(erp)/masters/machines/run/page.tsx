"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Factory, RotateCcw, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { ADMIN_ROLES } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, kg, money } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Empty } from "@/components/empty";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { itemHref } from "../../../warehouses/item-details";
import { FinishRunDialog, YarnTable } from "../run-dialogs";
import { EMPTY, machineHref, outputCheck, shiftText, type KnitContext, type KnitRun } from "../types";
import "../machines.css";

/** The Production batch a task's run belongs to: SS-2026-004-R2 → SS-2026-004. */
const batchOf = (runNo: string) => runNo.match(/^(.+)-R\d+$/)?.[1] ?? null;

/** `/masters/machines/run?code=SS-2026-004-R1`: everything about one knitting run, and what can be done with it. */
function RunPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const code = params.get("code")?.trim() ?? "";
  const context = useApiQuery<KnitContext>("/knitting/context");
  const runsQuery = useApiQuery<KnitRun[]>("/knitting/runs");
  const [finishing, setFinishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const back = (
    <Link href="/masters/machines" className="purchases-back-link"><ArrowLeft size={15} /> Machines</Link>
  );
  if ((!context.data && context.error) || (!runsQuery.data && runsQuery.error)) {
    return <div className="knit-page space-y-4">{back}<ErrorState message={context.error || runsQuery.error} onRetry={() => void Promise.all([context.reload(), runsQuery.reload()])} /></div>;
  }
  if (!context.data || !runsQuery.data) return <Loading />;
  const run = runsQuery.data.find((r) => r.runNo.toUpperCase() === code.toUpperCase());
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
  const check = run.outputKg === null ? null : outputCheck(run.yarnKg, run.outputKg, ctx.toleranceKg);
  const batch = batchOf(run.runNo);

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

  const facts: Array<[string, React.ReactNode]> = [
    ["Machine", <Link key="machine" href={machineHref(run.machine.id)} className="text-[#1b3c55] hover:underline">{run.machine.code} · {run.machine.name}</Link>],
    ["Fabric / knitting type", run.fabricType ?? "—"],
    ["Operator", run.operator ? `${run.operator.name} · ${run.operator.code}` : "—"],
    ["Started", shiftText(run.startedAt, run.startShift)],
    ["Finished", finished ? shiftText(run.finishedAt, run.finishShift) : "Knitting now"],
    ["Shifts", run.shifts ? `${run.shifts} (${(run.shifts / 2).toFixed(1)} days)` : "—"],
    ["Rolls", run.rollCount ?? "—"],
    [
      "Fabric in stock",
      run.warehouse ? (
        <Link href={itemHref(run.runNo, run.warehouse.id)} className="text-[#1b3c55] hover:underline">{run.warehouse.code} as {run.runNo}</Link>
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
          <p className="text-sm text-gray-500">
            {run.yarns.length} yarn{run.yarns.length === 1 ? "" : "s"} on {run.machine.code}{run.fabricType ? ` · ${run.fabricType}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin &&
            (finished ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(
                    { title: `Undo finish of ${run.runNo}?`, description: `${kg(run.outputKg ?? 0)} of fabric comes back out of ${run.warehouse?.code ?? "stock"} and the run is knitting again. Not possible if the fabric has been issued from there.`, confirmLabel: "Undo finish", tone: "danger" },
                    () => api(`/knitting/runs/${run.id}/reopen`, { method: "POST" }),
                    `${run.runNo} is knitting again; its fabric left stock.`,
                  )
                }
              >
                <Undo2 size={15} /> Undo finish
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-red-600"
                disabled={busy}
                onClick={() =>
                  void act(
                    {
                      title: `Cancel ${run.runNo}?`,
                      description: batch
                        ? `The run is removed and its ${kg(run.yarnKg)} goes back to ${batch}, ready for another machine.`
                        : `The ${kg(run.yarnKg)} of yarn goes back into stock and the run is removed.`,
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
            ))}
          {!finished && (
            <Button className="knit-btn is-blue" disabled={busy} onClick={() => setFinishing(true)}>
              <CheckCircle2 size={15} /> Finish run
            </Button>
          )}
        </div>
      </header>

      {error && <p className="knit-alert is-error" role="alert">{error}</p>}

      <section className="knit-card p-4">
        <dl className="knit-facts">
          {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>

      <section className="knit-card space-y-3 p-4">
        <div className="knit-flow">
          <div><p>Yarn loaded</p><strong>{kg(run.yarnKg)}</strong></div>
          <ArrowRight size={18} aria-hidden />
          <div><p>Fabric</p><strong>{run.outputKg === null ? "—" : kg(run.outputKg)}</strong></div>
          <span className={cn("knit-change", run.changeKg === null ? "is-flat" : run.changeKg > EMPTY ? "is-gain" : run.changeKg < -EMPTY ? "is-loss" : "is-flat")}>
            {run.changeKg === null ? `Expect ${kg(run.expectedMinKg)} – ${kg(run.expectedMaxKg)}` : `${run.changeKg >= 0 ? "+" : "−"}${kg(Math.abs(run.changeKg))}`}
          </span>
        </div>
        {check?.outside && <p className="knit-alert is-warn">{check.message}</p>}
      </section>

      <section className="knit-card">
        <div className="knit-card__head">
          <div>
            <p className="knit-card__eyebrow">Loaded</p>
            <h2 className="knit-card__title">Yarn by code</h2>
          </div>
        </div>
        <div className="p-4">
          <YarnTable
            run={run}
            outputKg={run.outputKg}
            showPrices={isAdmin}
            renderCode={(yarnCode) => <Link href={itemHref(yarnCode)} className="knit-code is-button">{yarnCode}</Link>}
          />
        </div>
      </section>

      {isAdmin && (
        <section className="knit-card p-4">
          <dl className="knit-money">
            <div><dt>Yarn cost</dt><dd>{money(run.yarnCost)}</dd></div>
            <div><dt>Knitting charge</dt><dd>{run.knittingCharge === null ? `${money(run.ratePerKg)} / KG when finished` : money(run.knittingCharge)}<small>{run.outputKg !== null ? ` · ${kg(run.outputKg)} × ${money(run.ratePerKg)}` : ""}</small></dd></div>
            <div className="is-total"><dt>Final total</dt><dd>{money(run.totalCost)}</dd></div>
            <div><dt>Cost per KG of fabric</dt><dd>{run.costPerKg === null ? "—" : money(run.costPerKg)}</dd></div>
          </dl>
        </section>
      )}

      {run.notes && <p className="rounded-xl bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">{run.notes}</p>}

      {finishing && (
        <FinishRunDialog
          run={run}
          context={ctx}
          showPrices={isAdmin}
          onClose={() => setFinishing(false)}
          onFinished={(saved) => {
            setFinishing(false);
            toast.success(`${saved.runNo} finished: ${kg(saved.outputKg ?? 0)} of grey fabric put into ${saved.warehouse?.code ?? "stock"}.${isAdmin ? ` Final total ${money(saved.totalCost)}.` : ""}`);
            void runsQuery.reload();
          }}
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
