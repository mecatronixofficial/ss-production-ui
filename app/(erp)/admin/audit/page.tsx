"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { apiDownload } from "@/lib/api";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type Json = unknown;
type AuditRow = {
  id: string;
  action: string;
  module: string;
  entity: string;
  entityId: string | null;
  previousValue: Json;
  newValue: Json;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};
type AuditPage = { items: AuditRow[]; total: number; page: number; pageSize: number };
type Summary = {
  counts: { total: number; today: number; last7Days: number; security: number };
  modules: Array<{ module: string; count: number }>;
  actions: string[];
  actors: Array<{ id: string; name: string; email: string }>;
  hasSystemEvents: boolean;
};
type RangePreset = "all" | "today" | "7d" | "30d" | "custom";

const PAGE_SIZE = 25;

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};
const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};
/** `yyyy-mm-dd` from a date input, read as local midnight. */
const fromInput = (value: string) => (value ? new Date(`${value}T00:00:00`) : undefined);

function rangeFor(preset: RangePreset, customFrom: string, customTo: string): { from?: Date; to?: Date } {
  const today = startOfDay(new Date());
  if (preset === "today") return { from: today };
  if (preset === "7d") return { from: addDays(today, -6) };
  if (preset === "30d") return { from: addDays(today, -29) };
  if (preset === "custom") {
    const to = fromInput(customTo);
    return { from: fromInput(customFrom), to: to ? addDays(to, 1) : undefined };
  }
  return {};
}

const sentence = (value: string) => {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const actionTone = (action: string): BadgeTone => {
  if (/DELETE|CANCEL|REJECT|REVOKE|FAIL/.test(action)) return "danger";
  if (/PASSWORD|RESET|ROLE|STATUS/.test(action)) return "warning";
  if (/CREATE|CONFIRM|APPROVE|RECEIV|DELIVER/.test(action)) return "success";
  if (/UPDATE|EDIT|SAVE|CHANGE/.test(action)) return "info";
  return "default";
};

const REFERENCE_KEYS = ["orderNo", "poNo", "productionNo", "invoiceNo", "dispatchNo", "flowNo", "receiptNo", "code", "name", "email", "key"];
/** A human reference (order number, name…) taken from the recorded values, if there is one. */
function referenceOf(row: AuditRow) {
  for (const source of [row.newValue, row.previousValue]) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const key of REFERENCE_KEYS) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return null;
}

/** Where an event's record can be opened, when that page exists and the record may still exist. */
function linkFor(row: AuditRow) {
  if (!row.entityId || /DELETE/.test(row.action)) return null;
  if (row.entity === "User") return { href: "/admin/users", label: "Users" };
  if (row.entity === "SystemSetting") return { href: "/settings", label: "Settings" };
  if (row.entity === "FabricProductionFlow") return { href: "/production", label: "Production" };
  return null;
}

const display = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

/** Field-by-field comparison of the recorded before/after values. */
function diffRows(before: Json, after: Json) {
  const isObject = (v: Json): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObject(before) && !isObject(after)) {
    if (before == null && after == null) return [];
    return [{ field: "Value", before: display(before), after: display(after), changed: true }];
  }
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].map((field) => {
    const bv = display(b[field]);
    const av = display(a[field]);
    return { field: sentence(field.replace(/([a-z])([A-Z])/g, "$1_$2")), before: bv, after: av, changed: bv !== av };
  });
}

function describeDevice(ua: string | null) {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /node|undici|curl/i.test(ua) ? "API client" : "Browser";
  const os = /Windows/.test(ua) ? " on Windows" : /Android/.test(ua) ? " on Android" : /iPhone|iPad/.test(ua) ? " on iOS" : /Mac OS X/.test(ua) ? " on macOS" : /Linux/.test(ua) ? " on Linux" : "";
  return browser + os;
}

