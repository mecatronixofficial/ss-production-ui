"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarRange,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  Info,
  Landmark,
  LayoutDashboard,
  Loader2,
  PackageCheck,
  ReceiptIndianRupee,
  RefreshCw,
  Search,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { apiDownload } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime, humanize, kg, money } from "@/lib/utils";
import { DataTable } from "@/components/data-table";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type ColumnType = "text" | "date" | "status" | "kg" | "qty" | "money" | "number" | "pct";
type ReportColumn = { key: string; label: string; type: ColumnType; total?: boolean };
type Row = Record<string, string | number | null>;
type CatalogItem = { key: string; title: string; group: string; description: string; dateLabel: string | null };
type Report = CatalogItem & {
  columns: ReportColumn[];
  rows: Row[];
  summary: Array<{ label: string; value: number | string; type: ColumnType; hint?: string }>;
  totals: Record<string, number>;
  note?: string;
  truncated: boolean;
  generatedAt: string;
  from: string | null;
  to: string | null;
};
type Preset = "this-month" | "last-month" | "this-quarter" | "this-fy" | "last-fy" | "last-30" | "all" | "custom";

/** Sidebar order; a group the server adds later still shows, after these. */
const GROUPS: Array<{ name: string; icon: LucideIcon }> = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Sales", icon: ReceiptIndianRupee },
  { name: "Production", icon: Factory },
  { name: "Purchases", icon: PackageCheck },
  { name: "Inventory", icon: Boxes },
  { name: "Machines", icon: Wrench },
  { name: "Finance", icon: Landmark },
];
const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "this-fy", label: "This financial year" },
  { value: "last-fy", label: "Last financial year" },
  { value: "last-30", label: "Last 30 days" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom…" },
];
const DEFAULT_REPORT = "monthly-summary";
const DEFAULT_PRESET: Preset = "this-fy";

const NUMERIC: ColumnType[] = ["kg", "qty", "money", "number", "pct"];
/** Status columns coloured by meaning; other enum columns (category, mode, party type…) are plain tags. */
const STATUS_KEYS = new Set(["status", "payment"]);
const DAY_MS = 86_400_000;
const localDate = (y: number, m: number, d = 1) => new Date(y, m, d);
/** yyyy-mm-dd from a date input, read as local midnight. */
const fromInput = (value: string) => (value ? new Date(`${value}T00:00:00`) : undefined);
const isPreset = (value: string | null): value is Preset => PRESETS.some((p) => p.value === value);
const isDateInput = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Date range for a preset; `to` is exclusive. Indian financial year: 1 April – 31 March. */
function rangeFor(preset: Preset, customFrom: string, customTo: string): { from?: Date; to?: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const fyStart = m >= 3 ? y : y - 1;
  switch (preset) {
    case "this-month":
      return { from: localDate(y, m), to: localDate(y, m + 1) };
    case "last-month":
      return { from: localDate(y, m - 1), to: localDate(y, m) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: localDate(y, q), to: localDate(y, q + 3) };
    }
    case "this-fy":
      return { from: localDate(fyStart, 3), to: localDate(fyStart + 1, 3) };
    case "last-fy":
      return { from: localDate(fyStart - 1, 3), to: localDate(fyStart, 3) };
    case "last-30":
      // Calendar days, so a daylight-saving change can't shift the edges.
      return { from: localDate(y, m, now.getDate() - 29), to: localDate(y, m, now.getDate() + 1) };
    case "custom": {
      const to = fromInput(customTo);
      return { from: fromInput(customFrom), to: to ? localDate(to.getFullYear(), to.getMonth(), to.getDate() + 1) : undefined };
    }
    default:
      return {};
  }
}

/** "1 Apr 2026 – 31 Mar 2027" for a range whose end is exclusive. */
function periodText(range: { from?: Date; to?: Date }) {
  const from = range.from ? formatDate(range.from) : null;
  const to = range.to ? formatDate(new Date(range.to.getTime() - DAY_MS / 2)) : null;
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return "All dates";
}

