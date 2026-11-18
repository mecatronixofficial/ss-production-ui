"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { ADMIN_ROLES } from "@/lib/navigation";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, kg, money } from "@/lib/utils";
import { machineReportRange, type MachineReportPeriod } from "./report-range";
import { currentShift, machineHref } from "./types";

type Figures = { fabricKg: number; yarnKg: number; rolls: number; daysWorked: number; charges: number | null };
type MachineRow = Figures & { id: string; code: string; name: string; status: string; runsFinished: number; kgPerDay: number };
type DayRow = Omit<Figures, "daysWorked"> & { date: string; machinesWorked: number };
type MachineReport = {
  from: string;
  to: string;
  machineId: string | null;
  pricesShown: boolean;
  machines: Array<{ id: string; code: string; name: string }>;
  rows: MachineRow[];
  daily: DayRow[];
  totals: Figures & { machinesWorked: number; runsFinished: number; kgPerDay: number };
};

const PERIODS: Array<{ value: MachineReportPeriod; label: string }> = [
  { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" },
  { value: "year", label: "Year" }, { value: "custom", label: "Custom" },
];

/** Reports load their whole date range from the API, independently of the recent runs on the floor. */
export function MachineProductionReport({ machineId }: { machineId?: string }) {
  const { user } = useAuth();
  const [period, setPeriod] = useState<MachineReportPeriod>("day");
  const [anchor, setAnchor] = useState(() => currentShift().date);
  const [custom, setCustom] = useState(() => ({ from: `${currentShift().date.slice(0, 7)}-01`, to: currentShift().date }));
  const [selectedMachine, setSelectedMachine] = useState("");
  const scope = machineId || selectedMachine;
  const range = machineReportRange(period, anchor, custom);
  const path = range ? `/knitting/report?${new URLSearchParams({ ...range, ...(scope ? { machineId: scope } : {}) })}` : null;
  const query = useApiQuery<MachineReport>(path);
  // A date change must not label a previous range's cached numbers as the new report.
  const data = range && query.data?.from === range.from && query.data.to === range.to && query.data.machineId === (scope || null) ? query.data : null;
  const showPrices = !!user && ADMIN_ROLES.includes(user.role) && !!data?.pricesShown;
  const canExport = !!data && !query.loading;
  const exportScope = scope ? data?.machines.find((machine) => machine.id === scope)?.code ?? scope : "all-machines";

  const columns = useMemo<ColumnDef<MachineRow>[]>(() => [
    { header: "Machine", accessorFn: (row) => `${row.code} ${row.name}`, cell: ({ row }) => <Link href={machineHref(row.original.id)} className="font-semibold text-[#1b3c55] hover:underline">{row.original.code}<span className="block text-xs font-normal text-gray-500">{row.original.name}</span></Link> },
    { header: "Days worked", accessorKey: "daysWorked", meta: { align: "right" } },
    { header: "Yarn used", accessorKey: "yarnKg", meta: { align: "right" }, cell: ({ row }) => kg(row.original.yarnKg) },
    { header: "Fabric knitted", accessorKey: "fabricKg", meta: { align: "right" }, cell: ({ row }) => <b>{kg(row.original.fabricKg)}</b> },
    { header: "Rolls", accessorKey: "rolls", meta: { align: "right" } },
    { header: "KG / working day", accessorKey: "kgPerDay", meta: { align: "right" }, cell: ({ row }) => row.original.daysWorked ? kg(row.original.kgPerDay) : "—" },
    { header: "Runs finished", accessorKey: "runsFinished", meta: { align: "right" } },
    ...(showPrices ? [{ header: "Knitting charges", accessorKey: "charges", meta: { align: "right" as const }, cell: ({ row }: { row: { original: MachineRow } }) => money(row.original.charges) }] : []),
  ], [showPrices]);
  const dailyColumns = useMemo<ColumnDef<DayRow>[]>(() => [
    { header: "Production day", accessorKey: "date", cell: ({ row }) => formatDate(row.original.date) },
    { header: "Machines worked", accessorKey: "machinesWorked", meta: { align: "right" } },
    { header: "Yarn used", accessorKey: "yarnKg", meta: { align: "right" }, cell: ({ row }) => kg(row.original.yarnKg) },
    { header: "Fabric knitted", accessorKey: "fabricKg", meta: { align: "right" }, cell: ({ row }) => kg(row.original.fabricKg) },
    { header: "Rolls", accessorKey: "rolls", meta: { align: "right" } },
    ...(showPrices ? [{ header: "Knitting charges", accessorKey: "charges", meta: { align: "right" as const }, cell: ({ row }: { row: { original: DayRow } }) => money(row.original.charges) }] : []),
  ], [showPrices]);

  const exportMachines = () => {
    if (!data) return;
    downloadCsv(`machine-report-${exportScope}-${data.from}-to-${data.to}.csv`,
      ["From", "To", "Machine code", "Machine", "Days worked", "Yarn used KG", "Fabric KG", "Rolls", "KG / working day", "Runs finished", ...(showPrices ? ["Knitting charges"] : [])],
      data.rows.map((row) => [data.from, data.to, row.code, row.name, row.daysWorked, row.yarnKg.toFixed(3), row.fabricKg.toFixed(3), row.rolls, row.kgPerDay.toFixed(3), row.runsFinished, ...(showPrices ? [(row.charges ?? 0).toFixed(2)] : [])]));
  };
  const exportDays = () => {
    if (!data) return;
    downloadCsv(`machine-production-days-${exportScope}-${data.from}-to-${data.to}.csv`,
      ["Machine", "Production day", "Machines worked", "Yarn used KG", "Fabric KG", "Rolls", ...(showPrices ? ["Knitting charges"] : [])],
      data.daily.map((row) => [scope ? exportScope : "All machines", row.date, row.machinesWorked, row.yarnKg.toFixed(3), row.fabricKg.toFixed(3), row.rolls, ...(showPrices ? [(row.charges ?? 0).toFixed(2)] : [])]));
  };

  return (
    <section className="knit-card" aria-label="Machine production report">
      <div className="knit-card__head">
        <div><p className="knit-card__eyebrow">Production reports</p><h2 className="knit-card__title">{machineId ? "This machine's report" : "Machine reports"}</h2></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!path || query.loading} onClick={() => void query.reload()}><RefreshCw size={14} className={cn(query.loading && "animate-spin")} />Refresh</Button>
          <Button size="sm" variant="outline" disabled={!canExport || !data?.rows.length} onClick={exportMachines}><Download size={14} />Export report</Button>
        </div>
      </div>
      <div className="space-y-5 p-4 md:p-5">
        <div className="knit-tabs" role="group" aria-label="Report period">
          {PERIODS.map((option) => <button key={option.value} type="button" aria-pressed={period === option.value} className={cn(period === option.value && "is-active")} onClick={() => setPeriod(option.value)}>{option.label}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {period === "custom" ? <>
            <label><span className="erp-label">From date</span><Input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
            <label><span className="erp-label">To date</span><Input type="date" min={custom.from || undefined} value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
          </> : <label>
            <span className="erp-label">{period === "week" ? "Week containing" : PERIODS.find((option) => option.value === period)?.label}</span>
            {period === "year" ? <Input type="number" min="1" max="9999" step="1" value={anchor.split("-")[0]} onChange={(event) => setAnchor(event.target.value ? `${event.target.value}-01-01` : "")} /> : <Input type={period === "month" ? "month" : "date"} value={period === "month" ? anchor.slice(0, 7) : anchor} onChange={(event) => setAnchor(event.target.value ? `${event.target.value}${period === "month" ? "-01" : ""}` : "")} />}
          </label>}
          {!machineId && <label><span className="erp-label">Machine</span><select className="erp-input" value={selectedMachine} onChange={(event) => setSelectedMachine(event.target.value)}><option value="">All machines</option>{query.data?.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.code} · {machine.name}</option>)}</select></label>}
        </div>
        {!range ? <p className="text-sm text-rose-700" role="alert">Choose valid dates. The from date must be on or before the to date.</p> : <p className="text-xs text-gray-500"><strong className="text-gray-700">{formatDate(range.from)} – {formatDate(range.to)}</strong> · Both dates included{period === "week" ? " · Monday to Sunday" : ""}. Production follows each day&apos;s Day and Night shifts.</p>}
        {range && query.error ? <ErrorState title="Could not load the machine report" message={query.error} onRetry={() => void query.reload()} /> : range && !data ? <p role="status" className="py-10 text-center text-sm text-gray-500">Loading report…</p> : null}
        {data && !query.error && <div className="space-y-5" aria-busy={query.loading}>
          <div className="knit-kpis">
            <div className="knit-kpi"><p>Fabric knitted</p><strong>{kg(data.totals.fabricKg)}</strong><span>{data.totals.rolls} rolls</span></div>
            <div className="knit-kpi"><p>Yarn used</p><strong>{kg(data.totals.yarnKg)}</strong><span>during this period</span></div>
            <div className="knit-kpi"><p>Machines worked</p><strong>{data.totals.machinesWorked}</strong><span>{data.totals.daysWorked} production days with output</span></div>
            <div className="knit-kpi"><p>Runs finished</p><strong>{data.totals.runsFinished}</strong><span>{data.totals.daysWorked ? `${kg(data.totals.kgPerDay)} per working day` : "No production recorded"}</span></div>
            {showPrices && <div className="knit-kpi"><p>Knitting charges</p><strong>{money(data.totals.charges)}</strong><span>for this period&apos;s output</span></div>}
          </div>
          <div><h3 className="mb-3 font-bold text-gray-900">By machine</h3><DataTable columns={columns} data={data.rows} searchPlaceholder="Search machine code or name..." getRowId={(row) => row.id} emptyTitle="No machines in this report" minWidth={showPrices ? 1000 : 850} /></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-gray-900">Production by day</h3><Button size="sm" variant="outline" disabled={!canExport || !data.daily.length} onClick={exportDays}><Download size={14} />Export days</Button></div>
          <DataTable columns={dailyColumns} data={data.daily} hideSearch pageSize={10} getRowId={(row) => row.date} minWidth={showPrices ? 750 : 620} emptyTitle="No production recorded in this period" emptyDescription="Try another day or a wider date range." />
        </div>}
      </div>
    </section>
  );
}