const dayLabel = (iso: string) => {
  const day = startOfDay(new Date(iso)).getTime();
  const today = startOfDay(new Date()).getTime();
  if (day === today) return "Today";
  if (day === addDays(new Date(today), -1).getTime()) return "Yesterday";
  return formatDate(iso);
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const initials = (name?: string) =>
  (name ?? "System")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

function EventDetails({ row }: { row: AuditRow }) {
  const rows = diffRows(row.previousValue, row.newValue);
  const hasBefore = row.previousValue != null;
  const link = linkFor(row);
  const device = describeDevice(row.userAgent);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(row.entityId ?? "");
      toast.success("Record ID copied.");
    } catch {
      toast.error("Couldn’t copy to the clipboard.");
    }
  };

  return (
    <div className="audit-event__details">
      {rows.length > 0 ? (
        <div className="audit-diff">
          <table>
            <thead>
              <tr>
                <th scope="col">Field</th>
                {hasBefore && <th scope="col">Before</th>}
                <th scope="col">{hasBefore ? "After" : "Recorded value"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field} className={cn(hasBefore && r.changed && "is-changed")}>
                  <th scope="row">{r.field}</th>
                  {hasBefore && <td className="audit-diff__before">{r.before}</td>}
                  <td className="audit-diff__after">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-500">No field values were recorded for this event.</p>
      )}
      <dl className="audit-meta">
        <div>
          <dt>When</dt>
          <dd>{formatDateTime(row.createdAt)}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd className="flex items-center gap-1.5">
            <span>{row.entity}</span>
            {row.entityId && (
              <button type="button" className="audit-copy" onClick={() => void copyId()} title={row.entityId} aria-label="Copy record ID">
                <Copy size={12} /> ID
              </button>
            )}
          </dd>
        </div>
        {row.ipAddress && (
          <div>
            <dt>IP address</dt>
            <dd className="font-mono">{row.ipAddress}</dd>
          </div>
        )}
        {device && (
          <div>
            <dt>Device</dt>
            <dd>{device}</dd>
          </div>
        )}
      </dl>
      {link && (
        <Link href={link.href} className="audit-open-link">
          {link.label} <ExternalLink size={12} />
        </Link>
      )}
    </div>
  );
}

