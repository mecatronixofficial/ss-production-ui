"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, ClipboardList, Download, IndianRupee, LayoutGrid, PackageCheck, Shirt, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TextilesList } from "./textiles-list";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { GSTIN_PATTERN } from "@/lib/india";
import { MasterCrud, type MasterField, type MasterProblem } from "@/components/master-crud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, money, todayInput, toNumber } from "@/lib/utils";

/** A distributor: who the mill buys yarn and material from (kept as Supplier records in the API). */
type Distributor = {
  id: string;
  code: string;
  name: string;
  company?: string | null;
  contactPerson?: string | null;
  mobile?: string | null;
  email?: string | null;
  gst?: string | null;
  address?: string | null;
  materialCategory?: string | null;
  paymentTerms?: string | null;
  openingBalance?: string | number | null;
  active: boolean;
  /** Purchase orders still waiting to be (fully) received. */
  openPurchaseOrders: number;
  lastOrderDate: string | null;
  /** Payable today: opening balance + value received − paid. Negative is an advance. */
  balance: number;
};

const MATERIALS = ["Yarn / Cotton", "Chemicals & Dyes", "Packing Material", "Spares & Consumables", "Services"] as const;
const TERMS = ["Advance", "Immediate", "15 Days", "30 Days", "45 Days", "60 Days", "90 Days"] as const;

const blank = {
  code: "",
  name: "",
  company: "",
  materialCategory: "Yarn / Cotton",
  contactPerson: "",
  mobile: "",
  email: "",
  gst: "",
  paymentTerms: "30 Days",
  openingBalance: "",
  address: "",
};
type Form = typeof blank;

const fields: MasterField<Form>[] = [
  { key: "name", label: "Distributor name", required: true, wide: true, maxLength: 160, section: "Distributor" },
  { key: "code", label: "Code", required: true, generated: true, placeholder: "Auto-generated on save", maxLength: 30, uppercase: true, section: "Distributor" },
  { key: "company", label: "Company / firm", hint: "Optional", maxLength: 160, section: "Distributor" },
  { key: "materialCategory", label: "Material category", type: "select", options: MATERIALS, section: "Distributor" },
  { key: "contactPerson", label: "Contact person", maxLength: 120, section: "Contact" },
  { key: "mobile", label: "Mobile", type: "tel", placeholder: "98765 43210", maxLength: 30, section: "Contact" },
  { key: "email", label: "Email", type: "email", wide: true, maxLength: 160, section: "Contact" },
  { key: "gst", label: "GSTIN", placeholder: "33ABCDE1234F1Z5", maxLength: 15, uppercase: true, section: "Billing" },
  { key: "paymentTerms", label: "Payment terms", type: "select", options: TERMS, section: "Billing" },
  { key: "openingBalance", label: "Opening balance (₹)", type: "number", placeholder: "0.00", hint: "Payable at start; minus for advance", section: "Billing" },
  { key: "address", label: "Address", wide: true, maxLength: 500, section: "Billing" },
];

const CODE = /^[A-Z0-9][A-Z0-9-]{0,29}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const decimals = (value: string) => (value.split(".")[1] ?? "").length;

/** Mirrors the API (SupplierDto and its unique code) so problems show on the field before saving. */
function validate(f: Form, { rows, editingId }: { rows: Distributor[]; editingId: string | null }): MasterProblem<Form> {
  // The code is assigned on create; it can only be changed when editing.
  if (editingId) {
    const code = f.code.trim().toUpperCase();
    if (!CODE.test(code)) return { key: "code", text: "Code can use letters, numbers and dashes only (max 30), e.g. DST-00012." };
    const taken = rows.find((row) => row.id !== editingId && row.code.toUpperCase() === code);
    if (taken) return { key: "code", text: `${code} is already used by ${taken.name}${taken.active ? "" : " (inactive)"}.` };
  }
  if (f.mobile.trim() && !PHONE.test(f.mobile.trim())) return { key: "mobile", text: "Enter a valid phone number, e.g. 98765 43210." };
  if (f.gst.trim() && !GSTIN_PATTERN.test(f.gst.trim())) return { key: "gst", text: "Enter a valid 15-character GSTIN, e.g. 33ABCDE1234F1Z5." };
  const opening = f.openingBalance.trim();
  if (opening && Math.abs(Number(opening)) > 1e11) return { key: "openingBalance", text: "Opening balance is too large." };
  if (opening && decimals(opening) > 2) return { key: "openingBalance", text: "Opening balance can have at most 2 decimals." };
  return null;
}

