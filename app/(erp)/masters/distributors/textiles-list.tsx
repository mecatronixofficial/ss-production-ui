"use client";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CircleCheck, Download, FileCheck2, HandCoins, Shirt, Store, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { GSTIN_PATTERN } from "@/lib/india";
import { MasterCrud, type MasterField, type MasterProblem } from "@/components/master-crud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, money, todayInput, toNumber } from "@/lib/utils";

/** A textile the business sells to, with its bills, money received and balance (as `/masters/textiles` returns). */
export type Textile = {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  mobile: string | null;
  email: string | null;
  gst: string | null;
  address: string | null;
  city: string | null;
  paymentTerms: string | null;
  creditLimit: number | null;
  openingBalance: number;
  notes: string | null;
  active: boolean;
  billed: number;
  bills: number;
  received: number;
  chequesPending: number;
  lastSaleAt: string | null;
  lastPaidAt: string | null;
  /** What they owe now: opening + billed − received + refunds. Negative is an advance they paid. */
  balance: number;
};

const TERMS = ["Advance", "Immediate", "7 Days", "15 Days", "30 Days", "45 Days", "60 Days", "90 Days"] as const;

const blank = {
  code: "",
  name: "",
  contactPerson: "",
  mobile: "",
  email: "",
  gst: "",
  city: "",
  address: "",
  paymentTerms: "30 Days",
  creditLimit: "",
  openingBalance: "",
  notes: "",
};
type Form = typeof blank;

const fields: MasterField<Form>[] = [
  { key: "name", label: "Textile name", required: true, wide: true, maxLength: 160, section: "Textile" },
  { key: "code", label: "Code", required: true, generated: true, placeholder: "Auto-generated on save", maxLength: 30, uppercase: true, section: "Textile" },
  { key: "city", label: "City / town", hint: "Optional", maxLength: 80, section: "Textile" },
  { key: "contactPerson", label: "Contact person", maxLength: 120, section: "Contact" },
  { key: "mobile", label: "Mobile", type: "tel", placeholder: "98765 43210", maxLength: 30, section: "Contact" },
  { key: "email", label: "Email", type: "email", wide: true, maxLength: 160, section: "Contact" },
  { key: "gst", label: "GSTIN", placeholder: "33ABCDE1234F1Z5", maxLength: 15, uppercase: true, section: "Billing" },
  { key: "paymentTerms", label: "Payment terms", type: "select", options: TERMS, section: "Billing" },
  { key: "creditLimit", label: "Credit limit (₹)", type: "number", placeholder: "0.00", hint: "Optional", section: "Billing" },
  { key: "openingBalance", label: "Opening balance (₹)", type: "number", placeholder: "0.00", hint: "They owed at start; minus for advance", section: "Billing" },
  { key: "address", label: "Billing address", wide: true, maxLength: 500, section: "Billing" },
  { key: "notes", label: "Notes", wide: true, maxLength: 500, hint: "Optional", section: "Billing" },
];

const CODE = /^[A-Z0-9][A-Z0-9-]{0,29}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const decimals = (value: string) => (value.split(".")[1] ?? "").length;
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Mirrors the API (TextileDto, unique code and name) so problems show on the field before saving. */
function validate(f: Form, { rows, editingId }: { rows: Textile[]; editingId: string | null }): MasterProblem<Form> {
  const sameName = rows.find((row) => row.id !== editingId && nameKey(row.name) === nameKey(f.name));
  if (sameName) return { key: "name", text: `${sameName.code} · ${sameName.name} already has this name${sameName.active ? "" : " (inactive)"}.` };
  if (editingId) {
    const code = f.code.trim().toUpperCase();
    if (!CODE.test(code)) return { key: "code", text: "Code can use letters, numbers and dashes only (max 30), e.g. TXT-00012." };
    const taken = rows.find((row) => row.id !== editingId && row.code.toUpperCase() === code);
    if (taken) return { key: "code", text: `${code} is already used by ${taken.name}.` };
  }
  if (f.mobile.trim() && !PHONE.test(f.mobile.trim())) return { key: "mobile", text: "Enter a valid phone number, e.g. 98765 43210." };
  if (f.gst.trim() && !GSTIN_PATTERN.test(f.gst.trim())) return { key: "gst", text: "Enter a valid 15-character GSTIN, e.g. 33ABCDE1234F1Z5." };
  for (const key of ["creditLimit", "openingBalance"] as const) {
    const value = f[key].trim();
    if (value && Math.abs(Number(value)) > 1e11) return { key, text: "The amount is too large." };
    if (value && decimals(value) > 2) return { key, text: "Amounts can have at most 2 decimals." };
  }
  if (f.creditLimit.trim() && Number(f.creditLimit) < 0) return { key: "creditLimit", text: "Credit limit can't be negative." };
  return null;
}

