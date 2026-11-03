"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock3, Download, Factory, HandCoins, KeyRound, Pencil, Phone, Power, Timer, UserCog, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { downloadCsv } from "@/lib/csv";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { EDIT_PARAM } from "@/lib/use-new-param";
import { expenseModeLabel, type Expense } from "@/lib/money";
import { cn, errorMessage, formatDate, humanize, kg, money, todayInput } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { CancelExpenseDialog } from "../../../money/dialogs";
import { monthLabel } from "../../machines/money-dialogs";
import { EmployeePaymentDialog } from "../payment-dialog";
import { elapsedText, fabricSpec, localMonth, machineHref, runHref, shiftStart, shiftText, type Shift } from "../../machines/types";
import "../../machines/machines.css";

type Run = {
  id: string;
  runNo: string;
  status: "RUNNING" | "FINISHED";
  fabricType: string | null;
  startedAt: string;
  startShift: Shift;
  finishedAt: string | null;
  finishShift: Shift | null;
  yarnKg: number;
  outputKg: number | null;
  rollCount: number | null;
  endReason: string | null;
  machine: { id: string; code: string; name: string };
  yarns: Array<{ itemCode: string; lotNo: string | null }>;
  productionFlow: { flowNo: string; yarnCount: string; fabricDiameter: string | null; fabricGsm: string | null; knittingGg: string | null; knittingLl: string | null; color: string | null } | null;
  /** Newest first. */
  days: Array<{ id: string; date: string; outputKg: number; rollCount: number }>;
};

type Account = {
  employee: {
    id: string;
    code: string;
    name: string;
    mobile: string | null;
    department: string;
    shift: string | null;
    joiningDate: string | null;
    active: boolean;
    createdAt: string;
    user: { id: string; name: string; email: string; role: string; status: string; createdAt: string } | null;
  };
  runs: Run[];
};

const shiftLabel = (shift: string) => (shift === "General" ? "General" : `Shift ${shift}`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
const runFabric = (run: Run) => fabricSpec({ ...run.productionFlow, fabricType: run.fabricType });

/** "2 years 3 months", "5 months", "12 days" since a date. */
function serviceLength(from: string) {
  const start = new Date(from);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) {
    const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years && `${years} year${years === 1 ? "" : "s"}`, rest && `${rest} month${rest === 1 ? "" : "s"}`].filter(Boolean).join(" ");
}