/** The distributors shown, as a CSV for Excel. */
const exportDistributors = (rows: Distributor[]) =>
  downloadCsv(
    `distributors-${todayInput()}.csv`,
    ["Code", "Name", "Company", "Material", "Contact person", "Mobile", "Email", "GSTIN", "Payment terms", "Open POs", "Last order", "Balance payable", "Status"],
    rows.map((r) => [
      r.code,
      r.name,
      r.company,
      r.materialCategory,
      r.contactPerson,
      r.mobile,
      r.email,
      r.gst,
      r.paymentTerms,
      r.openPurchaseOrders,
      r.lastOrderDate?.slice(0, 10),
      r.balance.toFixed(2),
      r.active ? "Active" : "Inactive",
    ]),
  );

const s = (value: unknown) => (value == null ? "" : String(value));

const toForm = (row: Distributor): Form => ({
  code: row.code,
  name: row.name,
  company: s(row.company),
  materialCategory: s(row.materialCategory),
  contactPerson: s(row.contactPerson),
  mobile: s(row.mobile),
  email: s(row.email),
  gst: s(row.gst),
  paymentTerms: s(row.paymentTerms),
  openingBalance: toNumber(row.openingBalance) ? String(toNumber(row.openingBalance)) : "",
  address: s(row.address),
});