const s = (value: unknown) => (value == null ? "" : String(value));
const toForm = (row: Textile): Form => ({
  code: row.code,
  name: row.name,
  contactPerson: s(row.contactPerson),
  mobile: s(row.mobile),
  email: s(row.email),
  gst: s(row.gst),
  city: s(row.city),
  address: s(row.address),
  paymentTerms: s(row.paymentTerms),
  creditLimit: row.creditLimit ? String(row.creditLimit) : "",
  openingBalance: toNumber(row.openingBalance) ? String(toNumber(row.openingBalance)) : "",
  notes: s(row.notes),
});

const overLimit = (row: Textile) => row.creditLimit !== null && row.creditLimit > 0 && row.balance > row.creditLimit + 0.005;

const columns: ColumnDef<Textile>[] = [
  {
    header: "Code",
    accessorKey: "code",
    cell: ({ row }) => (
      <Link href={`/masters/textiles/${row.original.id}`} className="customers-code" title="Open this textile's account">
        {row.original.code}
      </Link>
    ),
  },
  {
    header: "Textile",
    id: "textile",
    accessorFn: (r) => `${r.name} ${r.city ?? ""} ${r.gst ?? ""}`,
    cell: ({ row }) => (
      <div className="leading-tight">
        <Link href={`/masters/textiles/${row.original.id}`} className="font-semibold hover:underline">{row.original.name}</Link>
        {(row.original.city || row.original.gst) && <div className="text-xs text-gray-500">{[row.original.city, row.original.gst].filter(Boolean).join(" · ")}</div>}
      </div>
    ),
  },
  {
    header: "Contact",
    id: "contact",
    accessorFn: (r) => [r.contactPerson, r.mobile, r.email].filter(Boolean).join(" "),
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
  { header: "Terms", accessorFn: (r) => r.paymentTerms || "—" },
  {
    header: "Billed",
    id: "billed",
    meta: { align: "right" },
    accessorFn: (r) => r.billed,
    cell: ({ row }) => (
      <div className="leading-tight">
        <div>{money(row.original.billed)}</div>
        <div className="text-xs text-gray-500">{row.original.bills} bill{row.original.bills === 1 ? "" : "s"}{row.original.lastSaleAt ? ` · last ${formatDate(row.original.lastSaleAt)}` : ""}</div>
      </div>
    ),
  },
  {
    header: "Balance",
    id: "balance",
    meta: { align: "right" },
    accessorFn: (r) => r.balance,
    cell: ({ row }) => {
      const { balance, chequesPending } = row.original;
      return (
        <div className="leading-tight">
          {Math.abs(balance) < 0.005 ? (
            <span className="text-gray-400">Settled</span>
          ) : (
            <span className={balance > 0 ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"} title={balance > 0 ? "They owe you" : "Advance they paid"}>
              {money(Math.abs(balance))}
              <span className="ml-1 text-[10px] font-bold uppercase">{balance > 0 ? "Due" : "Adv"}</span>
            </span>
          )}
          {chequesPending > 0 && <div className="text-[11px] text-blue-700">{money(chequesPending)} cheque to clear</div>}
          {overLimit(row.original) && <div className="text-[11px] font-semibold text-red-600">Over limit {money(row.original.creditLimit)}</div>}
        </div>
      );
    },
  },
  {
    header: "Status",
    id: "status",
    accessorFn: (r) => (r.active ? "Active" : "Inactive"),
    cell: ({ row }) => <Badge tone={row.original.active ? "success" : "warning"}>{row.original.active ? "Active" : "Inactive"}</Badge>,
  },
];

const exportTextiles = (rows: Textile[]) =>
  downloadCsv(
    `textiles-${todayInput()}.csv`,
    ["Code", "Name", "City", "Contact person", "Mobile", "Email", "GSTIN", "Payment terms", "Credit limit", "Opening", "Bills", "Billed", "Received", "Cheques to clear", "Balance (+ due, − advance)", "Last sale", "Status"],
    rows.map((r) => [
      r.code,
      r.name,
      r.city,
      r.contactPerson,
      r.mobile,
      r.email,
      r.gst,
      r.paymentTerms,
      r.creditLimit?.toFixed(2),
      r.openingBalance.toFixed(2),
      r.bills,
      r.billed.toFixed(2),
      r.received.toFixed(2),
      r.chequesPending.toFixed(2),
      r.balance.toFixed(2),
      r.lastSaleAt?.slice(0, 10),
      r.active ? "Active" : "Inactive",
    ]),
  );

const tileIcons: Record<string, { icon: LucideIcon; className: string }> = {
  total: { icon: Store, className: "bg-[#1b3c55] text-[#f1cf7b]" },
  active: { icon: CircleCheck, className: "bg-emerald-600 text-white" },
  due: { icon: HandCoins, className: "bg-amber-500 text-white" },
  cheques: { icon: FileCheck2, className: "bg-blue-600 text-white" },
  limit: { icon: AlertTriangle, className: "bg-rose-600 text-white" },
};

function Summary({ rows }: { rows: Textile[] }) {
  const active = rows.filter((row) => row.active);
  const owing = rows.filter((row) => row.balance > 0.005);
  const due = owing.reduce((sum, row) => sum + row.balance, 0);
  const cheques = rows.reduce((sum, row) => sum + row.chequesPending, 0);
  const over = rows.filter(overLimit);
  const tiles = [
    { key: "total", label: "Textiles", value: String(rows.length), hint: `${rows.length - active.length} inactive` },
    { key: "active", label: "Active", value: String(active.length), hint: "Can get new sales" },
    { key: "due", label: "To collect", value: money(due), hint: `${owing.length} textile${owing.length === 1 ? "" : "s"} owe` },
    { key: "cheques", label: "Cheques to clear", value: money(cheques), hint: `${rows.filter((r) => r.chequesPending > 0).length} textiles` },
    { key: "limit", label: "Over credit limit", value: String(over.length), hint: over.length ? over.slice(0, 2).map((r) => r.name).join(", ") : "None" },
  ];
  return (
    <div className="suppliers-stats grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map(({ key, label, value, hint }) => {
        const { icon: Icon, className } = tileIcons[key];
        return (
          <div key={key} className="suppliers-stat-tile">
            <div className={`suppliers-stat-icon ${className}`}><Icon size={15} aria-hidden /></div>
            <div className="min-w-0">
              <div className="suppliers-stat-label">{label}</div>
              <div className="suppliers-stat-value truncate">{value}</div>
              <div className="suppliers-stat-hint truncate">{hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const loadDefaults = () => api<{ code: string }>("/masters/textiles/next-code", { silent: true }).then(({ code }) => ({ code }));

/** The Textiles list: who you sell fabric and yarn to, with what each owes. */
export function TextilesList() {
  return (
    <MasterCrud<Textile, Form>
      prefix="suppliers"
      title="Textiles"
      description="Who you sell to: details for the bill, payment terms, and what each textile owes."
      entity="Textile"
      endpoint="/masters/textiles"
      fields={fields}
      blank={blank}
      toForm={toForm}
      columns={columns}
      describe={(row) => row.name}
      loadDefaults={loadDefaults}
      summary={(rows) => <Summary rows={rows} />}
      dialog={{ icon: Shirt, caption: "A textile you sell to. Its details go on sale bills; sales and money received are tracked on its account." }}
      canDelete={false}
      activeField="active"
      activeHint="It can’t be picked for new sales while inactive."
      searchPlaceholder="Search textile, code, city, GSTIN or contact..."
      validate={validate}
      headerActions={(rows) => (
        <Button variant="outline" disabled={rows.length === 0} onClick={() => exportTextiles(rows)} title="Download the textiles shown">
          <Download size={15} /> Export
        </Button>
      )}
    />
  );
}
