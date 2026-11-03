"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, BarChart3, CalendarCheck, CheckCircle2, CircleDot, ClipboardList, Download, Factory, Info, Play, Plus, RefreshCw, Search, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { ATTENTION_KINDS, type AttentionKind } from "@/lib/attention";
import { useNewParam } from "@/lib/use-new-param";
import { cn, errorMessage, formatDate, kg, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/page-state";
import { useAuth } from "@/components/auth-provider";
import { ADMIN_ROLES } from "@/lib/navigation";
import { MachineExpensesView } from "./costs";
import { FloorClock, MachineTile, OperatorsPanel } from "./floor";
import { MachineDialog } from "./machine-dialog";
import { AssignMachinesDialog, CompleteTaskDialog, DayEntryDialog, FinishRunDialog, MoveRunDialog, TaskProgress } from "./run-dialogs";
import {
  addDays,
  currentShift,
  dayOf,
  dayTotals,
  EMPTY,
  fabricSpec,
  FLOOR_LABEL,
  floorState,
  lastProductionDay,
  localMonth,
  machineHref,
  monthKg,
  runHref,
  runOnDay,
  shiftText,
  type FloorState,
  type KnitBoard,
  type KnitMachine,
  type KnitRun,
  type OpenTask,
} from "./types";
import "./machines.css";

type Open =
  | { kind: "machine"; machine: KnitMachine | null }
  | { kind: "assign"; taskId?: string; machineId?: string }
  | { kind: "day"; runId?: string; date?: string }
  | { kind: "finish"; runId: string }
  | { kind: "move"; runId: string }
  | { kind: "complete"; task: OpenTask }
  | null;
type View = "floor" | "tasks" | "operators" | "register" | "expenses";
type RunFilter = "ALL" | "RUNNING" | "FINISHED";

const VIEWS: Array<{ value: View; label: string; adminOnly?: boolean }> = [
  { value: "floor", label: "Floor" },
  { value: "tasks", label: "Tasks" },
  { value: "operators", label: "Operators" },
  { value: "register", label: "Runs" },
  // Money: admins only, like every price on this page.
  { value: "expenses", label: "Machine expenses", adminOnly: true },
];
const STATES: FloorState[] = ["running", "stopped", "repair", "maintenance"];
const STATE_NOTE: Record<FloorState, string> = { running: "knitting now", stopped: "idle, ready for work", repair: "breakdown, being repaired", maintenance: "planned service" };
/** The floor refreshes itself this often while the page is in view, so it stays live on a screen left open. */
const AUTO_REFRESH_MS = 120_000;
/** Production days in the output chart (the board carries about two months of runs). */
const CHART_DAYS = 14;

/** The page's shape while the floor loads for the first time in this tab. */
function MachinesSkeleton() {
  return (
    <div className="knit-page space-y-4 pb-10" role="status" aria-label="Loading machines">
      <div className="h-36 animate-pulse rounded-[20px] bg-[#1b3c55]/20" />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-200/60" />)}</div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-gray-200/60" />)}</div>
    </div>
  );
}

/**
 * The knitting floor, running day and night (Day 9 AM–9 PM, Night 9 PM–9 AM): every machine and what it is doing,
 * the tasks to put on machines, who is operating what, and the runs register. Tasks go on any number of free
 * machines with no load limit; each machine's KG and rolls are entered at the end of the day; a machine that breaks
 * down hands its work to another. One request (`/knitting/board`) loads the whole floor. `?run=CODE` (old links)
 * opens the run's page.
 */
