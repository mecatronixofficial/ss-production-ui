"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Activity, Download, KeyRound, LogOut, MoreHorizontal, Pencil, Plus, Power, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, Users as UsersIcon } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { useApiQuery } from "@/lib/use-api-query";
import type { Role } from "@/lib/types";
import { cn, formatDateTime, todayInput } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import {
  canManage,
  initials,
  roleLabel,
  ROLES,
  roleTone,
  STATUSES,
  statusTone,
  timeAgo,
  UserDialog,
  userHref,
  useUserActions,
  type Employee,
  type Mode,
  type Status,
  type UserRow,
} from "./shared";

/** The users shown, as a CSV for Excel (no passwords or session details). */
const exportUsers = (rows: UserRow[]) =>
  downloadCsv(
    `users-${todayInput()}.csv`,
    ["Name", "Email", "Role", "Status", "Employee code", "Employee", "Department", "Created", "Last active", "Devices signed in"],
    rows.map((u) => [
      u.name,
      u.email,
      roleLabel(u.role),
      STATUSES.find((s) => s.status === u.status)?.label ?? u.status,
      u.employee?.code,
      u.employee?.name,
      u.employee?.department,
      u.createdAt.slice(0, 10),
      u.lastActiveAt ? formatDateTime(u.lastActiveAt) : "Never",
      u.activeSessions,
    ]),
  );

