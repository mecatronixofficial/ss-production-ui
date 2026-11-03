"use client";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarPlus, CircleCheck, Download, Factory, HandCoins, KeyRound, LayoutGrid, UserCog, Users, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { MasterCrud, type MasterField, type MasterProblem } from "@/components/master-crud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, money, todayInput } from "@/lib/utils";
import { machineHref } from "../machines/types";

type Employee = {
  id: string;
  code: string;
  name: string;
  department: string;
  mobile?: string | null;
  shift?: string | null;
  joiningDate?: string | null;
  active: boolean;
  user?: { id: string; name: string; email: string; status: string } | null;
  /** Runs they are operating now, with the machine. */
  knittingRuns?: Array<{ id: string; runNo: string; machine: { id: string; code: string } }>;
  _count?: { knittingRuns: number };
  /** Money given to them this month (Wages expenses). */
  paidThisMonth?: number;
};

const DEPARTMENTS = ["Production", "Yarn", "Knitting", "Dyeing", "Compacting", "Finishing", "Quality", "Dispatch", "Maintenance", "Stores", "Office"] as const;
// Keep in sync with SHIFTS in backend/src/masters/dto/employee.dto.ts.
const SHIFTS = ["A", "B", "C", "General"] as const;
const shiftLabel = (shift: string) => (shift === "General" ? "General" : `Shift ${shift}`);

const blank = { code: "EMP-", name: "", department: "Knitting", shift: "A", mobile: "", joiningDate: "" };
type Form = typeof blank;

const fields: MasterField<Form>[] = [
  { key: "name", label: "Full name", required: true, wide: true, maxLength: 120, section: "Employee" },
  { key: "code", label: "Employee code", required: true, placeholder: "EMP-001", hint: "Suggested", maxLength: 30, uppercase: true, section: "Employee" },
  { key: "mobile", label: "Mobile", type: "tel", placeholder: "98765 43210", maxLength: 30, section: "Employee" },
  { key: "department", label: "Department", type: "select", options: DEPARTMENTS, required: true, section: "Work" },
  { key: "shift", label: "Shift", type: "select", options: SHIFTS, optionLabel: shiftLabel, section: "Work" },
  { key: "joiningDate", label: "Joining date", type: "date", hint: "Optional", section: "Work" },
];

const CODE = /^[A-Z0-9][A-Z0-9-]{0,29}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const NAME = /[A-Za-zऀ-෿]/;

/** Mirrors the API (EmployeeDto and its unique code) so problems show on the field before saving. */
function validate(f: Form, { rows, editingId }: { rows: Employee[]; editingId: string | null }): MasterProblem<Form> {
  if (!NAME.test(f.name)) return { key: "name", text: "Enter the employee's name." };
  const code = f.code.trim().toUpperCase();
  if (!CODE.test(code) || code === "EMP-") return { key: "code", text: "Code can use letters, numbers and dashes only (max 30), e.g. EMP-012." };
  const taken = rows.find((row) => row.id !== editingId && row.code.toUpperCase() === code);
  if (taken) return { key: "code", text: `${code} is already used by ${taken.name}${taken.active ? "" : " (inactive)"}.` };
  if (f.mobile.trim() && !PHONE.test(f.mobile.trim())) return { key: "mobile", text: "Enter a valid phone number, e.g. 98765 43210." };
  const sameMobile = f.mobile.trim() && rows.find((row) => row.id !== editingId && row.mobile && row.mobile.replace(/\D/g, "") === f.mobile.replace(/\D/g, ""));
  if (sameMobile) return { key: "mobile", text: `${sameMobile.name} (${sameMobile.code}) already has this number.` };
  // A joining date a few weeks ahead is fine (an offer accepted); a typo a year out is not.
  const latest = new Date();
  latest.setDate(latest.getDate() + 90);
  if (f.joiningDate && f.joiningDate > `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`) {
    return { key: "joiningDate", text: "Joining date is more than 90 days ahead; check the year." };
  }
  if (f.joiningDate && f.joiningDate < "1950-01-01") return { key: "joiningDate", text: "Check the joining date." };
  return null;
}

