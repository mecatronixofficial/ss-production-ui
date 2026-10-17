"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock3, Download, Factory, KeyRound, Pencil, Phone, Scale, UserCog } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { useApiQuery } from "@/lib/use-api-query";
import { EDIT_PARAM } from "@/lib/use-new-param";
import { cn, formatDate, humanize, kg, todayInput } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { machineHref, runHref, shiftText, type Shift } from "../../machines/types";

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
  runs: Array<{
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
    machine: { id: string; code: string; name: string };
  }>;
};

const shiftLabel = (shift: string) => (shift === "General" ? "General" : `Shift ${shift}`);

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

/** `/masters/employees/<id>`: one employee — work details, linked login, and the knitting runs they operated. */
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApiQuery<Account>(`/masters/employees/${id}/account`);
  const [filter, setFilter] = useState<"ALL" | "RUNNING" | "FINISHED">("ALL");

  const back = <Link href="/masters/employees" className="purchases-back-link"><ArrowLeft size={15} /> Employees</Link>;
  if (!data) {
    return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;
  }

  const { employee: e, runs } = data;
  const finished = runs.filter((r) => r.status === "FINISHED");
  const running = runs.filter((r) => r.status === "RUNNING");
  const fabricKg = finished.reduce((sum, r) => sum + (r.outputKg ?? 0), 0);
  const yarnKg = finished.reduce((sum, r) => sum + r.yarnKg, 0);
  const machines = [...new Map(runs.map((r) => [r.machine.id, r.machine])).values()];
  const visible = filter === "ALL" ? runs : runs.filter((r) => r.status === filter);
  const future = !!e.joiningDate && e.joiningDate.slice(0, 10) > todayInput();

  const exportRuns = () =>
    downloadCsv(
      `${e.code}-runs-${todayInput()}.csv`,
      ["Run", "Machine", "Fabric type", "Started", "Finished", "Yarn KG", "Fabric KG", "Rolls", "Status"],
      visible.map((r) => [
        r.runNo,
        r.machine.code,
        r.fabricType ?? "",
        shiftText(r.startedAt, r.startShift),
        r.finishedAt ? shiftText(r.finishedAt, r.finishShift) : "",
        r.yarnKg.toFixed(3),
        r.outputKg?.toFixed(3) ?? "",
        r.rollCount ?? "",
        r.status === "RUNNING" ? "Knitting" : "Finished",
      ]),
    );

  const details: Array<[string, React.ReactNode]> = [
    ["Employee code", <span key="code" className="font-mono">{e.code}</span>],
    ["Department", e.department],
    ["Shift", e.shift ? shiftLabel(e.shift) : "—"],
    ["Mobile", e.mobile ? <a key="tel" href={`tel:${e.mobile}`} className="text-[#1b3c55] hover:underline">{e.mobile}</a> : "—"],
    ["Joining date", e.joiningDate ? formatDate(e.joiningDate) : "—"],
    ["With us for", e.joiningDate ? (future ? "Joins on that date" : serviceLength(e.joiningDate)) : "—"],
    ["Added on", formatDate(e.createdAt)],
    ["Status", e.active ? "Active" : "Inactive"],
  ];

  return (
    <div className="inventory-list-page">
      {back}

      <div className="item-details-header flex-wrap">
        <span className="warehouses-page-icon"><UserCog size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            {e.name}
            <span className="font-mono text-sm font-semibold text-gray-500">{e.code}</span>
            <Badge tone={e.active ? "success" : "warning"}>{e.active ? "Active" : "Inactive"}</Badge>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <Badge tone="info">{e.department}</Badge>
            {e.shift && <span className="inline-flex items-center gap-1"><Clock3 size={12} /> {shiftLabel(e.shift)}</span>}
            {e.mobile && <span className="inline-flex items-center gap-1"><Phone size={12} /> {e.mobile}</span>}
            {e.joiningDate && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> Joined {formatDate(e.joiningDate)}</span>}
          </p>
        </div>
        <Button variant="outline" asChild><Link href={`/masters/employees?${EDIT_PARAM}=${e.id}`}><Pencil size={15} /> Edit</Link></Button>
      </div>

      {!e.active && <p className="warehouses-inactive-note">This employee is inactive: they can&apos;t be picked as a machine operator. Their past runs stay below.</p>}

      <dl className="customer-account__figures mill-figures">
        {[
          { label: "Runs operated", value: String(runs.length), note: runs.length ? `${finished.length} finished${running.length ? ` · ${running.length} knitting` : ""}` : "None yet", icon: Factory },
          { label: "Fabric knitted", value: kg(fabricKg), note: yarnKg > 0 ? `from ${kg(yarnKg)} of yarn` : "From finished runs", icon: Scale },
          { label: "Machines", value: String(machines.length), note: machines.length ? machines.slice(0, 4).map((m) => m.code).join(", ") : "None yet", icon: Factory },
          { label: "With us for", value: e.joiningDate && !future ? serviceLength(e.joiningDate) : "—", note: e.joiningDate ? `Joined ${formatDate(e.joiningDate)}` : "No joining date", icon: CalendarDays },
        ].map(({ label, value, note, icon: Icon }) => (
          <div key={label} className="customer-account__figure">
            <span className="customer-account__icon"><Icon size={15} aria-hidden /></span>
            <div className="min-w-0">
              <dt>{label}</dt>
              <dd className="truncate">{value}</dd>
              <p className="truncate">{note}</p>
            </div>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="item-details-section">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><UserCog size={14} /></span>
            <h3 className="text-sm font-bold text-[#1b3c55]">Work details</h3>
          </div>
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="erp-label">{label}</dt>
                <dd className="font-medium text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="item-details-section">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><KeyRound size={14} /></span>
            <div>
              <h3 className="text-sm font-bold text-[#1b3c55]">Login</h3>
              <p className="text-xs text-gray-500">The ERP account linked to this employee.</p>
            </div>
          </div>
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
            <div className="purchases-empty">
              Not linked to a login. To let {e.name.split(" ")[0]} sign in, create or link a user in{" "}
              <Link href="/admin/users" className="font-semibold text-[#1b3c55] hover:underline">Users</Link>.
            </div>
          )}
        </section>
      </div>

      <section className="item-details-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><Factory size={14} /></span>
            <div>
              <h3 className="text-sm font-bold text-[#1b3c55]">Machine runs ({runs.length})</h3>
              <p className="text-xs text-gray-500">Knitting runs this employee operated, newest first.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="purchases-filters" role="tablist" aria-label="Show runs">
              {(["ALL", "RUNNING", "FINISHED"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={cn(filter === value && "is-active")} onClick={() => setFilter(value)}>
                  {value === "ALL" ? "All" : value === "RUNNING" ? "Knitting" : "Finished"} <span>{value === "ALL" ? runs.length : runs.filter((r) => r.status === value).length}</span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={visible.length === 0} onClick={exportRuns}><Download size={14} /> Export CSV</Button>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="purchases-empty">{runs.length ? "No runs with this status." : "No machine runs yet. They appear here when this employee is picked as the operator on a run."}</div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><th className="px-3 py-2">Run</th><th className="px-3 py-2">Machine</th><th className="px-3 py-2">Shifts</th><th className="px-3 py-2 text-right">Yarn</th><th className="px-3 py-2 text-right">Fabric</th><th className="px-3 py-2 text-right">Rolls</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <Link href={runHref(r.runNo)} className="customers-code">{r.runNo}</Link>
                      {r.fabricType && <span className="mt-0.5 block text-xs text-gray-500">{r.fabricType}</span>}
                    </td>
                    <td className="px-3 py-2"><Link href={machineHref(r.machine.id)} className="font-semibold text-[#1b3c55] hover:underline">{r.machine.code}</Link><span className="block text-xs text-gray-500">{r.machine.name}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{shiftText(r.startedAt, r.startShift)}<span className="block">{r.finishedAt ? `→ ${shiftText(r.finishedAt, r.finishShift)}` : "→ knitting"}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{kg(r.yarnKg)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{r.outputKg === null ? "—" : kg(r.outputKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.rollCount ?? "—"}</td>
                    <td className="px-3 py-2"><Badge tone={r.status === "RUNNING" ? "warning" : "success"}>{r.status === "RUNNING" ? "Knitting" : "Finished"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