export default function Users() {
  const { user: me } = useAuth();
  const { data: rows, error, reload, loading } = useApiQuery<UserRow[]>("/users");
  const { data: employees = [] } = useApiQuery<Employee[]>("/masters/employees");
  const [mode, setMode] = useState<Mode | null>(null);
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const userActions = useUserActions(() => void reload());

  // Memoised columns call the latest handlers through a ref.
  const actions = useRef({
    open: (_m: Mode) => {},
    signOut: async (_u: UserRow) => false as boolean,
    toggle: async (_u: UserRow) => false as boolean,
    remove: async (_u: UserRow) => false as boolean,
  });
  actions.current = { open: setMode, ...userActions };

  const cols = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        header: "User",
        id: "user",
        accessorFn: (r) => `${r.name} ${r.email}`,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Link href={userHref(u.id)} className={cn("users-avatar", u.status !== "ACTIVE" && "is-muted")} aria-hidden tabIndex={-1}>
                {initials(u.name)}
              </Link>
              <div className="min-w-0">
                <p className="truncate font-semibold text-gray-800">
                  <Link href={userHref(u.id)} className="hover:text-[#1b3c55] hover:underline" title="Open this user's details">{u.name}</Link>
                  {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
                </p>
                <p className="truncate text-xs text-gray-500">{u.email}</p>
                {u.resetRequestedAt && (
                  <span className="users-reset-flag">
                    <KeyRound size={11} /> Reset requested
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      { header: "Role", accessorKey: "role", cell: ({ row }) => <Badge tone={roleTone(row.original.role)}>{roleLabel(row.original.role)}</Badge> },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{STATUSES.find((s) => s.status === row.original.status)?.label}</Badge>,
      },
      {
        header: "Employee",
        id: "employee",
        accessorFn: (r) => (r.employee ? `${r.employee.code} ${r.employee.name} ${r.employee.department}` : ""),
        cell: ({ row }) =>
          row.original.employee ? (
            <div className="leading-tight">
              <Link href={`/masters/employees/${row.original.employee.id}`} className="text-sm hover:underline">{row.original.employee.name}</Link>
              <p className="text-xs text-gray-500">
                {row.original.employee.code} · {row.original.employee.department}
              </p>
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        header: "Last active",
        id: "lastActive",
        accessorFn: (r) => r.lastActiveAt ?? "",
        cell: ({ row }) => (
          <div className="leading-tight" title={row.original.lastActiveAt ? formatDateTime(row.original.lastActiveAt) : undefined}>
            <p className="text-sm">{timeAgo(row.original.lastActiveAt)}</p>
            <p className="text-xs text-gray-500">
              {row.original.activeSessions > 0 ? `${row.original.activeSessions} device${row.original.activeSessions === 1 ? "" : "s"} signed in` : "Signed out"}
            </p>
          </div>
        ),
      },
      {
        header: "Actions",
        id: "actions",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const u = row.original;
          const self = u.id === me?.id;
          if (!canManage(me?.role, u.role)) return <p className="text-right text-xs text-gray-400">Super Admin only</p>;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={() => actions.current.open({ kind: "edit", user: u })} aria-label={`Edit ${u.name}`}>
                <Pencil size={14} /> Edit
              </Button>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="users-more" aria-label={`More actions for ${u.name}`}>
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={6} className="users-menu">
                    <DropdownMenu.Item className="users-menu__item" onSelect={() => actions.current.open({ kind: "password", user: u })}>
                      <KeyRound size={14} /> Set new password
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="users-menu__item"
                      disabled={self || u.activeSessions === 0}
                      onSelect={() => void actions.current.signOut(u)}
                    >
                      <LogOut size={14} /> Sign out everywhere
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                    <DropdownMenu.Item
                      className={cn("users-menu__item", u.status === "ACTIVE" && "is-danger")}
                      disabled={self}
                      onSelect={() => void actions.current.toggle(u)}
                    >
                      <Power size={14} /> {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="users-menu__item is-danger" disabled={self} onSelect={() => void actions.current.remove(u)}>
                      <Trash2 size={14} /> Delete user
                    </DropdownMenu.Item>
                    {self && <p className="px-3 pb-1.5 pt-1 text-[11px] text-gray-400">Manage your own account from My Profile.</p>}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          );
        },
      },
    ],
    [me?.id, me?.role],
  );

  if (!rows && error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!rows) return <Loading />;

  const visible = rows.filter((r) => (roleFilter === "ALL" || r.role === roleFilter) && (statusFilter === "ALL" || r.status === statusFilter));
  const resetRequests = rows.filter((r) => r.resetRequestedAt && canManage(me?.role, r.role));
  const tiles = [
    { cls: "total", label: "Total users", value: rows.length, icon: UsersIcon },
    { cls: "manager", label: "Active", value: rows.filter((r) => r.status === "ACTIVE").length, icon: UserCheck },
    { cls: "worker", label: "Signed in now", value: rows.filter((r) => r.activeSessions > 0).length, icon: Activity },
    { cls: "superadmin", label: "Reset requests", value: resetRequests.length, icon: KeyRound },
  ];

  return (
    <div className="users-page">
      <div className="users-list-header flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="users-page-icon">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h2 className="text-lg font-bold md:text-xl">Users</h2>
            <p className="text-xs text-gray-500">Create logins, choose what each person can open, and control their sessions.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={15} className={cn(loading && "animate-spin")} /> Refresh
          </Button>
          <Button variant="outline" disabled={visible.length === 0} onClick={() => exportUsers(visible)} title="Download the users shown">
            <Download size={15} /> Export
          </Button>
          <Button className="users-add-btn" onClick={() => setMode({ kind: "create" })}>
            <Plus size={16} /> Create user
          </Button>
        </div>
      </div>

      {resetRequests.length > 0 && (
        <div className="users-requests" role="status">
          <KeyRound size={17} className="shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {resetRequests.length} password reset request{resetRequests.length === 1 ? "" : "s"} waiting
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {resetRequests.map((u) => (
                <button key={u.id} type="button" className="users-requests__chip" onClick={() => setMode({ kind: "password", user: u })}>
                  {u.name} · {timeAgo(u.resetRequestedAt)} — set password
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="users-stats grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        {tiles.map(({ cls, label, value, icon: Icon }) => (
          <div key={label} className={`users-stat-tile users-stat-tile--${cls}`}>
            <div className="users-stat-icon">
              <Icon size={15} />
            </div>
            <div>
              <p className="users-stat-label">{label}</p>
              <p className="users-stat-value">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="users-toolbar">
        <label className="users-search">
          <Search size={16} className="text-gray-400" aria-hidden />
          <Input placeholder="Search name, email, employee..." aria-label="Search users" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <div className="users-tabs" role="tablist" aria-label="Filter by role">
          {(["ALL", ...ROLES.map((r) => r.role)] as const).map((role) => (
            <button
              key={role}
              type="button"
              role="tab"
              aria-selected={roleFilter === role}
              className={cn(roleFilter === role && "is-active")}
              onClick={() => setRoleFilter(role)}
            >
              {role === "ALL" ? "All" : roleLabel(role)}
              <span>{role === "ALL" ? rows.length : rows.filter((r) => r.role === role).length}</span>
            </button>
          ))}
        </div>
        <select className="erp-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "ALL")} aria-label="Filter by status">
          <option value="ALL">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.status} value={s.status}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        data={visible}
        columns={cols}
        filter={filter}
        onFilterChange={setFilter}
        hideSearch
        getRowId={(r) => r.id}
        emptyTitle="No users match"
        emptyDescription="Try another filter, or create a user."
      />

      {mode && (
        <UserDialog
          key={mode.kind === "create" ? "create" : `${mode.kind}-${mode.user.id}`}
          mode={mode}
          meId={me?.id}
          meRole={me?.role}
          employees={employees}
          users={rows}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