const columns: ColumnDef<Distributor>[] = [
  {
    header: "Code",
    accessorKey: "code",
    cell: ({ row }) => (
      <Link href={`/masters/distributors/${row.original.id}`} className="customers-code" title="Open this distributor's account">
        {row.original.code}
      </Link>
    ),
  },
  {
    header: "Distributor",
    id: "distributor",
    // GSTIN is searchable too, though not shown.
    accessorFn: (r) => `${r.name} ${r.company ?? ""} ${r.gst ?? ""}`,
    cell: ({ row }) => (
      <div className="leading-tight">
        <Link href={`/masters/distributors/${row.original.id}`} className="font-semibold hover:underline">{row.original.name}</Link>
        {row.original.company && <div className="text-xs text-gray-500">{row.original.company}</div>}
      </div>
    ),
  },
  {
    header: "Material",
    id: "material",
    accessorFn: (r) => r.materialCategory ?? "",
    cell: ({ row }) => (row.original.materialCategory ? <Badge tone="info">{row.original.materialCategory}</Badge> : "—"),
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
    header: "Open POs",
    id: "openPOs",
    accessorFn: (r) => r.openPurchaseOrders,
    cell: ({ row }) => (
      <div className="leading-tight">
        <div className={row.original.openPurchaseOrders ? "font-semibold" : "text-gray-400"}>{row.original.openPurchaseOrders}</div>
        {row.original.lastOrderDate && <div className="text-xs text-gray-500">Last {formatDate(row.original.lastOrderDate)}</div>}
      </div>
    ),
  },
  {
    header: "Balance",
    id: "balance",
    meta: { align: "right" },
    accessorFn: (r) => r.balance,
    cell: ({ row }) => {
      const balance = row.original.balance;
      if (Math.abs(balance) < 0.005) return <span className="text-gray-400">Settled</span>;
      return (
        <span className={balance > 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"} title={balance > 0 ? "Payable to distributor" : "Advance with distributor"}>
          {money(Math.abs(balance))}
          <span className="ml-1 text-[10px] font-bold uppercase">{balance > 0 ? "Due" : "Adv"}</span>
        </span>
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

const describe = (row: Distributor) => row.name;

/** Preview only: the server assigns the real code on save and re-checks it's free. */
const loadDefaults = () => api<{ code: string }>("/masters/suppliers/next-code", { silent: true }).then(({ code }) => ({ code }));

const tileIcons: Record<string, { icon: LucideIcon; className: string }> = {
  total: { icon: Truck, className: "bg-[#1b3c55] text-[#f1cf7b]" },
  active: { icon: CircleCheck, className: "bg-emerald-600 text-white" },
  open: { icon: ClipboardList, className: "bg-blue-600 text-white" },
  payable: { icon: IndianRupee, className: "bg-rose-600 text-white" },
  categories: { icon: LayoutGrid, className: "bg-amber-500 text-white" },
};

function Summary({ rows }: { rows: Distributor[] }) {
  const active = rows.filter((row) => row.active);
  const openPOs = rows.reduce((sum, row) => sum + row.openPurchaseOrders, 0);
  const owed = rows.filter((row) => row.balance > 0.005);
  const payable = owed.reduce((sum, row) => sum + row.balance, 0);
  const categories = new Set(active.map((row) => row.materialCategory).filter(Boolean));
  const tiles = [
    { key: "total", label: "Distributors", value: String(rows.length), hint: `${rows.length - active.length} inactive` },
    { key: "active", label: "Active", value: String(active.length), hint: "Can get new POs" },
    { key: "open", label: "Open POs", value: String(openPOs), hint: `${rows.filter((row) => row.openPurchaseOrders).length} distributors` },
    { key: "payable", label: "Balance payable", value: money(payable), hint: `${owed.length} distributors due` },
    { key: "categories", label: "Categories", value: String(categories.size), hint: "With active distributors" },
  ];
  return (
    <div className="suppliers-stats grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map(({ key, label, value, hint }) => {
        const { icon: Icon, className } = tileIcons[key];
        return (
          <div key={key} className="suppliers-stat-tile">
            <div className={`suppliers-stat-icon ${className}`}>
              <Icon size={15} aria-hidden />
            </div>
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

type PartyTab = "distributors" | "textiles";

/**
 * `/masters/distributors`: the two party lists, Distributors (who you buy from, and may sell to) and Textiles (who
 * you sell to). `?tab=textiles` opens the Textiles list.
 */
export default function Parties() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Kept in state: the lists clear their own `?edit=` / `?new=` params, which must not switch the tab back.
  const [tab, setTab] = useState<PartyTab>(params.get("tab") === "textiles" ? "textiles" : "distributors");
  const pick = (next: PartyTab) => {
    setTab(next);
    router.replace(next === "textiles" ? `${pathname}?tab=textiles` : pathname, { scroll: false });
  };
  return (
    <div className="space-y-3">
      <div className="finance-tabs" role="tablist" aria-label="Party lists">
        {([
          ["distributors", "Distributors", Truck, "Buy from"],
          ["textiles", "Textiles", Shirt, "Sell to"],
        ] as const).map(([value, label, Icon, caption]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={cn(tab === value && "is-active")} onClick={() => pick(value)}>
            <Icon size={14} aria-hidden /> {label} <span className="text-[11px] font-normal opacity-70">· {caption}</span>
          </button>
        ))}
      </div>
      {tab === "distributors" ? <Distributors /> : <TextilesList />}
    </div>
  );
}

function Distributors() {
  return (
    <MasterCrud<Distributor, Form>
      prefix="suppliers"
      title="Distributors"
      description="Who you buy yarn, cotton, chemicals and consumables from, with open orders and balance payable."
      entity="Distributor"
      endpoint="/masters/suppliers"
      fields={fields}
      blank={blank}
      toForm={toForm}
      columns={columns}
      describe={describe}
      loadDefaults={loadDefaults}
      summary={(rows) => <Summary rows={rows} />}
      dialog={{ icon: PackageCheck, caption: "Supplies yarn, chemicals or consumables. Active distributors can be picked for new purchase orders." }}
      canDelete={false}
      activeField="active"
      activeHint="It can’t be picked for new purchase orders while inactive."
      searchPlaceholder="Search distributor, code, GSTIN, material or contact..."
      validate={validate}
      headerActions={(rows) => (
        <Button variant="outline" disabled={rows.length === 0} onClick={() => exportDistributors(rows)} title="Download the distributors shown">
          <Download size={15} /> Export
        </Button>
      )}
    />
  );
}