function formatValue(value: string | number | null | undefined, type: ColumnType) {
  if (value === null || value === undefined || value === "") return NUMERIC.includes(type) ? "0" : "—";
  const n = Number(value);
  switch (type) {
    case "money":
      return money(n);
    case "kg":
      return kg(n);
    case "qty":
      return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
    case "number":
      return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
    case "pct":
      return `${n.toFixed(1)}%`;
    case "date":
      return formatDate(String(value));
    case "status":
      return humanize(String(value));
    default:
      return String(value);
  }
}

/** Minus amounts (losses, advances, net outflow) stand out in red. */
const negative = (value: unknown, type: ColumnType) => (type === "money" || type === "pct") && Number(value) < -0.005;

function ReportTable({ report }: { report: Report }) {
  const [filter, setFilter] = useState("");
  const hasTotals = report.columns.some((c) => c.total);

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      report.columns.map((c, index) => ({
        id: c.key,
        header: c.label,
        accessorFn: (row) => {
          const v = row[c.key];
          // Sort numbers and dates by value, not by their formatted text.
          if (NUMERIC.includes(c.type)) return Number(v ?? 0);
          return v ?? "";
        },
        enableGlobalFilter: !NUMERIC.includes(c.type),
        meta: { align: NUMERIC.includes(c.type) ? "right" : "left" },
        cell: ({ row }) => {
          const v = row.original[c.key];
          if (c.type === "status" && v)
            return <Badge tone={STATUS_KEYS.has(c.key) ? statusTone(String(v)) : "default"}>{humanize(String(v))}</Badge>;
          if (c.type === "text" && index === 0) return <span className="font-semibold text-gray-800">{formatValue(v, c.type)}</span>;
          if (negative(v, c.type)) return <span className="rpt-negative">{formatValue(v, c.type)}</span>;
          return formatValue(v, c.type);
        },
        // Totals follow the search box, so they always match the rows shown.
        footer: ({ table }) => {
          if (index === 0) return "Total";
          if (!c.total) return null;
          const sum = table.getFilteredRowModel().rows.reduce((acc, r) => acc + Number(r.original[c.key] ?? 0), 0);
          return <span className={cn(negative(sum, c.type) && "rpt-negative")}>{formatValue(sum, c.type)}</span>;
        },
      })),
    [report.columns],
  );

  return (
    <div className="rpt-table">
      <div className="rpt-table__bar">
        <label className="rpt-search">
          <Search size={15} className="text-gray-400" aria-hidden />
          <Input placeholder="Search this report..." aria-label="Search this report" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <p className="text-xs text-gray-500">
          {report.rows.length.toLocaleString("en-IN")} row{report.rows.length === 1 ? "" : "s"}
          {filter && " · totals follow the search"}
        </p>
      </div>
      <DataTable
        data={report.rows}
        columns={columns}
        filter={filter}
        onFilterChange={setFilter}
        hideSearch
        pageSize={25}
        minWidth={Math.max(720, report.columns.length * 120)}
        showFooter={hasTotals}
        emptyTitle={report.dateLabel ? "No records for these dates" : "Nothing to show"}
        emptyDescription={report.dateLabel ? "Try a wider date range, such as All time." : "There is nothing open right now."}
      />
    </div>
  );
}