/** The last `count` months as YYYY-MM, newest first. */
function lastMonths(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** Monday of the week a day is in (weeks run Monday to Sunday). */
function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** The local day of an expense date (stored at local noon). */
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Money given to the employee, day by day: what was given each day (daily wage, salary, advance…), from which
 * account, with today / this week / this month / all-time totals. Each is a Wages expense on Money and Finance.
 */
function MoneyGiven({ employee, onGive }: { employee: { id: string; code: string; name: string }; onGive: () => void }) {
  const query = useApiQuery<Expense[]>(`/money/expenses?employeeId=${encodeURIComponent(employee.id)}`);
  const [cancelling, setCancelling] = useState<Expense | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => (query.data ?? []).map((r) => ({ ...r, day: localDay(r.expenseDate) })), [query.data]);
  const days = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) map.set(r.day, [...(map.get(r.day) ?? []), r]);
    return [...map].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const today = todayInput();
  const week = weekStart(today);
  const month = today.slice(0, 7);
  const sum = (list: typeof rows) => list.reduce((s, r) => s + r.amount, 0);
  const todayRows = rows.filter((r) => r.day === today);
  const weekRows = rows.filter((r) => r.day >= week);
  const monthRows = rows.filter((r) => r.day.slice(0, 7) === month);
  const byKind = [...monthRows.reduce((m, r) => m.set(r.subcategory ?? "Other", (m.get(r.subcategory ?? "Other") ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const visibleDays = showAll ? days : days.slice(0, 31);

  const exportRows = () =>
    downloadCsv(
      `${employee.code}-money-${today}.csv`,
      ["Date", "Expense no", "For", "Amount", "Paid by", "Account", "Note"],
      rows.map((r) => [r.day, r.expenseNo, r.subcategory ?? "", r.amount.toFixed(2), expenseModeLabel(r.paymentMode), r.account?.name ?? "", r.description ?? ""]),
    );

  return (
    <section className="knit-card">
      <div className="knit-card__head">
        <div><p className="knit-card__eyebrow">Money</p><h2 className="knit-card__title">Money given</h2></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={exportRows}><Download size={14} /> Export CSV</Button>
          <Button size="sm" className="knit-btn" onClick={onGive}><HandCoins size={14} /> Give money</Button>
        </div>
      </div>
      <div className="space-y-4 p-4">
        {!query.data ? (
          query.error ? <ErrorState message={query.error} onRetry={() => void query.reload()} /> : <Loading />
        ) : (
          <>
            <div className="knit-kpis">
              <div className="knit-kpi"><p>Today</p><strong>{money(sum(todayRows))}</strong><span>{todayRows.length ? todayRows.map((r) => r.subcategory ?? "Other").join(", ") : "Nothing given yet"}</span></div>
              <div className="knit-kpi"><p>This week</p><strong>{money(sum(weekRows))}</strong><span>since Monday {formatDate(`${week}T12:00:00`)}</span></div>
              <div className="knit-kpi"><p>{monthLabel(month)}</p><strong>{money(sum(monthRows))}</strong><span>{byKind.length ? byKind.map(([k, v]) => `${k} ${money(v)}`).join(" · ") : "Nothing this month"}</span></div>
              <div className="knit-kpi"><p>All time</p><strong>{money(sum(rows))}</strong><span>{rows.length} payment{rows.length === 1 ? "" : "s"} on {days.length} day{days.length === 1 ? "" : "s"}</span></div>
            </div>

            {days.length === 0 ? (
              <div className="knit-empty">
                <HandCoins size={22} />
                <p className="font-bold text-gray-900">No money given yet</p>
                <p className="text-sm text-gray-500">Record each day&apos;s wage, salary or advance with Give money. It counts on Money and Finance as Wages.</p>
              </div>
            ) : (
              <div className="emp-days">
                {visibleDays.map(([day, list]) => (
                  <div key={day} className="emp-day">
                    <div className="emp-day__head">
                      <span>{new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}{day === today ? " · today" : ""}</span>
                      <strong>{money(sum(list))}</strong>
                    </div>
                    <ul>
                      {list.map((r) => (
                        <li key={r.id}>
                          <span className="knit-chip">{r.subcategory ?? "Other"}</span>
                          <strong className="tabular-nums">{money(r.amount)}</strong>
                          <span className="text-xs text-gray-500">{expenseModeLabel(r.paymentMode)}{r.account ? ` · ${r.account.name}` : ""}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-gray-600" title={r.description ?? undefined}>{r.description ?? ""}</span>
                          <span className="font-mono text-[11px] text-gray-400">{r.expenseNo}</span>
                          <button type="button" className="knit-icon-btn" aria-label={`Cancel ${r.expenseNo}`} title="Cancel this payment" onClick={() => setCancelling(r)}><XCircle size={14} /></button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {days.length > visibleDays.length && (
                  <Button size="sm" variant="outline" onClick={() => setShowAll(true)}>Show all {days.length} days</Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {cancelling && <CancelExpenseDialog expense={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void query.reload(); }} />}
    </section>
  );
}

/**
 * `/masters/employees/<id>`: one employee — who they are, the machine they are on now with its fabric and yarn,
 * what they knitted day by day and month by month, every run they operated, and their login.
 */
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApiQuery<Account>(`/masters/employees/${id}/account`);
  const [filter, setFilter] = useState<"ALL" | "RUNNING" | "FINISHED">("ALL");
  const [busy, setBusy] = useState(false);
  const [giving, setGiving] = useState(false);
  const [moneyVersion, setMoneyVersion] = useState(0);

  // Every day they were on a machine, with the run it belongs to; newest first.
  const days = useMemo(
    () => (data?.runs ?? []).flatMap((run) => run.days.map((day) => ({ ...day, run }))).sort((a, b) => b.date.localeCompare(a.date) || a.run.machine.code.localeCompare(b.run.machine.code)),
    [data],
  );

  const back = <Link href="/masters/employees" className="purchases-back-link"><ArrowLeft size={15} /> Employees</Link>;
  if (!data) {
    return error ? <div className="knit-page space-y-4">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;
  }

  const { employee: e, runs } = data;
  const running = runs.filter((r) => r.status === "RUNNING");
  const fabricKg = runs.reduce((sum, r) => sum + (r.outputKg ?? 0), 0);
  const rolls = runs.reduce((sum, r) => sum + (r.rollCount ?? 0), 0);
  const worked = days.filter((d) => d.outputKg > 0);
  const workedDays = new Set(worked.map((d) => d.date)).size;
  const machines = [...new Map(runs.map((r) => [r.machine.id, r.machine])).values()];
  const month = localMonth();
  const monthDays = days.filter((d) => d.date.slice(0, 7) === month);
  const visible = filter === "ALL" ? runs : runs.filter((r) => r.status === filter);
  const future = !!e.joiningDate && e.joiningDate.slice(0, 10) > todayInput();
  const months = lastMonths(6).map((m) => {
    const rows = days.filter((d) => d.date.slice(0, 7) === m);
    return {
      month: m,
      days: new Set(rows.filter((d) => d.outputKg > 0).map((d) => d.date)).size,
      kg: rows.reduce((sum, d) => sum + d.outputKg, 0),
      rolls: rows.reduce((sum, d) => sum + d.rollCount, 0),
      machines: [...new Set(rows.map((d) => d.run.machine.code))].sort(),
    };
  });
  const lastWorked = worked[0]?.date ?? null;

  const toggleActive = async () => {
    const deactivate = e.active;
    if (deactivate && running.length) return toast.error(`${e.name} is operating ${running.map((r) => r.machine.code).join(", ")} now. Change the operator or stop the machine first.`);
    const ok = await confirmDialog({
      title: deactivate ? `Make ${e.name} inactive?` : `Make ${e.name} active again?`,
      description: deactivate ? "They can't be picked as a machine operator while inactive. Their runs and login stay as they are." : "They can be picked as a machine operator again.",
      confirmLabel: deactivate ? "Make inactive" : "Make active",
      tone: deactivate ? "danger" : undefined,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/masters/employees/${e.id}`, { method: "PATCH", body: JSON.stringify({ active: !e.active }) });
      toast.success(`${e.name} is ${deactivate ? "inactive" : "active"}.`);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Could not change the employee"));
    } finally {
      setBusy(false);
    }
  };

  const exportRuns = () =>
    downloadCsv(
      `${e.code}-runs-${todayInput()}.csv`,
      ["Run", "Task", "Machine", "Fabric", "Yarn", "Started", "Finished", "Ended because", "Days entered", "Fabric KG", "Rolls", "Status"],
      visible.map((r) => [
        r.runNo,
        r.productionFlow?.flowNo ?? "",
        r.machine.code,
        runFabric(r),
        r.yarns.map((y) => y.itemCode).join(" "),
        shiftText(r.startedAt, r.startShift),
        r.finishedAt ? shiftText(r.finishedAt, r.finishShift) : "",
        r.endReason ?? "",
        r.days.length,
        r.outputKg?.toFixed(3) ?? "",
        r.rollCount ?? "",
        r.status === "RUNNING" ? "Knitting" : "Finished",
      ]),
    );
  const exportDays = () =>
    downloadCsv(
      `${e.code}-days-${todayInput()}.csv`,
      ["Production day", "Machine", "Run", "Task", "Fabric", "Fabric KG", "Rolls"],
      days.map((d) => [d.date, d.run.machine.code, d.run.runNo, d.run.productionFlow?.flowNo ?? "", runFabric(d.run), d.outputKg.toFixed(3), d.rollCount]),
    );

  const details: Array<[string, React.ReactNode]> = [
    ["Employee code", <span key="code" className="font-mono">{e.code}</span>],
    ["Department", e.department],
    ["Shift", e.shift ? shiftLabel(e.shift) : "—"],
    ["Mobile", e.mobile ? <a key="tel" href={`tel:${e.mobile}`} className="text-[#1b3c55] hover:underline">{e.mobile}</a> : "—"],
    ["Joining date", e.joiningDate ? formatDate(e.joiningDate) : "—"],
    ["With us for", e.joiningDate ? (future ? "Joins on that date" : serviceLength(e.joiningDate)) : "—"],
    ["Last on a machine", running.length ? "Now" : lastWorked ? formatDate(lastWorked) : "—"],
    ["Added on", formatDate(e.createdAt)],
  ];

  return (
    <div className="knit-page space-y-4 pb-10">
      {back}

      <header className="emp-hero">
        <span className="emp-hero__avatar" aria-hidden>{initials(e.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="knit-eyebrow">{e.department}{e.shift ? ` · ${shiftLabel(e.shift)}` : ""}</p>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-black tracking-tight">
            {e.name}
            <span className="font-mono text-sm font-semibold text-white/60">{e.code}</span>
            <span className={cn("emp-hero__status", e.active ? "is-active" : "is-inactive")}>{e.active ? "Active" : "Inactive"}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/65">
            {e.mobile && <span className="inline-flex items-center gap-1"><Phone size={12} /> {e.mobile}</span>}
            {e.joiningDate && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {future ? "Joins" : "Joined"} {formatDate(e.joiningDate)}</span>}
            {e.shift && <span className="inline-flex items-center gap-1"><Clock3 size={12} /> {shiftLabel(e.shift)}</span>}
            {e.user && <span className="inline-flex items-center gap-1"><KeyRound size={12} /> Signs in as {e.user.email}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {e.mobile && <Button variant="ghost" className="knit-ghost" asChild><a href={`tel:${e.mobile}`}><Phone size={15} /> Call</a></Button>}
          <Button variant="ghost" className="knit-ghost" onClick={() => setGiving(true)}><HandCoins size={15} /> Give money</Button>
          <Button variant="ghost" className="knit-ghost" disabled={busy} onClick={() => void toggleActive()}><Power size={15} /> {e.active ? "Make inactive" : "Make active"}</Button>
          <Button className="knit-cta" asChild><Link href={`/masters/employees?${EDIT_PARAM}=${e.id}`}><Pencil size={15} /> Edit</Link></Button>
        </div>
      </header>

      {!e.active && <p className="knit-alert is-warn">Inactive: they can&apos;t be picked as a machine operator. Their runs stay below.</p>}

      {running.length > 0 ? (
        <section className="emp-now">
          <p className="emp-now__title"><span className="knit-live-dot" aria-hidden /> On {running.length === 1 ? "a machine" : `${running.length} machines`} now</p>
          <div className="emp-now__grid">
            {running.map((r) => (
              <Link key={r.id} href={runHref(r.runNo)} className="emp-now__card">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-lg font-black text-[#0f2a24]">{r.machine.code}</span>
                  <span className="knit-state is-running">Running</span>
                </span>
                <span className="flex items-center gap-1 text-xs font-bold text-[#1f8a6a]"><Timer size={13} aria-hidden /> {elapsedText(Date.now() - shiftStart(r.startedAt, r.startShift).getTime())} · since {shiftText(r.startedAt, r.startShift)}</span>
                <dl className="knit-spec">
                  <div><dt>Task</dt><dd>{r.productionFlow?.flowNo ?? r.runNo} · <span className="font-mono">{r.runNo}</span></dd></div>
                  <div><dt>Fabric</dt><dd>{runFabric(r) || "—"}</dd></div>
                  <div><dt>Yarn</dt><dd>{[r.yarns.map((y) => y.itemCode).join(", "), r.productionFlow?.yarnCount, r.yarns[0]?.lotNo && `lot ${r.yarns[0].lotNo}`].filter(Boolean).join(" · ") || "—"}</dd></div>
                </dl>
                <span className="text-xs text-gray-600">Knitted <strong>{kg(r.outputKg ?? 0)}</strong> · {r.rollCount ?? 0} rolls · {r.days.length} day{r.days.length === 1 ? "" : "s"} entered</span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        e.active && <p className="knit-alert is-ok">Not on a machine now{lastWorked ? `; last knitted on ${formatDate(lastWorked)}` : ""}. Choose them as the operator when putting a task on a machine.</p>
      )}

      <div className="knit-kpis">
        <div className="knit-kpi"><p>Fabric knitted</p><strong>{kg(fabricKg)}</strong><span>{rolls} rolls on {runs.length} run{runs.length === 1 ? "" : "s"}</span></div>
        <div className="knit-kpi"><p>{monthLabel(month)}</p><strong>{kg(monthDays.reduce((sum, d) => sum + d.outputKg, 0))}</strong><span>{new Set(monthDays.filter((d) => d.outputKg > 0).map((d) => d.date)).size} days on machines</span></div>
        <div className="knit-kpi"><p>Days on machines</p><strong>{workedDays}</strong><span>{workedDays ? `${kg(worked.reduce((sum, d) => sum + d.outputKg, 0) / workedDays)} a day on average` : "From the day-end entries"}</span></div>
        <div className="knit-kpi"><p>Machines worked</p><strong>{machines.length}</strong><span className="block truncate">{machines.length ? machines.map((m) => m.code).join(", ") : "None yet"}</span></div>
      </div>

      <MoneyGiven key={moneyVersion} employee={e} onGive={() => setGiving(true)} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="knit-card">
          <div className="knit-card__head"><div><p className="knit-card__eyebrow">Employee</p><h2 className="knit-card__title">Work details</h2></div></div>
          <div className="p-4">
            <dl className="knit-facts emp-facts">
              {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="knit-card">
          <div className="knit-card__head"><div><p className="knit-card__eyebrow">ERP account</p><h2 className="knit-card__title">Login</h2></div></div>
          <div className="p-4">
            {e.user ? (
              <dl className="grid gap-2.5 text-sm">
                <div><dt className="erp-label">Name</dt><dd className="font-medium text-gray-800">{e.user.name}</dd></div>
                <div><dt className="erp-label">Email</dt><dd className="break-all font-medium text-gray-800">{e.user.email}</dd></div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info">{humanize(e.user.role)}</Badge>
                  <Badge tone={e.user.status === "ACTIVE" ? "success" : "warning"}>{humanize(e.user.status)}</Badge>
                </div>
                <p className="text-xs text-gray-500">Created {formatDate(e.user.createdAt)}. Change the role or password in <Link href="/admin/users" className="font-semibold text-[#1b3c55] hover:underline">Users</Link>.</p>
              </dl>
            ) : (
              <div className="knit-empty">
                <KeyRound size={20} />
                <p className="font-bold text-gray-900">Not linked to a login</p>
                <p className="text-sm text-gray-500">To let them sign in, create or link a user in <Link href="/admin/users" className="font-semibold underline">Users</Link>.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="knit-card">
        <div className="knit-card__head">
          <div><p className="knit-card__eyebrow">Month by month</p><h2 className="knit-card__title">Last 6 months</h2></div>
        </div>
        <div className="p-4">
          <div className="overflow-x-auto rounded-xl border">
            <table className="knit-table w-full min-w-[560px] text-sm">
              <thead><tr><th>Month</th><th className="text-right">Days on machines</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th><th>Machines</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className={cn(!m.days && "text-gray-400")}>
                    <td className="font-semibold">{monthLabel(m.month)}</td>
                    <td className="text-right">{m.days || "—"}</td>
                    <td className="text-right font-semibold">{m.kg ? kg(m.kg) : "—"}</td>
                    <td className="text-right">{m.rolls || "—"}</td>
                    <td className="text-xs">{m.machines.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="knit-card">
        <div className="knit-card__head">
          <div><p className="knit-card__eyebrow">Day by day</p><h2 className="knit-card__title">Production on their runs</h2></div>
          <Button size="sm" variant="outline" disabled={!days.length} onClick={exportDays}><Download size={14} /> Export CSV</Button>
        </div>
        <div className="p-4">
          {days.length === 0 ? (
            <div className="knit-empty">
              <Factory size={20} />
              <p className="font-bold text-gray-900">No day entered yet</p>
              <p className="text-sm text-gray-500">The KG and rolls entered at the end of each day on their runs show here.</p>
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-auto rounded-xl border">
              <table className="knit-table w-full min-w-[640px] text-sm">
                <thead><tr><th>Production day</th><th>Machine</th><th>Run · fabric</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th></tr></thead>
                <tbody>
                  {days.slice(0, 120).map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap font-semibold">{formatDate(d.date)}</td>
                      <td><Link href={machineHref(d.run.machine.id)} className="font-mono font-bold text-[#0f2a24] hover:underline">{d.run.machine.code}</Link></td>
                      <td><Link href={runHref(d.run.runNo)} className="knit-code">{d.run.runNo}</Link><span className="block truncate text-xs text-gray-500">{runFabric(d.run) || "—"}</span></td>
                      <td className={cn("text-right font-semibold", d.outputKg <= 0 && "text-gray-400")}>{d.outputKg > 0 ? kg(d.outputKg) : "Stood still"}</td>
                      <td className="text-right">{d.rollCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {days.length > 120 && <p className="mt-2 text-xs text-gray-500">Showing the latest 120 days; Export CSV has all {days.length}.</p>}
        </div>
      </section>

      <section className="knit-card">
        <div className="knit-card__head">
          <div><p className="knit-card__eyebrow">Record</p><h2 className="knit-card__title">Machine runs ({runs.length})</h2></div>
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
              <UserCog size={20} />
              <p className="font-bold text-gray-900">{runs.length ? "No runs with this status" : "No machine runs yet"}</p>
              <p className="text-sm text-gray-500">{runs.length ? "Show all runs." : "Runs appear here when they are picked as the operator on a machine."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="knit-table w-full min-w-[900px] text-sm">
                <thead><tr><th>Run</th><th>Machine</th><th>Fabric · yarn</th><th>Shifts</th><th className="text-right">Days</th><th className="text-right">Fabric</th><th className="text-right">Rolls</th><th>Status</th></tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={runHref(r.runNo)} className="knit-code is-button">{r.runNo}</Link>{r.productionFlow && <span className="block text-xs text-gray-500">{r.productionFlow.flowNo}</span>}</td>
                      <td><Link href={machineHref(r.machine.id)} className="font-semibold text-[#1b3c55] hover:underline">{r.machine.code}</Link><span className="block text-xs text-gray-500">{r.machine.name}</span></td>
                      <td className="max-w-[16rem]"><span className="block truncate text-xs font-semibold text-gray-700">{runFabric(r) || "—"}</span><span className="block font-mono text-xs text-gray-500">{r.yarns.map((y) => y.itemCode).join(", ")}</span></td>
                      <td className="whitespace-nowrap text-xs text-gray-600">
                        {shiftText(r.startedAt, r.startShift)}
                        <span className="block">{r.finishedAt ? `→ ${shiftText(r.finishedAt, r.finishShift)}` : "→ knitting"}</span>
                        {r.endReason && <span className="block font-semibold text-amber-700">{r.endReason}</span>}
                      </td>
                      <td className="text-right">{r.days.length || "—"}</td>
                      <td className="text-right font-semibold">{r.outputKg === null ? "—" : kg(r.outputKg)}</td>
                      <td className="text-right">{r.rollCount ?? "—"}</td>
                      <td><span className={cn("knit-pill", r.status === "RUNNING" ? "is-live" : "is-done")}>{r.status === "RUNNING" ? "Knitting" : "Finished"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {giving && (
        <EmployeePaymentDialog
          employee={e}
          onClose={() => setGiving(false)}
          onSaved={() => {
            setGiving(false);
            setMoneyVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