export default function Audit() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [preset, setPreset] = useState<RangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  // Any filter change starts again from the first page.
  useEffect(() => setPage(1), [query, moduleFilter, action, actorId, preset, customFrom, customTo]);

  const filterParams = useMemo(() => {
    const { from, to } = rangeFor(preset, customFrom, customTo);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (moduleFilter) params.set("module", moduleFilter);
    if (action) params.set("action", action);
    if (actorId) params.set("actorId", actorId);
    if (from) params.set("from", from.toISOString());
    if (to) params.set("to", to.toISOString());
    return params;
  }, [query, moduleFilter, action, actorId, preset, customFrom, customTo]);

  const summaryPath = useMemo(() => {
    const today = startOfDay(new Date());
    return `/admin/audit-logs/summary?todayStart=${today.toISOString()}&weekStart=${addDays(today, -6).toISOString()}`;
  }, []);
  const listPath = `/admin/audit-logs?${new URLSearchParams([...filterParams, ["page", String(page)], ["pageSize", String(PAGE_SIZE)]])}`;

  const summary = useApiQuery<Summary>(summaryPath);
  const list = useApiQuery<AuditPage>(listPath);

  const groups = useMemo(() => {
    const out: Array<{ day: string; rows: AuditRow[] }> = [];
    for (const row of list.data?.items ?? []) {
      const day = dayLabel(row.createdAt);
      if (out.at(-1)?.day === day) out.at(-1)!.rows.push(row);
      else out.push({ day, rows: [row] });
    }
    return out;
  }, [list.data]);

  const filtersActive = Boolean(search || moduleFilter || action || actorId || preset !== "all");
  const clearFilters = () => {
    setSearch("");
    setModuleFilter("");
    setAction("");
    setActorId("");
    setPreset("all");
    setCustomFrom("");
    setCustomTo("");
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await apiDownload(`/admin/audit-logs/export?${filterParams}`, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      // api() already shows the error.
    } finally {
      setExporting(false);
    }
  };

  if (!list.data && list.error) return <ErrorState message={list.error} onRetry={() => void list.reload()} />;
  if (!list.data) return <Loading />;

  const { total } = list.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(page * PAGE_SIZE, total);
  const counts = summary.data?.counts;
  const tiles = [
    { cls: "total", label: "All events", value: counts?.total, icon: History, onClick: () => clearFilters() },
    { cls: "today", label: "Today", value: counts?.today, icon: CalendarClock, onClick: () => setPreset("today") },
    { cls: "actors", label: "Last 7 days", value: counts?.last7Days, icon: CalendarRange, onClick: () => setPreset("7d") },
    { cls: "modules", label: "Security events", value: counts?.security, icon: ShieldCheck, onClick: undefined },
  ];

  return (
    <div className="audit-page">
      <div className="audit-page-header">
        <span className="audit-page-icon">
          <History size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold md:text-xl">Audit Logs</h2>
          <p className="text-xs text-gray-500">Who changed what, and when — with the values before and after.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void list.reload();
              void summary.reload();
            }}
            disabled={list.loading}
          >
            <RefreshCw size={14} className={cn(list.loading && "animate-spin")} /> Refresh
          </Button>
          <Button size="sm" onClick={() => void exportCsv()} disabled={exporting || total === 0}>
            <Download size={14} /> {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      <div className="audit-stats grid gap-2.5 grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ cls, label, value, icon: Icon, onClick }) => {
          const body = (
            <>
              <div className="audit-stat-icon">
                <Icon size={15} />
              </div>
              <div>
                <p className="audit-stat-label">{label}</p>
                <p className="audit-stat-value">{value ?? "—"}</p>
              </div>
            </>
          );
          return onClick ? (
            <button key={cls} type="button" onClick={onClick} className={`audit-stat-tile audit-stat-tile--${cls} text-left`}>
              {body}
            </button>
          ) : (
            <div key={cls} className={`audit-stat-tile audit-stat-tile--${cls}`}>
              {body}
            </div>
          );
        })}
      </div>

      <section className="audit-filters" aria-label="Filter audit events">
        <label className="audit-search">
          <Search size={16} className="text-gray-400" aria-hidden />
          <Input placeholder="Search user, action, record, IP..." aria-label="Search audit log" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="erp-input" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label="Filter by module">
          <option value="">All modules</option>
          {summary.data?.modules.map((m) => (
            <option key={m.module} value={m.module}>
              {sentence(m.module)} ({m.count})
            </option>
          ))}
        </select>
        <select className="erp-input" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
          <option value="">All actions</option>
          {summary.data?.actions.map((a) => (
            <option key={a} value={a}>
              {sentence(a)}
            </option>
          ))}
        </select>
        <select className="erp-input" value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label="Filter by user">
          <option value="">All users</option>
          {summary.data?.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {summary.data?.hasSystemEvents && <option value="system">System</option>}
        </select>
        <select className="erp-input" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} aria-label="Date range">
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range…</option>
        </select>
        {preset === "custom" && (
          <div className="audit-range">
            <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" />
            <span className="text-xs text-gray-400">to</span>
            <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" />
          </div>
        )}
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X size={14} /> Clear
          </Button>
        )}
      </section>

      <section className={cn("audit-timeline", list.loading && "is-loading")} aria-busy={list.loading}>
        <p className="audit-count">
          {total === 0 ? "No events" : `Showing ${firstShown}–${lastShown} of ${total} event${total === 1 ? "" : "s"}`}
        </p>
        {groups.map((group) => (
          <Fragment key={group.day}>
            <h3 className="audit-day">{group.day}</h3>
            <ol className="audit-events">
              {group.rows.map((row) => {
                const expanded = open === row.id;
                const reference = referenceOf(row);
                return (
                  <li key={row.id} className={cn("audit-event", expanded && "is-open")}>
                    <button
                      type="button"
                      className="audit-event__row"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                    >
                      <span className="audit-event__time">{timeOf(row.createdAt)}</span>
                      <span className={cn("audit-event__avatar", !row.actor && "is-system")} aria-hidden>
                        {initials(row.actor?.name)}
                      </span>
                      <span className="audit-event__main">
                        <span className="audit-event__line">
                          <strong>{row.actor?.name ?? "System"}</strong>
                          <Badge tone={actionTone(row.action)}>{sentence(row.action)}</Badge>
                        </span>
                        <span className="audit-event__sub">
                          {row.entity}
                          {reference && <b> · {reference}</b>}
                          <span className="audit-event__module">{row.module}</span>
                        </span>
                      </span>
                      <ChevronDown size={16} className="audit-event__chevron" aria-hidden />
                    </button>
                    {expanded && <EventDetails row={row} />}
                  </li>
                );
              })}
            </ol>
          </Fragment>
        ))}
        {total === 0 && (
          <div className="audit-empty">
            <History size={26} />
            <p>{filtersActive ? "No events match these filters." : "No audit events have been recorded yet."}</p>
            {filtersActive && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
        {pages > 1 && (
          <nav className="audit-pager" aria-label="Audit log pages">
            <Button variant="outline" size="sm" disabled={page <= 1 || list.loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={14} /> Newer
            </Button>
            <span className="text-xs text-gray-500">
              Page {page} of {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages || list.loading} onClick={() => setPage((p) => p + 1)}>
              Older <ChevronRight size={14} />
            </Button>
          </nav>
        )}
      </section>
    </div>
  );
}