/** The employees shown, as a CSV for Excel. */
const exportEmployees = (rows: Employee[]) =>
  downloadCsv(
    `employees-${todayInput()}.csv`,
    ["Code", "Name", "Department", "Shift", "Mobile", "Joining date", "On machine now", "Runs operated", "Paid this month", "Login", "Login email", "Status"],
    rows.map((r) => [
      r.code,
      r.name,
      r.department,
      r.shift ? shiftLabel(r.shift) : "",
      r.mobile,
      r.joiningDate?.slice(0, 10),
      (r.knittingRuns ?? []).map((run) => run.machine.code).join(" "),
      r._count?.knittingRuns ?? 0,
      (r.paidThisMonth ?? 0).toFixed(2),
      r.user?.name,
      r.user?.email,
      r.active ? "Active" : "Inactive",
    ]),
  );

const toForm = (row: Employee): Form => ({
  code: row.code,
  name: row.name,
  department: row.department,
  shift: row.shift ?? "",
  mobile: row.mobile ?? "",
  joiningDate: row.joiningDate ? row.joiningDate.slice(0, 10) : "",
});

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");

const columns: ColumnDef<Employee>[] = [
  {
    header: "Employee",
    id: "employee",
    accessorFn: (r) => `${r.name} ${r.code}`,
    cell: ({ row }) => (
      <Link href={`/masters/employees/${row.original.id}`} className="employee-cell" title="Open this employee's details and work">
        <span className="employee-cell__avatar" aria-hidden>{initials(row.original.name)}</span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-[#1b3c55]">{row.original.name}</span>
          <span className="block font-mono text-xs text-gray-500">{row.original.code}</span>
        </span>
      </Link>
    ),
  },
  { header: "Department", accessorKey: "department", cell: ({ row }) => <Badge tone="info">{row.original.department}</Badge> },
  { header: "Shift", accessorFn: (r) => (r.shift ? shiftLabel(r.shift) : "—") },
  {
    header: "Mobile",
    id: "mobile",
    accessorFn: (r) => r.mobile ?? "",
    cell: ({ row }) => (row.original.mobile ? <a href={`tel:${row.original.mobile}`} className="whitespace-nowrap hover:underline">{row.original.mobile}</a> : <span className="text-gray-400">—</span>),
  },
  {
    header: "On machine now",
    id: "machine",
    accessorFn: (r) => (r.knittingRuns ?? []).map((run) => run.machine.code).join(" "),
    cell: ({ row }) => {
      const running = row.original.knittingRuns ?? [];
      if (!running.length) return <span className="text-gray-400">—</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {running.map((run) => (
            <Link key={run.id} href={machineHref(run.machine.id)} className="employee-machine-chip" title={run.runNo}>{run.machine.code}</Link>
          ))}
        </span>
      );
    },
  },
  { header: "Runs", id: "runs", accessorFn: (r) => r._count?.knittingRuns ?? 0 },
  {
    header: "Paid this month",
    id: "paid",
    meta: { align: "right" },
    accessorFn: (r) => r.paidThisMonth ?? 0,
    cell: ({ getValue }) => (getValue<number>() > 0 ? <span className="font-semibold tabular-nums">{money(getValue<number>())}</span> : <span className="text-gray-400">—</span>),
  },
  { header: "Joined", id: "joined", accessorFn: (r) => r.joiningDate ?? "", cell: ({ row }) => formatDate(row.original.joiningDate) },
  {
    header: "Login",
    id: "login",
    accessorFn: (r) => (r.user ? `${r.user.name} ${r.user.email}` : ""),
    cell: ({ row }) => {
      const user = row.original.user;
      if (!user) return <span className="text-gray-400">Not linked</span>;
      return (
        <div className="leading-tight">
          <div>{user.name}</div>
          <div className="text-xs text-gray-500">
            {user.email}
            {user.status !== "ACTIVE" && " · inactive"}
          </div>
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

const describe = (row: Employee) => row.name;

/** Suggests the next free EMP- code; it stays editable and the server re-checks it on save. */
const loadDefaults = () => api<{ code: string }>("/masters/employees/next-code", { silent: true }).then(({ code }) => ({ code }));

const tileIcons: Record<string, { icon: LucideIcon; className: string }> = {
  total: { icon: Users, className: "bg-[#1b3c55] text-[#f1cf7b]" },
  active: { icon: CircleCheck, className: "bg-emerald-600 text-white" },
  machines: { icon: Factory, className: "bg-[#1f8a6a] text-white" },
  login: { icon: KeyRound, className: "bg-blue-600 text-white" },
  paid: { icon: HandCoins, className: "bg-amber-600 text-white" },
  departments: { icon: LayoutGrid, className: "bg-amber-500 text-white" },
  recent: { icon: CalendarPlus, className: "bg-teal-600 text-white" },
};

const DAY = 24 * 60 * 60 * 1000;

function Summary({ rows }: { rows: Employee[] }) {
  const active = rows.filter((row) => row.active);
  const departments = new Map<string, number>();
  for (const row of active) departments.set(row.department, (departments.get(row.department) ?? 0) + 1);
  const onMachines = active.filter((row) => (row.knittingRuns ?? []).length > 0);
  const since = Date.now() - 30 * DAY;
  const recent = rows.filter((row) => row.joiningDate && new Date(row.joiningDate).getTime() >= since).length;
  const biggest = [...departments].sort((a, b) => b[1] - a[1])[0];
  const tiles = [
    { key: "total", label: "Employees", value: rows.length, hint: `${rows.length - active.length} inactive` },
    { key: "active", label: "Active", value: active.length, hint: "Can be machine operators" },
    { key: "machines", label: "On machines now", value: onMachines.length, hint: onMachines.length ? onMachines.flatMap((r) => r.knittingRuns!.map((run) => run.machine.code)).join(", ") : "No one operating" },
    { key: "paid", label: "Paid this month", value: money(rows.reduce((sum, row) => sum + (row.paidThisMonth ?? 0), 0)), hint: `to ${rows.filter((row) => (row.paidThisMonth ?? 0) > 0).length} employees` },
    { key: "departments", label: "Departments", value: departments.size, hint: biggest ? `Most in ${biggest[0]} (${biggest[1]})` : "With active staff" },
    { key: "recent", label: "New joiners", value: recent, hint: "Last 30 days" },
  ];
  return (
    <div className="employees-stats grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map(({ key, label, value, hint }) => {
        const { icon: Icon, className } = tileIcons[key];
        return (
          <div key={key} className="employees-stat-tile">
            <div className={`employees-stat-icon ${className}`}>
              <Icon size={15} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="employees-stat-label">{label}</div>
              <div className="employees-stat-value">{value}</div>
              <div className="employees-stat-hint truncate" title={hint}>{hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Employees() {
  return (
    <MasterCrud<Employee, Form>
      prefix="employees"
      title="Employees"
      description="Shop-floor staff, their departments and shifts, who is on which machine now and the money given to them. Open an employee to give money day by day."
      entity="Employee"
      endpoint="/masters/employees"
      fields={fields}
      blank={blank}
      toForm={toForm}
      columns={columns}
      describe={describe}
      loadDefaults={loadDefaults}
      summary={(rows) => <Summary rows={rows} />}
      dialog={{ icon: UserCog, caption: "Shop-floor staff. Active employees can be picked as machine operators." }}
      canDelete={false}
      activeField="active"
      activeHint="They can’t be picked as a machine operator while inactive. A linked login is not affected — manage it in Users."
      searchPlaceholder="Search name, code, department, machine or login..."
      validate={validate}
      headerActions={(rows) => (
        <Button variant="outline" disabled={rows.length === 0} onClick={() => exportEmployees(rows)} title="Download the employees shown">
          <Download size={15} /> Export
        </Button>
      )}
    />
  );
}