export default function MachinesPage() {
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const showPrices = isAdmin;
  // Kept for the browser tab: coming back (or reloading) shows the floor at once while it refreshes.
  const board = useApiQuery<KnitBoard>("/knitting/board", { persist: user?.id });
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const views = VIEWS.filter((v) => !v.adminOnly || isAdmin);
  const view = (views.some((v) => v.value === params.get("view")) ? params.get("view") : "floor") as View;
  const [stateFilter, setStateFilter] = useState<FloorState | "all">("all");
  const [floorSearch, setFloorSearch] = useState("");
  const [search, setSearch] = useState("");
  const [runFilter, setRunFilter] = useState<RunFilter>("ALL");
  const [allRuns, setAllRuns] = useState(false);
  const older = useApiQuery<KnitRun[]>(allRuns ? "/knitting/runs" : null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  useNewParam(() => setOpen({ kind: "machine", machine: null }));

  // Old `?run=CODE` links (item details, production) now open the run's own page.
  const linked = params.get("run");
  useEffect(() => {
    if (linked) router.replace(runHref(linked));
  }, [linked, router]);

  const { reload: reloadBoard } = board;
  const reload = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadBoard(), allRuns ? older.reload() : undefined]);
    setUpdatedAt(new Date());
    setRefreshing(false);
  }, [reloadBoard, allRuns, older]);

  // Live floor: refresh while the page is in view and no window is open.
  useEffect(() => {
    if (open) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reloadBoard().then(() => setUpdatedAt(new Date()));
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, reloadBoard]);

  const setView = (next: View) => {
    const query = new URLSearchParams(params.toString());
    if (next === "floor") query.delete("view");
    else query.set("view", next);
    router.replace(`/masters/machines${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  const data = board.data;
  const derived = useMemo(() => {
    if (!data) return null;
    const runs = data.runs;
    const running = runs.filter((r) => r.status === "RUNNING");
    const runOn = new Map(running.map((r) => [r.machine.id, r]));
    // Runs come newest first, so the first stopped one per machine is its last.
    const lastRunOn = new Map<string, KnitRun>();
    for (const r of runs) if (r.status === "FINISHED" && !lastRunOn.has(r.machine.id)) lastRunOn.set(r.machine.id, r);
    const states = new Map(data.machines.map((m) => [m.id, floorState(m, runOn.get(m.id))]));
    const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<FloorState, number>;
    for (const s of states.values()) counts[s]++;
    const today = currentShift().date;
    const lastDay = lastProductionDay();
    // KG knitted on each of the last CHART_DAYS production days (today included, as far as it is entered).
    const chart = Array.from({ length: CHART_DAYS }, (_, i) => {
      const date = addDays(today, i - (CHART_DAYS - 1));
      return { date, ...dayTotals(runs, date) };
    });
    // The machines that knitted most this month (day entries; runs finished in one go count on their finish day).
    const month = localMonth();
    const byMachine = new Map<string, { id: string; code: string; kg: number; days: number }>();
    for (const r of runs) {
      const days = r.days.filter((d) => d.date.slice(0, 7) === month);
      const kgThisMonth = days.length ? days.reduce((sum, d) => sum + d.outputKg, 0) : !r.days.length && r.status === "FINISHED" && r.finishedAt?.slice(0, 7) === month ? r.outputKg ?? 0 : 0;
      if (kgThisMonth <= EMPTY) continue;
      const row = byMachine.get(r.machine.id) ?? { id: r.machine.id, code: r.machine.code, kg: 0, days: 0 };
      row.kg += kgThisMonth;
      row.days += days.length;
      byMachine.set(r.machine.id, row);
    }
    const lateTasks = data.tasks.filter((t) => {
      const due = t.knittingExpectedFinishDate?.slice(0, 10);
      return !!due && due < today;
    });
    return {
      chart,
      topMachines: [...byMachine.values()].sort((a, b) => b.kg - a.kg).slice(0, 5),
      lateTasks,
      runs,
      running,
      runOn,
      lastRunOn,
      states,
      counts,
      today,
      lastDay,
      todayTotals: dayTotals(runs, today),
      last: dayTotals(runs, lastDay),
      missing: runs.filter((r) => runOnDay(r, lastDay) && !dayOf(r, lastDay)),
      monthKg: monthKg(runs, localMonth()),
      waiting: data.tasks.filter((t) => t.running.length === 0),
      free: data.machines.filter((m) => states.get(m.id) === "stopped").length,
      busy: new Set(runOn.keys()),
    };
  }, [data]);

  const fq = floorSearch.trim().toUpperCase();
  const tiles = useMemo(() => {
    if (!data || !derived) return [];
    return data.machines.filter((m) => {
      if (stateFilter !== "all" && derived.states.get(m.id) !== stateFilter) return false;
      if (!fq) return true;
      const run = derived.runOn.get(m.id);
      return [m.code, m.name, m.type ?? "", run?.runNo ?? "", run?.productionFlow?.flowNo ?? "", run?.fabricType ?? "", run?.operator?.name ?? "", ...(run?.yarns.map((y) => y.itemCode) ?? [])].some((v) => v.toUpperCase().includes(fq));
    });
  }, [data, derived, stateFilter, fq]);

  const registerRuns = useMemo(() => (allRuns && older.data ? older.data : derived?.runs ?? []), [allRuns, older.data, derived]);
  const q = search.trim().toUpperCase();
  const visible = useMemo(
    () =>
      registerRuns.filter(
        (r) =>
          (runFilter === "ALL" || r.status === runFilter) &&
          (!q || [r.runNo, r.machine.code, r.fabricType ?? "", r.operator?.name ?? "", r.productionFlow?.flowNo ?? "", ...r.yarns.map((y) => y.itemCode)].some((v) => v.toUpperCase().includes(q))),
      ),
    [registerRuns, runFilter, q],
  );

  if (!data && board.error) return <ErrorState message={board.error} onRetry={() => void reload()} />;
  if (!data || !derived) return <MachinesSkeleton />;
  const tasks = data.tasks;
  const runById = (id: string) => derived.runs.find((r) => r.id === id);
  const finishRun = open?.kind === "finish" ? runById(open.runId) : undefined;
  const moveRun = open?.kind === "move" ? runById(open.runId) : undefined;

  const done = (text: string) => {
    toast.success(text);
    setOpen(null);
    void reload();
  };

  /** Completing a task asks for the yarn it used; the rest goes back to the warehouse. */
  const completeTask = (task: OpenTask) => setOpen({ kind: "complete", task });

  const backInService = async (machine: KnitMachine) => {
    try {
      await api(`/masters/machines/${machine.id}`, { method: "PATCH", body: JSON.stringify({ status: "IDLE" }) });
      toast.success(`${machine.code} is back in service.`);
      void reload();
    } catch (e) {
      toast.error(errorMessage(e, "Could not change the machine"));
    }
  };

  const pickState = (next: FloorState | "all") => {
    setStateFilter((current) => (current === next ? "all" : next));
    if (view !== "floor") setView("floor");
  };

  const exportRuns = () =>
    downloadCsv(
      `knitting-runs-${derived.today}.csv`,
      ["Code", "Task", "Status", "Machine", "Fabric", "Operator", "Yarn code", "Started", "Finished", "Ended because", "Days entered", "Fabric KG", "Rolls", "KG per day", ...(showPrices ? ["Yarn cost", "Knitting charge", "Total", "Cost per KG"] : [])],
      visible.map((r) => [
        r.runNo,
        r.productionFlow?.flowNo ?? "",
        r.status === "RUNNING" ? "Knitting" : "Finished",
        r.machine.code,
        fabricSpec({ ...r.productionFlow, fabricType: r.fabricType }),
        r.operator?.name ?? "",
        r.yarns.map((y) => y.itemCode).join("; "),
        shiftText(r.startedAt, r.startShift),
        r.finishedAt ? shiftText(r.finishedAt, r.finishShift) : "",
        r.endReason ?? "",
        r.days.length,
        r.outputKg?.toFixed(3) ?? "",
        r.rollCount ?? "",
        r.avgPerDayKg?.toFixed(3) ?? "",
        ...(showPrices ? [r.yarnCost.toFixed(2), r.knittingCharge?.toFixed(2) ?? "", r.totalCost.toFixed(2), r.costPerKg?.toFixed(2) ?? ""] : []),
      ]),
    );

  const onMachines = new Set(derived.running.flatMap((r) => (r.operator ? [r.operator.id] : []))).size;

  // What needs someone on the floor, most urgent first, with what it is about (as on the Dashboard).
  const attention: Array<{ key: string; tone: "danger" | "warning" | "info"; kind: AttentionKind; text: string; action: string; onClick: () => void }> = [];
  if (derived.counts.repair > 0)
    attention.push({ key: "repair", tone: "danger", kind: "machines", text: `${derived.counts.repair} machine${derived.counts.repair === 1 ? " is" : "s are"} broken down and under repair`, action: "Show", onClick: () => pickState("repair") });
  if (derived.lateTasks.length > 0)
    attention.push({ key: "late", tone: "danger", kind: "production", text: `${derived.lateTasks.length} knitting task${derived.lateTasks.length === 1 ? " is" : "s are"} past the required date (${derived.lateTasks[0].flowNo}${derived.lateTasks.length > 1 ? "…" : ""})`, action: "Tasks", onClick: () => setView("tasks") });
  if (derived.missing.length > 0)
    attention.push({ key: "missing", tone: "warning", kind: "machines", text: `${formatDate(derived.lastDay)} not entered for ${derived.missing.map((r) => r.machine.code).join(", ")}`, action: "Enter it", onClick: () => setOpen({ kind: "day", date: derived.lastDay }) });
  if (derived.waiting.length > 0)
    attention.push({
      key: "waiting",
      tone: "warning",
      kind: "production",
      text: `${derived.waiting.length} task${derived.waiting.length === 1 ? "" : "s"} waiting for a machine · ${derived.free} machine${derived.free === 1 ? "" : "s"} free`,
      action: derived.free ? "Assign" : "Tasks",
      onClick: () => (derived.free ? setOpen({ kind: "assign", taskId: derived.waiting[0].id }) : setView("tasks")),
    });
  if (derived.counts.maintenance > 0)
    attention.push({ key: "maintenance", tone: "info", kind: "machines", text: `${derived.counts.maintenance} machine${derived.counts.maintenance === 1 ? " is" : "s are"} in planned maintenance`, action: "Show", onClick: () => pickState("maintenance") });
  const chartMax = Math.max(0, ...derived.chart.map((d) => d.kg));
  const workedDays = derived.chart.filter((d) => d.kg > EMPTY);
  const chartTotal = workedDays.reduce((sum, d) => sum + d.kg, 0);
  const topMax = derived.topMachines[0]?.kg ?? 0;

  return (
    <div className="knit-page space-y-4 pb-10">
      <header className="knit-floor">
        <div className="knit-floor__main">
          <div className="min-w-0">
            <p className="knit-eyebrow"><span className="knit-live-dot" aria-hidden /> Knitting floor · live</p>
            <h1 className="knit-hero__title">Machines</h1>
            <p className="mt-1 max-w-xl text-sm text-white/65">Every machine and what it is knitting. Enter each machine&apos;s KG and rolls at the end of the day; change a broken machine for another.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {derived.runs.length > 0 && <Button className="knit-cta" onClick={() => setOpen({ kind: "day" })}><CalendarCheck size={15} /> Day-end entry</Button>}
            {isAdmin && <Button variant="ghost" className="knit-ghost" onClick={() => setOpen({ kind: "machine", machine: null })}><Plus size={15} /> Add machine</Button>}
            <Button variant="ghost" className="knit-ghost" disabled={refreshing} onClick={() => void reload()} title={`Updated ${updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}; refreshes by itself every 2 minutes`}>
              <RefreshCw size={15} className={cn(refreshing && "animate-spin")} /> {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </Button>
          </div>
        </div>
        <FloorClock />
      </header>

      <div className="knit-states" role="group" aria-label="Machines by state">
        {STATES.map((s) => (
          <button key={s} type="button" aria-pressed={stateFilter === s} className={cn("knit-statecard", `is-${s}`, stateFilter === s && "is-active")} onClick={() => pickState(s)}>
            <span className="knit-statecard__label"><span className="knit-statecard__dot" aria-hidden /> {FLOOR_LABEL[s]}</span>
            <strong>{derived.counts[s]}</strong>
            <span className="knit-statecard__note">{s === "running" ? `${kg(derived.running.reduce((sum, r) => sum + (r.outputKg ?? 0), 0))} knitted on them` : STATE_NOTE[s]}</span>
          </button>
        ))}
        <button type="button" aria-pressed={stateFilter === "all"} className={cn("knit-statecard is-all", stateFilter === "all" && "is-active")} onClick={() => pickState("all")}>
          <span className="knit-statecard__label">All machines</span>
          <strong>{data.machines.length}</strong>
          <span className="knit-statecard__note">{data.machines.length ? `${Math.round((derived.counts.running / data.machines.length) * 100)}% knitting` : "None added yet"}</span>
        </button>
      </div>

      <div className="knit-kpis">
        <div className="knit-kpi"><p>Today so far · {formatDate(derived.today)}</p><strong>{kg(derived.todayTotals.kg)}</strong><span>{derived.todayTotals.rolls} rolls · {derived.todayTotals.machines} machine{derived.todayTotals.machines === 1 ? "" : "s"} entered</span></div>
        <div className="knit-kpi"><p>Last day · {formatDate(derived.lastDay)}</p><strong>{kg(derived.last.kg)}</strong><span>{derived.last.rolls} rolls · {derived.last.machines} machine{derived.last.machines === 1 ? "" : "s"}{derived.missing.length ? ` · ${derived.missing.length} not entered` : ""}</span></div>
        <div className="knit-kpi"><p>This month</p><strong>{kg(derived.monthKg)}</strong><span>grey fabric knitted</span></div>
        <div className="knit-kpi"><p>Tasks open</p><strong>{tasks.length}</strong><span>{derived.waiting.length ? `${derived.waiting.length} waiting for a machine` : "All on machines"}</span></div>
      </div>

      {attention.length > 0 && (
        <section className="dashboard-attention" aria-label="Needs attention">
          <ul>
            {attention.map((item) => {
              const { icon: KindIcon, label } = ATTENTION_KINDS[item.kind];
              const ToneIcon = item.tone === "danger" ? AlertTriangle : item.tone === "warning" ? CircleDot : Info;
              return (
                <li key={item.key}>
                  <button type="button" onClick={item.onClick} className={cn("dashboard-attention__item w-full text-left", `is-${item.tone}`)}>
                    <span className={cn("attn-icon", `is-${item.kind}`, item.tone === "danger" && "is-urgent")}><KindIcon size={15} /></span>
                    <span className="dashboard-attention__text flex-1">
                      <span className={cn("attn-kind-chip", `is-${item.kind}`)}>{label}</span>
                      {item.text}
                    </span>
                    <ToneIcon size={14} className="shrink-0" aria-hidden />
                    <span className="shrink-0 text-xs font-bold underline">{item.action}</span>
                    <ArrowRight size={14} className="shrink-0 opacity-60" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="knit-output">
        <div className="knit-output__chart">
          <header>
            <span className="knit-output__icon"><BarChart3 size={15} /></span>
            <div className="min-w-0 flex-1">
              <p className="knit-card__eyebrow">Output</p>
              <h2 className="text-sm font-bold text-gray-900">Knitted each day · last {CHART_DAYS} days</h2>
            </div>
            <span className="text-right text-xs text-gray-500">
              <b className="block text-sm text-gray-900">{kg(chartTotal)}</b>
              {workedDays.length ? `${kg(chartTotal / workedDays.length)} a day over ${workedDays.length} days` : "nothing entered"}
            </span>
          </header>
          <div className="knit-days" role="list" aria-label="KG knitted per production day">
            {derived.chart.map((d) => {
              const date = new Date(`${d.date}T00:00:00`);
              const isToday = d.date === derived.today;
              return (
                <div key={d.date} role="listitem" className={cn("knit-day", d.kg <= EMPTY && "is-empty", isToday && "is-today", date.getDay() === 0 && "is-sunday")} title={`${formatDate(d.date)}: ${kg(d.kg)} · ${d.rolls} rolls · ${d.machines} machine${d.machines === 1 ? "" : "s"}`}>
                  <span className="knit-day__value">{d.kg > EMPTY ? Math.round(d.kg) : ""}</span>
                  <span className="knit-day__bar"><span style={{ height: `${chartMax ? Math.max(3, (d.kg / chartMax) * 100) : 0}%` }} /></span>
                  <span className="knit-day__date">{date.getDate()}</span>
                  <span className="knit-day__dow">{isToday ? "Now" : date.toLocaleDateString("en-IN", { weekday: "narrow" })}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="knit-output__top">
          <header>
            <span className="knit-output__icon is-gold"><Trophy size={15} /></span>
            <div className="min-w-0">
              <p className="knit-card__eyebrow">This month</p>
              <h2 className="text-sm font-bold text-gray-900">Machines that knitted most</h2>
            </div>
          </header>
          {derived.topMachines.length === 0 ? (
            <p className="text-xs text-gray-500">No knitting entered this month yet.</p>
          ) : (
            <ol className="knit-top">
              {derived.topMachines.map((m, i) => (
                <li key={m.id}>
                  <span className="knit-top__rank">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <Link href={machineHref(m.id)} className="font-bold text-[#1b3c55] hover:underline">{m.code}</Link>
                      <b className="text-xs tabular-nums text-gray-800">{kg(m.kg)}</b>
                    </span>
                    <span className="knit-top__bar"><span style={{ width: `${topMax ? (m.kg / topMax) * 100 : 0}%` }} /></span>
                    <span className="text-[10px] text-gray-400">{m.days ? `${m.days} day${m.days === 1 ? "" : "s"} · ${kg(m.kg / m.days)} a day` : "finished in one go"}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <nav className="knit-views" role="tablist" aria-label="Machines page">
        {views.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={view === v.value} className={cn(view === v.value && "is-active", v.adminOnly && "is-money")} onClick={() => setView(v.value)}>
            {v.label}
            {!v.adminOnly && <span>{v.value === "floor" ? data.machines.length : v.value === "tasks" ? tasks.length : v.value === "operators" ? onMachines : derived.runs.length}</span>}
          </button>
        ))}
      </nav>

      {view === "floor" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="knit-search min-w-[16rem] flex-1">
              <Search size={17} aria-hidden />
              <Input placeholder="Find a machine, task, fabric, yarn or operator" aria-label="Find a machine" value={floorSearch} onChange={(e) => setFloorSearch(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
            {stateFilter !== "all" && (
              <Button size="sm" variant="outline" onClick={() => setStateFilter("all")}>Showing {FLOOR_LABEL[stateFilter].toLowerCase()} · show all</Button>
            )}
          </div>
          {data.machines.length === 0 ? (
            <div className="knit-empty">
              <Factory size={24} />
              <p className="font-bold text-gray-900">No machines yet</p>
              <p className="text-sm text-gray-500">Add your knitting machines with their knitting charge per KG.</p>
              {isAdmin && <Button className="knit-btn mt-2" onClick={() => setOpen({ kind: "machine", machine: null })}><Plus size={15} /> Add machine</Button>}
            </div>
          ) : tiles.length === 0 ? (
            <div className="knit-empty">
              <p className="font-bold text-gray-900">No machine {stateFilter !== "all" ? `in ${FLOOR_LABEL[stateFilter].toLowerCase()}` : "matches"}{fq ? ` for ${floorSearch.trim()}` : ""}</p>
              <p className="text-sm text-gray-500">Clear the search or show all machines.</p>
            </div>
          ) : (
            <div className="knit-tiles">
              {tiles.map((machine) => (
                <MachineTile
                  key={machine.id}
                  machine={machine}
                  run={derived.runOn.get(machine.id)}
                  lastRun={derived.lastRunOn.get(machine.id)}
                  state={derived.states.get(machine.id) ?? "stopped"}
                  lastDay={derived.lastDay}
                  today={derived.today}
                  tasksOpen={tasks.length}
                  onEdit={() => setOpen({ kind: "machine", machine })}
                  onAssign={() => setOpen({ kind: "assign", machineId: machine.id })}
                  onDay={(run) => setOpen({ kind: "day", runId: run.id })}
                  onMove={(run) => setOpen({ kind: "move", runId: run.id })}
                  onFinish={(run) => setOpen({ kind: "finish", runId: run.id })}
                  onBackInService={() => void backInService(machine)}
                  canManage={isAdmin}
                  showPrices={showPrices}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {view === "tasks" && (
        <section className="knit-card">
          <div className="knit-card__head">
            <div>
              <p className="knit-card__eyebrow">Production</p>
              <h2 className="knit-card__title">Knitting tasks</h2>
            </div>
            <span className="text-xs font-semibold text-gray-500">{tasks.length} open · {derived.waiting.length} waiting for a machine · {derived.free} machine{derived.free === 1 ? "" : "s"} free</span>
          </div>
          <div className="p-4">
            {tasks.length === 0 ? (
              <div className="knit-empty">
                <ClipboardList size={24} />
                <p className="font-bold text-gray-900">No knitting tasks</p>
                <p className="text-sm text-gray-500">Own-mill tasks created on the Production page appear here until their knitting is complete.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="knit-table w-full min-w-[1000px] text-sm">
                  <thead><tr><th>Task</th><th>Fabric</th><th>Yarn</th><th>Progress</th><th>On machines</th><th>Required by</th><th /></tr></thead>
                  <tbody>
                    {tasks.map((task) => {
                      const due = task.knittingExpectedFinishDate?.slice(0, 10);
                      const late = !!due && due < derived.today;
                      const canComplete = task.running.length === 0 && task.knittedKg > EMPTY;
                      return (
                        <tr key={task.id}>
                          <td>
                            <Link href={`/production?batch=${encodeURIComponent(task.flowNo)}`} className="knit-code is-button">{task.flowNo}</Link>
                            <span className="block text-xs text-gray-500">{task.knittingDate ? `From ${formatDate(task.knittingDate)}` : task.knittingPartyDetails ?? "Knitting"}</span>
                          </td>
                          <td className="max-w-[16rem]"><span className="font-semibold">{fabricSpec(task) || "Fabric"}</span></td>
                          <td><span className="font-mono font-semibold">{task.yarnItemCode ?? "—"}</span><span className="block text-xs text-gray-500">{task.yarnCount}{task.yarnLotNo ? ` · lot ${task.yarnLotNo}` : ""}</span></td>
                          <td><TaskProgress compact knittedKg={task.knittedKg} yarnKg={task.purchasedWeightKg} /></td>
                          <td>
                            {task.running.length ? (
                              <span className="flex flex-wrap gap-1">{task.running.map((r) => <Link key={r.id} href={machineHref(r.machine.id)} className="knit-chip is-live">{r.machine.code}</Link>)}</span>
                            ) : (
                              <span className="text-xs font-semibold text-amber-700">{task.knittingRuns.length ? "Stopped · waiting for a machine" : "Waiting for a machine"}</span>
                            )}
                          </td>
                          <td className={cn("text-xs", late ? "font-semibold text-red-600" : "text-gray-600")}>
                            {due ? formatDate(due) : "No due date"}
                            {late && <span className="block">Overdue</span>}
                          </td>
                          <td>
                            <span className="flex justify-end gap-1.5">
                              {canComplete && <Button size="sm" variant="outline" onClick={() => completeTask(task)} title="All machines on it are stopped"><CheckCircle2 size={13} /> Complete</Button>}
                              <Button size="sm" className="knit-btn is-blue" disabled={derived.free === 0} title={derived.free === 0 ? "No machine is free" : undefined} onClick={() => setOpen({ kind: "assign", taskId: task.id })}>
                                <Play size={13} /> {task.running.length ? "Add machine" : "Select machines"}
                              </Button>
                            </span>
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
      )}

      {view === "operators" && (
        <section className="knit-card">
          <div className="knit-card__head">
            <div>
              <p className="knit-card__eyebrow">On shift</p>
              <h2 className="knit-card__title">Operators on machines</h2>
            </div>
            <span className="text-xs font-semibold text-gray-500">{onMachines} operator{onMachines === 1 ? "" : "s"} on {derived.running.length} running machine{derived.running.length === 1 ? "" : "s"}</span>
          </div>
          <div className="p-4"><OperatorsPanel running={derived.running} operators={data.operators} /></div>
        </section>
      )}

      {view === "register" && (
        <section className="knit-card">
          <div className="knit-card__head">
            <div>
              <p className="knit-card__eyebrow">Record</p>
              <h2 className="knit-card__title">{isAdmin ? "Knitting runs" : "Machine work"}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="knit-tabs" role="tablist" aria-label="Show runs">
                {(["ALL", "RUNNING", "FINISHED"] as const).map((value) => (
                  <button key={value} type="button" role="tab" aria-selected={runFilter === value} className={cn(runFilter === value && "is-active")} onClick={() => setRunFilter(value)}>
                    {value === "ALL" ? "All" : value === "RUNNING" ? "Knitting" : "Finished"} <span>{value === "ALL" ? registerRuns.length : registerRuns.filter((r) => r.status === value).length}</span>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" disabled={visible.length === 0} onClick={exportRuns} title="Download the runs shown"><Download size={14} /> Export CSV</Button>
            </div>
          </div>
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <form
                className="knit-search min-w-[16rem] flex-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const exact = registerRuns.find((r) => r.runNo.toUpperCase() === q);
                  const only = exact ?? (visible.length === 1 ? visible[0] : undefined);
                  if (only) router.push(runHref(only.runNo));
                }}
              >
                <Search size={17} aria-hidden />
                <Input placeholder="Find a run, task, machine or yarn code (Enter opens it)" aria-label="Find a run, task, machine or yarn code" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" spellCheck={false} />
              </form>
              <span className="text-xs text-gray-500">
                {allRuns ? (older.data ? `All runs · ${older.data.length}` : "Loading all runs…") : <>Knitting now and stopped since {formatDate(data.since)} · <button type="button" className="font-semibold text-[#17644f] underline" onClick={() => setAllRuns(true)}>Show older runs</button></>}
              </span>
            </div>
            {visible.length === 0 ? (
              <div className="knit-empty">
                <p className="font-bold text-gray-900">{registerRuns.length ? `No run matches${q ? ` ${q}` : ""}` : "No runs yet"}</p>
                <p className="text-sm text-gray-500">{registerRuns.length ? "Check the code, or show all runs." : "Put a knitting task on a machine to start the first run."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="knit-table knit-register w-full min-w-[1000px] text-sm">
                  <thead>
                    <tr><th>Code</th><th>Machine</th><th>Fabric · yarn</th><th className="text-right">Days</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th><th className="text-right">Per day</th><th>Shifts</th>{showPrices && <th className="text-right">Total</th>}<th>Status</th></tr>
                  </thead>
                  <tbody>
                    {visible.map((run) => (
                      <tr key={run.id} onClick={() => router.push(runHref(run.runNo))}>
                        <td><Link href={runHref(run.runNo)} className="knit-code is-button" onClick={(e) => e.stopPropagation()}>{run.runNo}</Link>{run.productionFlow && <span className="block text-xs text-gray-500">{run.productionFlow.flowNo}</span>}</td>
                        <td><Link href={machineHref(run.machine.id)} className="font-semibold text-[#1b3c55] hover:underline" onClick={(e) => e.stopPropagation()}>{run.machine.code}</Link>{run.operator && <span className="block text-xs text-gray-500">{run.operator.name}</span>}</td>
                        <td className="max-w-[16rem]"><span className="block truncate text-xs font-semibold text-gray-700">{fabricSpec({ ...run.productionFlow, fabricType: run.fabricType }) || "—"}</span><span className="block font-mono text-xs text-gray-500">{run.yarns.map((y) => y.itemCode).join(", ")}</span></td>
                        <td className="text-right">{run.days.length || "—"}</td>
                        <td className="text-right font-semibold">{run.outputKg === null ? "—" : kg(run.outputKg)}</td>
                        <td className="text-right">{run.rollCount ?? "—"}</td>
                        <td className="text-right text-xs text-gray-600">{run.avgPerDayKg === null ? "—" : kg(run.avgPerDayKg)}</td>
                        <td className="whitespace-nowrap text-xs text-gray-600">
                          {shiftText(run.startedAt, run.startShift)}
                          <span className="block">{run.finishedAt ? `→ ${shiftText(run.finishedAt, run.finishShift)}` : "→ knitting"}</span>
                          {run.endReason && <span className="block font-semibold text-amber-700">{run.endReason}</span>}
                        </td>
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
      )}

      {view === "expenses" && isAdmin && <MachineExpensesView machines={data.machines} runs={derived.runs} />}

      {open?.kind === "complete" && <CompleteTaskDialog task={open.task} onClose={() => setOpen(null)} onCompleted={done} />}
      {open?.kind === "machine" && (
        <MachineDialog
          machine={open.machine}
          existingCodes={data.machines.map((m) => m.code)}
          knitting={open.machine ? derived.runOn.get(open.machine.id)?.runNo ?? null : null}
          onClose={() => setOpen(null)}
          onSaved={done}
        />
      )}
      {open?.kind === "assign" && (
        <AssignMachinesDialog
          context={data}
          busyMachines={derived.busy}
          tasks={tasks}
          taskId={open.taskId}
          machineId={open.machineId}
          onClose={() => setOpen(null)}
          onAssigned={(started) => done(`${started[0]?.productionFlow?.flowNo ?? "Task"} started on ${started.map((r) => r.machine.code).join(", ")}.`)}
          showPrices={showPrices}
        />
      )}
      {open?.kind === "day" && (
        <DayEntryDialog
          context={data}
          runs={derived.runs}
          runId={open.runId}
          date={open.date}
          minDate={data.since}
          onClose={() => setOpen(null)}
          onSaved={(saved, date) => {
            const total = saved.reduce((sum, r) => sum + (dayOf(r, date)?.outputKg ?? 0), 0);
            done(`${formatDate(date)} saved: ${kg(total)} from ${saved.length} machine${saved.length === 1 ? "" : "s"} put into stock.`);
          }}
        />
      )}
      {finishRun && (
        <FinishRunDialog
          run={finishRun}
          context={data}
          onClose={() => setOpen(null)}
          onFinished={(run) => done(`${run.machine.code} stopped: ${run.runNo} knitted ${kg(run.outputKg ?? 0)} in ${run.days.length} day${run.days.length === 1 ? "" : "s"}.`)}
          showPrices={showPrices}
        />
      )}
      {moveRun && (
        <MoveRunDialog
          run={moveRun}
          context={data}
          busyMachines={derived.busy}
          onClose={() => setOpen(null)}
          onMoved={(run) => done(`${moveRun.machine.code} → ${run.machine.code}: ${run.productionFlow?.flowNo ?? run.runNo} carries on as ${run.runNo}.`)}
        />
      )}
    </div>
  );
}
