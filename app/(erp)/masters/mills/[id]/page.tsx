"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, Clock3, Download, Factory, IndianRupee, Mail, MapPin, Pencil, Phone, Scale } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { useApiQuery } from "@/lib/use-api-query";
import { EDIT_PARAM } from "@/lib/use-new-param";
import { cn, formatDate, kg, money, todayInput } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type Account = {
  mill: {
    id: string;
    code: string;
    name: string;
    contactPerson: string | null;
    mobile: string | null;
    alternateMobile: string | null;
    email: string | null;
    gst: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    paymentTerms: string | null;
    notes: string | null;
    active: boolean;
    createdAt: string;
  };
  jobs: Array<{
    batchId: string;
    flowNo: string;
    status: string;
    yarnCount: string;
    fabricType: string | null;
    color: string | null;
    process: string;
    startedAt: string | null;
    finishedAt: string | null;
    inKg: number | null;
    outKg: number | null;
    expense: number;
  }>;
};

const jobStatus = (job: Pick<Account["jobs"][number], "startedAt" | "finishedAt">) =>
  job.finishedAt ? "Completed" : job.startedAt ? "At the mill" : "Not started";

function Section({ icon: Icon, title, caption, action, children }: { icon: typeof Factory; title: string; caption?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="item-details-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="item-details-section__head">
          <span className="item-details-section__icon"><Icon size={14} /></span>
          <div>
            <h3 className="text-sm font-bold text-[#1b3c55]">{title}</h3>
            {caption && <p className="text-xs text-gray-500">{caption}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** `/masters/mills/<id>`: one outside mill — contact and billing details, and every production job it did. */
export default function MillPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApiQuery<Account>(`/masters/mills/${id}/account`);

  const summary = useMemo(() => {
    const jobs = data?.jobs ?? [];
    const done = jobs.filter((j) => j.finishedAt);
    const withBoth = done.filter((j) => j.inKg && j.outKg !== null);
    const inKg = withBoth.reduce((sum, j) => sum + (j.inKg ?? 0), 0);
    const outKg = withBoth.reduce((sum, j) => sum + (j.outKg ?? 0), 0);
    return {
      batches: new Set(jobs.map((j) => j.batchId)).size,
      atMill: jobs.filter((j) => j.startedAt && !j.finishedAt),
      doneKg: done.reduce((sum, j) => sum + (j.outKg ?? 0), 0),
      charges: jobs.reduce((sum, j) => sum + j.expense, 0),
      lossPct: inKg > 0 ? ((inKg - outKg) / inKg) * 100 : null,
    };
  }, [data]);

  const back = <Link href="/masters/mills" className="purchases-back-link"><ArrowLeft size={15} /> Mill Details</Link>;
  if (!data) {
    return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;
  }

  const { mill: m, jobs } = data;
  const place = [m.city, m.state].filter(Boolean).join(", ");
  const phone = (value: string) => <a href={`tel:${value}`} className="text-[#1b3c55] hover:underline">{value}</a>;

  const exportJobs = () =>
    downloadCsv(
      `${m.code}-jobs-${todayInput()}.csv`,
      ["Batch", "Fabric", "Colour", "Started", "Finished", "In KG", "Out KG", "Change KG", "Charges", "Job status"],
      jobs.map((j) => [
        j.flowNo,
        j.fabricType ?? j.yarnCount,
        j.color ?? "",
        j.startedAt?.slice(0, 10) ?? "",
        j.finishedAt?.slice(0, 10) ?? "",
        j.inKg?.toFixed(3) ?? "",
        j.outKg?.toFixed(3) ?? "",
        j.inKg !== null && j.outKg !== null ? (j.outKg - j.inKg).toFixed(3) : "",
        j.expense.toFixed(2),
        jobStatus(j),
      ]),
    );

  const details: Array<[string, React.ReactNode]> = [
    ["Contact person", m.contactPerson ?? "—"],
    ["Mobile", m.mobile ? phone(m.mobile) : "—"],
    ["Alternate mobile", m.alternateMobile ? phone(m.alternateMobile) : "—"],
    ["Email", m.email ? <a href={`mailto:${m.email}`} className="break-all text-[#1b3c55] hover:underline">{m.email}</a> : "—"],
    ["GSTIN", m.gst ? <span className="font-mono">{m.gst}</span> : "—"],
    ["Payment terms", m.paymentTerms ?? "—"],
    ["Added on", formatDate(m.createdAt)],
  ];

  return (
    <div className="inventory-list-page">
      {back}

      <div className="item-details-header flex-wrap">
        <span className="warehouses-page-icon"><Building2 size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            {m.name}
            <span className="font-mono text-sm font-semibold text-gray-500">{m.code}</span>
            <Badge tone={m.active ? "success" : "warning"}>{m.active ? "Active" : "Inactive"}</Badge>
          </h2>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            {place && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {place}</span>}
            {m.mobile && <span className="inline-flex items-center gap-1"><Phone size={12} /> {m.mobile}</span>}
            {m.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {m.email}</span>}
          </p>
        </div>
        <Button variant="outline" asChild><Link href={`/masters/mills?${EDIT_PARAM}=${m.id}`}><Pencil size={15} /> Edit</Link></Button>
      </div>

      {!m.active && <p className="warehouses-inactive-note">This mill is inactive: it can&apos;t be picked for new production work. Its past jobs stay below.</p>}

      <dl className="customer-account__figures mill-figures">
        {[
          { label: "Batches", value: String(summary.batches), note: jobs.length ? `${jobs.length} recorded job${jobs.length === 1 ? "" : "s"}` : "No jobs yet", icon: Factory },
          { label: "At the mill now", value: String(summary.atMill.length), note: summary.atMill.length ? summary.atMill.slice(0, 3).map((j) => j.flowNo).join(", ") : "Nothing in progress", icon: Clock3 },
          { label: "Fabric returned", value: kg(summary.doneKg), note: summary.lossPct === null ? "From finished jobs" : `${summary.lossPct >= 0 ? "Loss" : "Gain"} ${Math.abs(summary.lossPct).toFixed(1)}% on weight`, icon: Scale },
          { label: "Charges", value: money(summary.charges), note: summary.doneKg > 0 ? `${money(summary.charges / summary.doneKg)} per KG returned` : "Recorded on batches", icon: IndianRupee },
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section icon={Building2} title="Contact & billing">
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="erp-label">{label}</dt>
                <dd className="font-medium text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section icon={MapPin} title="Address & notes">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="erp-label">Address</dt>
              <dd className="whitespace-pre-line text-gray-800">{m.address || "—"}</dd>
            </div>
            <div>
              <dt className="erp-label">City / State</dt>
              <dd className="text-gray-800">{place || "—"}</dd>
            </div>
            <div>
              <dt className="erp-label">Notes</dt>
              <dd className="whitespace-pre-line text-gray-800">{m.notes || "—"}</dd>
            </div>
          </dl>
        </Section>
      </div>

      <Section
        icon={Factory}
        title={`Production jobs (${jobs.length})`}
        caption="Work recorded for this mill, newest first. Open a batch to see its details."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={jobs.length === 0} onClick={exportJobs}><Download size={14} /> Export CSV</Button>
          </div>
        }
      >
        {jobs.length === 0 ? (
          <div className="purchases-empty">
            {`No production batch names ${m.name} yet. It appears here once a batch picks this mill on the Production page.`}
          </div>
        ) : (
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Dates</th>
                  <th className="px-3 py-2 text-right">Sent</th>
                  <th className="px-3 py-2 text-right">Returned</th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">Charges</th>
                  <th className="px-3 py-2">Job status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const change = j.inKg !== null && j.outKg !== null ? j.outKg - j.inKg : null;
                  return (
                    <tr key={`${j.batchId}-${j.process}`}>
                      <td className="px-3 py-2">
                        <Link href={`/production?batch=${encodeURIComponent(j.flowNo)}`} className="customers-code">{j.flowNo}</Link>
                        <span className="mt-0.5 block text-xs text-gray-500">{[j.fabricType ?? j.yarnCount, j.color].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                        {formatDate(j.startedAt)}
                        <span className={cn("block", !j.finishedAt && j.startedAt && "font-semibold text-amber-700")}>
                          {j.finishedAt ? `→ ${formatDate(j.finishedAt)}` : j.startedAt ? "→ at the mill" : "Not started"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{j.inKg === null ? "—" : kg(j.inKg)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{j.outKg === null ? "—" : kg(j.outKg)}</td>
                      <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", change === null ? "text-gray-400" : change < -0.0005 ? "text-rose-700" : "text-emerald-700")}>
                        {change === null ? "—" : `${change >= 0 ? "+" : "−"}${kg(Math.abs(change))}`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{j.expense ? money(j.expense) : "—"}</td>
                      <td className="px-3 py-2"><Badge tone={j.finishedAt ? "success" : j.startedAt ? "info" : "default"}>{jobStatus(j)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="px-3 py-2.5 text-right font-bold">Total</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{kg(jobs.reduce((sum, j) => sum + (j.inKg ?? 0), 0))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums">{kg(jobs.reduce((sum, j) => sum + (j.outKg ?? 0), 0))}</td>
                  <td />
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums">{money(jobs.reduce((sum, j) => sum + j.expense, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
