"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CircleCheck, Download, Droplets, Factory, Layers, Shrink, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { GSTIN_PATTERN, INDIAN_STATES, stateForGstin } from "@/lib/india";
import { todayInput } from "@/lib/utils";
import { MasterCrud, type MasterField, type MasterProblem } from "@/components/master-crud";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Mill = { id: string; code: string; name: string; services: string; contactPerson: string | null; mobile: string | null; alternateMobile: string | null; email: string | null; gst: string | null; address: string | null; city: string | null; state: string | null; paymentTerms: string | null; notes: string | null; active: boolean };

// Keep in sync with SERVICES in backend/src/masters/dto/mill.dto.ts.
const serviceOptions = ["KNITTING", "DYEING", "COMPACTING", "KNITTING,DYEING", "KNITTING,COMPACTING", "DYEING,COMPACTING", "KNITTING,DYEING,COMPACTING"] as const;
const PROCESSES = ["KNITTING", "DYEING", "COMPACTING"] as const;
const processTone: Record<string, BadgeTone> = { KNITTING: "info", DYEING: "warning", COMPACTING: "success" };
const titleCase = (value: string) => value[0] + value.slice(1).toLowerCase();
const processesOf = (services: string) => services.split(",").filter(Boolean);
const labelServices = (services: string) => processesOf(services).map(titleCase).join(" + ");

const blank = { code: "PC-", name: "", services: "KNITTING", contactPerson: "", mobile: "", alternateMobile: "", email: "", gst: "", address: "", city: "", state: "Tamil Nadu", paymentTerms: "", notes: "" };
type Form = typeof blank;

const fields: MasterField<Form>[] = [
  { key: "name", label: "Mill name", required: true, placeholder: "e.g. Sri Murugan Dyeing Mill", wide: true, maxLength: 160, section: "Mill" },
  { key: "code", label: "Mill code", required: true, placeholder: "PC-001", hint: "Suggested", maxLength: 23, uppercase: true, section: "Mill" },
  { key: "services", label: "Processes handled", type: "select", options: serviceOptions, optionLabel: labelServices, required: true, section: "Mill" },
  { key: "contactPerson", label: "Contact person", maxLength: 120, section: "Contact" },
  { key: "email", label: "Email", type: "email", maxLength: 160, section: "Contact" },
  { key: "mobile", label: "Mobile", type: "tel", placeholder: "98765 43210", maxLength: 30, section: "Contact" },
  { key: "alternateMobile", label: "Alternate mobile", type: "tel", hint: "Optional", maxLength: 30, section: "Contact" },
  { key: "address", label: "Address", wide: true, maxLength: 500, section: "Address & billing" },
  { key: "city", label: "City", maxLength: 100, section: "Address & billing" },
  { key: "state", label: "State", type: "select", options: INDIAN_STATES.map((s) => s.name), section: "Address & billing" },
  {
    key: "gst",
    label: "GSTIN",
    placeholder: "33ABCDE1234F1Z5",
    hint: "Fills the state",
    maxLength: 15,
    uppercase: true,
    section: "Address & billing",
    fills: (gst, form) => (GSTIN_PATTERN.test(gst) && !form.state ? { state: stateForGstin(gst) ?? "" } : undefined),
  },
  { key: "paymentTerms", label: "Payment terms", placeholder: "e.g. 30 Days", maxLength: 100, section: "Address & billing" },
  { key: "notes", label: "Notes", wide: true, hint: "Optional", maxLength: 1000, section: "Address & billing" },
];

// Same rule as MillDto: PC- then letters, numbers or dashes.
const CODE = /^PC-[A-Z0-9-]{1,20}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;

/** Mirrors the API (MillDto, and its unique code and name) so problems show on the field before saving. */
function validate(f: Form, { rows, editingId }: { rows: Mill[]; editingId: string | null }): MasterProblem<Form> {
  const code = f.code.trim().toUpperCase();
  if (!CODE.test(code)) return { key: "code", text: "Mill code must start with PC-, e.g. PC-004." };
  const others = rows.filter((row) => row.id !== editingId);
  const sameCode = others.find((row) => row.code.toUpperCase() === code);
  if (sameCode) return { key: "code", text: `${code} is already used by ${sameCode.name}.` };
  const sameName = others.find((row) => row.name.trim().toLowerCase() === f.name.trim().toLowerCase());
  if (sameName) return { key: "name", text: `A mill named ${sameName.name} already exists (${sameName.code}).` };
  if (f.mobile.trim() && !PHONE.test(f.mobile.trim())) return { key: "mobile", text: "Enter a valid phone number, e.g. 98765 43210." };
  if (f.alternateMobile.trim() && !PHONE.test(f.alternateMobile.trim())) return { key: "alternateMobile", text: "Enter a valid phone number." };
  if (f.gst.trim() && !GSTIN_PATTERN.test(f.gst.trim())) return { key: "gst", text: "Enter a valid 15-character GSTIN, e.g. 33ABCDE1234F1Z5." };
  return null;
}

/** The mills shown, as a CSV for Excel. */
const exportMills = (rows: Mill[]) =>
  downloadCsv(
    `mills-${todayInput()}.csv`,
    ["Code", "Mill", "Processes", "Contact person", "Mobile", "Alternate mobile", "Email", "GSTIN", "Address", "City", "State", "Payment terms", "Status"],
    rows.map((r) => [r.code, r.name, labelServices(r.services), r.contactPerson, r.mobile, r.alternateMobile, r.email, r.gst, r.address, r.city, r.state, r.paymentTerms, r.active ? "Active" : "Inactive"]),
  );

