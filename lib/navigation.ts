import {
  BarChart3,
  Building2,
  Factory,
  FileText,
  Gauge,
  History,
  Landmark,
  PackageCheck,
  PackagePlus,
  ReceiptIndianRupee,
  Settings,
  ShieldCheck,
  UserCog,
  Wallet,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export type NavItem = {
  href: string;
  label: string;
  /** One-line summary shown under the page title in the topbar. */
  description: string;
  icon: LucideIcon;
  roles: Role[];
};

export type NavSection = { title: string; items: NavItem[] };

/** Super Admin and Admin can open every page. */
export const ADMIN_ROLES: Role[] = ["SUPERADMIN", "ADMIN"];
const ADMIN = ADMIN_ROLES;
/** Managers see the dashboard and look after machines (and can view warehouse stock). */
const MANAGERS: Role[] = [...ADMIN, "MANAGER"];
/** Staff work in the godown only: they (and admins) add, edit and delete stock entries. */
export const GODOWN_EDIT_ROLES: Role[] = [...ADMIN, "STAFF"];
/** Managers can also see godown stock, read-only. */
const GODOWN: Role[] = [...GODOWN_EDIT_ROLES, "MANAGER"];
const ALL: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER", "STAFF"];

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", description: "Production batches, machines, stock, purchases, sales and money at a glance.", icon: Gauge, roles: MANAGERS },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/production", label: "Production", description: "Admins create production work and move it through each process; managers start and complete knitting tasks.", icon: Factory, roles: MANAGERS },
      { href: "/sales", label: "Sales", description: "Sell to distributors or textiles: bill, vehicle, and the warehouse verifies and dispatches.", icon: ReceiptIndianRupee, roles: ADMIN },
      { href: "/purchases", label: "Purchases", description: "Purchase orders from distributors and mills, with received material posted into inventory.", icon: PackageCheck, roles: ADMIN },
      { href: "/challans", label: "Challans", description: "Office copies of every delivery and received challan: search, filter by date and print anytime.", icon: FileText, roles: ADMIN },
    ],
  },
  {
    title: "Stock & Assets",
    items: [
      { href: "/yarn-received", label: "Yarn Received", description: "Every yarn delivery by its mill DC: count, bags and weight; each count gets its own yarn code.", icon: PackagePlus, roles: GODOWN },
      { href: "/warehouses", label: "Warehouses", description: "Stock in each warehouse, with every in and out movement. “View all warehouses” to add or edit them.", icon: Warehouse, roles: GODOWN },
      { href: "/masters/machines", label: "Machines", description: "Knitting machines, day and night: load yarn by code, take the fabric off into stock, with its cost.", icon: Wrench, roles: MANAGERS },
    ],
  },
  {
    title: "Masters",
    items: [
      { href: "/masters/distributors", label: "Distributors & Textiles", description: "Distributors you buy from and textiles you sell to, with what each owes or is owed.", icon: PackageCheck, roles: ADMIN },
      { href: "/masters/mills", label: "Mill Details", description: "Mill contact details, addresses and billing information.", icon: Building2, roles: ADMIN },
      { href: "/masters/employees", label: "Employees", description: "Shop-floor staff, departments and shifts.", icon: UserCog, roles: ADMIN },
    ],
  },
  {
    title: "Finance & Reports",
    items: [
      { href: "/money", label: "Money", description: "Record and track every rupee: cash, bank & UPI accounts, money received and paid, expenses, cheques, and who owes what.", icon: Wallet, roles: ADMIN },
      { href: "/finance", label: "Finance", description: "Results for any period (read-only): earned vs spent, cash flow month by month, expense analysis and batch profit.", icon: Landmark, roles: ADMIN },
      { href: "/reports", label: "Reports", description: "Ready reports for sales, party balances, production, purchases, stock, machines and money, with Excel and PDF export.", icon: BarChart3, roles: ADMIN },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/users", label: "Users", description: "User accounts, roles and what each role can open.", icon: ShieldCheck, roles: ADMIN },
      { href: "/admin/audit", label: "Audit Logs", description: "Critical business and security actions, kept for traceability.", icon: History, roles: ADMIN },
      { href: "/settings", label: "Settings", description: "Company profile and system configuration.", icon: Settings, roles: ADMIN },
    ],
  },
];

const ALL_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

// Routes that are reachable but not listed in the sidebar.
const EXTRA_ROUTES: Array<Pick<NavItem, "href" | "label" | "description" | "roles">> = [
  { href: "/track", label: "Production", description: "Renamed Production.", roles: ADMIN },
  { href: "/godown", label: "Warehouses", description: "Moved to Warehouses.", roles: GODOWN },
  { href: "/masters/suppliers", label: "Distributors", description: "Renamed Distributors.", roles: ADMIN },
  { href: "/masters/textiles", label: "Textiles", description: "A textile you sell to: bills, money received and what it owes.", roles: ADMIN },
  { href: "/notifications", label: "Notifications", description: "Production, stock, machine, purchase and delivery alerts.", roles: ALL },
  { href: "/profile", label: "My Profile", description: "Your account details, password and signed-in devices.", roles: ALL },
];

const bestMatch = <T extends { href: string }>(items: T[], pathname: string) =>
  items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

/** Most specific registered route for a pathname (e.g. `/purchases/abc` → `/purchases`). */
export function matchRoute(pathname: string) {
  return bestMatch([...ALL_ITEMS, ...EXTRA_ROUTES], pathname);
}

/** Sidebar highlight: the most specific *sidebar* entry (so `/purchases/abc` highlights Purchases). */
export function isActive(pathname: string, href: string) {
  return bestMatch(ALL_ITEMS, pathname)?.href === href;
}

export function canAccess(pathname: string, role: Role) {
  const route = matchRoute(pathname);
  return !route || route.roles.includes(role);
}

const HOME: Record<Role, string> = {
  SUPERADMIN: "/dashboard",
  ADMIN: "/dashboard",
  MANAGER: "/dashboard",
  STAFF: "/warehouses",
};

export const homeFor = (role: Role) => HOME[role];

export const navFor = (role: Role): NavSection[] =>
  NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