export default function Reports() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = params.get("report") || DEFAULT_REPORT;
  // The period lives in the URL, so a refresh or a shared link shows the same report.
  const rangeParam = params.get("range");
  const preset: Preset = isPreset(rangeParam) ? rangeParam : DEFAULT_PRESET;
  const customFrom = isDateInput(params.get("from")) ? params.get("from")! : "";
  const customTo = isDateInput(params.get("to")) ? params.get("to")! : "";
  const [navFilter, setNavFilter] = useState("");
  const [downloading, setDownloading] = useState<"xlsx" | "pdf" | null>(null);

  const catalog = useApiQuery<CatalogItem[]>("/reports");
  const info = catalog.data?.find((r) => r.key === selected) ?? catalog.data?.[0];
  const usesDates = info ? info.dateLabel !== null : true;

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (!usesDates) return q;
    if (range.from) q.set("from", range.from.toISOString());
    if (range.to) q.set("to", range.to.toISOString());
    return q;
  }, [range, usesDates]);
  const customInvalid = preset === "custom" && Boolean(customFrom && customTo && customFrom > customTo);
  const report = useApiQuery<Report>(info && !customInvalid ? `/reports/${info.key}?${query}` : null);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const choose = (key: string) => setParams({ report: key });
  const choosePreset = (value: Preset) =>
    setParams(value === "custom" ? { range: value } : { range: value === DEFAULT_PRESET ? null : value, from: null, to: null });

  const download = async (format: "xlsx" | "pdf") => {
    if (!info) return;
    setDownloading(format);
    try {
      await apiDownload(`/reports/${info.key}/export.${format}?${query}`, `${info.key}-report-${new Date().toISOString().slice(0, 10)}.${format}`);
    } catch {
      // api() already showed the error.
    } finally {
      setDownloading(null);
    }
  };

  const grouped = useMemo(() => {
    const reports = catalog.data ?? [];
    const known = GROUPS.map((g) => g.name);
    const extra = [...new Set(reports.map((r) => r.group))].filter((g) => !known.includes(g)).map((name) => ({ name, icon: BarChart3 }));
    return [...GROUPS, ...extra].map((g) => ({ ...g, reports: reports.filter((r) => r.group === g.name) })).filter((g) => g.reports.length);
  }, [catalog.data]);
  const visibleGroups = useMemo(() => {
    const needle = navFilter.trim().toLowerCase();
    if (!needle) return grouped;
    return grouped
      .map((g) => ({ ...g, reports: g.reports.filter((r) => `${r.title} ${r.description} ${r.group}`.toLowerCase().includes(needle)) }))
      .filter((g) => g.reports.length);
  }, [grouped, navFilter]);

  if (!catalog.data && catalog.error) return <ErrorState message={catalog.error} onRetry={() => void catalog.reload()} />;
  if (!catalog.data || !info) return <Loading />;

  const GroupIcon = grouped.find((g) => g.name === info.group)?.icon ?? BarChart3;
  const data = report.data?.key === info.key ? report.data : undefined;
  const customEmpty = preset === "custom" && !customFrom && !customTo;

  return (
    <div className="rpt-page">
      <aside className="rpt-nav" aria-label="Reports">
        <p className="rpt-nav__title">
          <BarChart3 size={15} /> Reports <span className="rpt-nav__count">{catalog.data.length}</span>
        </p>
        <select className="erp-input rpt-nav__select" value={info.key} onChange={(e) => choose(e.target.value)} aria-label="Choose a report">
          {grouped.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.reports.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="rpt-nav__list">
          <label className="rpt-nav__search">
            <Search size={13} className="text-gray-400" aria-hidden />
            <input value={navFilter} onChange={(e) => setNavFilter(e.target.value)} placeholder="Find a report" aria-label="Find a report" />
            {navFilter && (
              <button type="button" onClick={() => setNavFilter("")} aria-label="Clear report search">
                <X size={13} />
              </button>
            )}
          </label>
          <nav className="flex flex-col gap-[.55rem]">
            {visibleGroups.map(({ name, icon: Icon, reports }) => (
              <div key={name} className="rpt-nav__group">
                <p className="rpt-nav__group-title">
                  <Icon size={13} aria-hidden /> {name}
                </p>
                {reports.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => choose(r.key)}
                    title={r.description}
                    aria-current={r.key === info.key ? "page" : undefined}
                    className={cn("rpt-nav__item", r.key === info.key && "is-active")}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            ))}
            {!visibleGroups.length && <p className="px-2 py-3 text-xs text-gray-500">No report matches “{navFilter.trim()}”.</p>}
          </nav>
        </div>
      </aside>

      <section className="rpt-main" aria-labelledby="report-title">
        <header className="rpt-head">
          <span className="rpt-head__icon">
            <GroupIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="rpt-head__group">{info.group} report</p>
            <h2 id="report-title" className="rpt-head__title">
              {info.title}
            </h2>
            <p className="rpt-head__desc">{info.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void report.reload()} disabled={report.loading || customInvalid} aria-label="Refresh report" title="Refresh">
              <RefreshCw size={14} className={cn(report.loading && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" disabled={downloading !== null || !data} onClick={() => void download("xlsx")}>
              {downloading === "xlsx" ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
            </Button>
            <Button size="sm" disabled={downloading !== null || !data} onClick={() => void download("pdf")}>
              {downloading === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
            </Button>
          </div>
        </header>

        <div className="rpt-filters">
          {usesDates ? (
            <>
              <span className="rpt-filters__label">
                <CalendarRange size={14} aria-hidden /> {info.dateLabel}
              </span>
              <div className="rpt-presets" role="radiogroup" aria-label="Date range">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={preset === p.value}
                    className={cn(preset === p.value && "is-active")}
                    onClick={() => choosePreset(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {preset === "custom" && (
                <div className="rpt-custom">
                  <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setParams({ from: e.target.value || null })} aria-label="From date" />
                  <span className="text-xs text-gray-400">to</span>
                  <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setParams({ to: e.target.value || null })} aria-label="To date" />
                  {customInvalid && <span className="text-xs text-red-600">Start date must be before the end date.</span>}
                </div>
              )}
              {!customInvalid && (
                <span className="rpt-period" aria-live="polite">
                  {customEmpty ? "Pick a start and / or end date — showing all dates" : periodText(range)}
                </span>
              )}
            </>
          ) : (
            <span className="rpt-filters__label">
              <Info size={14} aria-hidden /> Always shows the position as of today.
            </span>
          )}
        </div>

        {customInvalid ? (
          <p className="rpt-warning">
            <AlertTriangle size={14} /> Choose a start date on or before the end date to see this report.
          </p>
        ) : !data && report.error ? (
          <ErrorState message={report.error} onRetry={() => void report.reload()} />
        ) : !data ? (
          <Loading />
        ) : (
          <div className={cn("rpt-body", report.loading && "is-loading")} aria-busy={report.loading}>
            {report.error && (
              <p className="rpt-warning">
                <AlertTriangle size={14} /> Could not refresh: {report.error}. Showing the last figures loaded.
              </p>
            )}
            <div className="rpt-summary">
              {data.summary.map((s) => (
                <div key={s.label} className="rpt-kpi">
                  <p className="rpt-kpi__label">{s.label}</p>
                  <p className={cn("rpt-kpi__value", negative(s.value, s.type) && "rpt-negative")}>
                    {typeof s.value === "number" ? formatValue(s.value, s.type) : s.value}
                  </p>
                  {s.hint && <p className="rpt-kpi__hint">{s.hint}</p>}
                </div>
              ))}
            </div>
            {data.truncated && (
              <p className="rpt-warning">
                <AlertTriangle size={14} /> Only the first 5,000 rows are included. Choose a shorter date range for the complete list.
              </p>
            )}
            <ReportTable key={data.key} report={data} />
            <footer className="rpt-foot">
              {data.note && (
                <p>
                  <Info size={13} aria-hidden /> {data.note}
                </p>
              )}
              <p className="text-gray-400">
                <Download size={12} aria-hidden /> Generated {formatDateTime(data.generatedAt)} · Excel and PDF use the same dates and include the summary.
              </p>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