const text = (value: unknown) => (value == null ? "" : String(value));

const toForm = (row: Mill): Form => ({
  code: row.code,
  name: row.name,
  services: row.services,
  contactPerson: text(row.contactPerson),
  mobile: text(row.mobile),
  alternateMobile: text(row.alternateMobile),
  email: text(row.email),
  gst: text(row.gst),
  address: text(row.address),
  city: text(row.city),
  state: text(row.state),
  paymentTerms: text(row.paymentTerms),
  notes: text(row.notes),
});

const columns: ColumnDef<Mill>[] = [
  {
    header: "Code",
    accessorKey: "code",
    cell: ({ row }) => (
      <Link href={`/masters/mills/${row.original.id}`} className="customers-code" title="Open this mill's details and jobs">
        {row.original.code}
      </Link>
    ),
  },
  {
    header: "Mill",
    id: "name",
    // GSTIN is searchable too, though not shown.
    accessorFn: (row) => `${row.name} ${row.gst ?? ""}`,
    cell: ({ row }) => (
      <Link href={`/masters/mills/${row.original.id}`} className="font-semibold hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    header: "Processes",
    id: "services",
    accessorFn: (row) => labelServices(row.services),
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {processesOf(row.original.services).map((process) => (
          <Badge key={process} tone={processTone[process] ?? "default"}>{titleCase(process)}</Badge>
        ))}
      </div>
    ),
  },
  {
    header: "Contact",
    id: "contact",
    accessorFn: (row) => [row.contactPerson, row.mobile, row.alternateMobile].filter(Boolean).join(" "),
    cell: ({ row }) => {
      const { contactPerson, mobile } = row.original;
      if (!contactPerson && !mobile) return "—";
      return (
        <div className="leading-tight">
          <div>{contactPerson || "—"}</div>
          {mobile && <div className="text-xs text-gray-500">{mobile}</div>}
        </div>
      );
    },
  },
  { header: "Location", accessorFn: (row) => [row.city, row.state].filter(Boolean).join(", ") || "—" },
  { header: "Terms", accessorFn: (row) => row.paymentTerms || "—" },
  {
    header: "Status",
    id: "status",
    accessorFn: (row) => (row.active ? "Active" : "Inactive"),
    cell: ({ row }) => <Badge tone={row.original.active ? "success" : "warning"}>{row.original.active ? "Active" : "Inactive"}</Badge>,
  },
];

const describe = (row: Mill) => row.name;

/** Suggests the next free PC- code; it stays editable and the server re-checks it on save. */
const loadDefaults = () => api<{ code: string }>("/masters/mills/next-code", { silent: true }).then(({ code }) => ({ code }));

const tileIcons: Record<string, { icon: LucideIcon; className: string }> = {
  total: { icon: Factory, className: "bg-[#1b3c55] text-[#f1cf7b]" },
  active: { icon: CircleCheck, className: "bg-emerald-600 text-white" },
  KNITTING: { icon: Layers, className: "bg-blue-600 text-white" },
  DYEING: { icon: Droplets, className: "bg-amber-500 text-white" },
  COMPACTING: { icon: Shrink, className: "bg-teal-600 text-white" },
};

function Summary({ rows }: { rows: Mill[] }) {
  const active = rows.filter((row) => row.active);
  const tiles = [
    { key: "total", label: "Mills", value: rows.length, hint: `${rows.length - active.length} inactive` },
    { key: "active", label: "Active", value: active.length, hint: "Selectable in Production" },
    ...PROCESSES.map((process) => ({
      key: process,
      label: titleCase(process),
      value: active.filter((row) => processesOf(row.services).includes(process)).length,
      hint: "Active mills",
    })),
  ];
  return (
    <div className="mills-stats grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map(({ key, label, value, hint }) => {
        const { icon: Icon, className } = tileIcons[key];
        return (
          <div key={key} className="mills-stat-tile">
            <div className={`mills-stat-icon ${className}`}>
              <Icon size={15} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="mills-stat-label">{label}</div>
              <div className="mills-stat-value">{value}</div>
              <div className="mills-stat-hint truncate">{hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MillsPage() {
  return (
    <MasterCrud<Mill, Form>
      prefix="mills"
      title="Mill Details"
      description="Outside knitting, dyeing and compacting mills available in Production."
      entity="Mill"
      endpoint="/masters/mills"
      fields={fields}
      blank={blank}
      toForm={toForm}
      columns={columns}
      describe={describe}
      loadDefaults={loadDefaults}
      summary={(rows) => <Summary rows={rows} />}
      dialog={{ icon: Building2, caption: "Outside mill for knitting, dyeing or compacting. Active mills appear in Production." }}
      activeField="active"
      activeHint="Inactive mills cannot be selected for new production work."
      searchPlaceholder="Search mill, code, process, GSTIN or contact..."
      validate={validate}
      headerActions={(rows) => (
        <Button variant="outline" disabled={rows.length === 0} onClick={() => exportMills(rows)} title="Download the mills shown">
          <Download size={15} /> Export
        </Button>
      )}
    />
  );
}
