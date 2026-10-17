"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Activity, ArrowLeft, CalendarDays, History, KeyRound, LogOut, Monitor, Pencil, Power, ShieldCheck, Smartphone, Trash2, UserCog } from "lucide-react";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime, humanize } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { canManage, initials, roleLabel, RoleAccess, roleTone, STATUSES, statusTone, timeAgo, UserDialog, useUserActions, type Employee, type Mode, type UserRow } from "../shared";

type Details = {
  user: UserRow;
  sessions: Array<{ id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string }>;
  activity: Array<{ id: string; action: string; module: string; entity: string; entityId: string | null; ipAddress: string | null; createdAt: string }>;
  accountChanges: Array<{ id: string; action: string; createdAt: string; actor: { id: string; name: string } | null }>;
};

/** "Chrome on Windows" from a browser's user-agent string; "Unknown device" when there is none. */
function deviceName(userAgent: string | null) {
  if (!userAgent) return { text: "Unknown device", mobile: false };
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return { text: os ? `${browser} on ${os}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

/** `/admin/users/<id>`: one login — role and what it can open, linked employee, devices signed in and recent activity. */
export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user: me } = useAuth();
  const { data, error, reload } = useApiQuery<Details>(`/users/${id}`);
  const { data: employees = [] } = useApiQuery<Employee[]>("/masters/employees");
  const { data: users = [] } = useApiQuery<UserRow[]>("/users");
  const [mode, setMode] = useState<Mode | null>(null);
  const actions = useUserActions(() => void reload());

  const back = <Link href="/admin/users" className="purchases-back-link"><ArrowLeft size={15} /> Users</Link>;
  if (!data) {
    return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;
  }

  const { user: u, sessions, activity, accountChanges } = data;
  const self = u.id === me?.id;
  const manageable = canManage(me?.role, u.role) && !self;
  const statusLabel = STATUSES.find((s) => s.status === u.status)?.label ?? u.status;

  return (
    <div className="inventory-list-page">
      {back}

      <div className="item-details-header flex-wrap">
        <span className={cn("users-avatar user-page__avatar", u.status !== "ACTIVE" && "is-muted")} aria-hidden>{initials(u.name)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1b3c55]">
            {u.name}
            {self && <span className="text-sm font-normal text-gray-400">(you)</span>}
            <Badge tone={roleTone(u.role)}>{roleLabel(u.role)}</Badge>
            <Badge tone={statusTone(u.status)}>{statusLabel}</Badge>
          </h2>
          <p className="break-all text-sm text-gray-600">{u.email}</p>
          {u.resetRequestedAt && (
            <span className="users-reset-flag mt-1">
              <KeyRound size={11} /> Asked for a password reset {timeAgo(u.resetRequestedAt).toLowerCase()}
            </span>
          )}
        </div>
        {manageable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setMode({ kind: "edit", user: u })}><Pencil size={15} /> Edit</Button>
            <Button variant="outline" onClick={() => setMode({ kind: "password", user: u })}><KeyRound size={15} /> Set password</Button>
            <Button variant="outline" disabled={u.activeSessions === 0} onClick={() => void actions.signOut(u)}><LogOut size={15} /> Sign out everywhere</Button>
            <Button variant="outline" className={cn(u.status === "ACTIVE" && "text-red-600")} onClick={() => void actions.toggle(u)}>
              <Power size={15} /> {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </Button>
            <Button variant="outline" className="text-red-600" onClick={async () => { if (await actions.remove(u)) router.push("/admin/users"); }}>
              <Trash2 size={15} /> Delete
            </Button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            {self ? <>This is your account. Manage it from <Link href="/profile" className="font-semibold text-[#1b3c55] hover:underline">My Profile</Link>.</> : "Only a Super Admin can manage Super Admin accounts."}
          </p>
        )}
      </div>

      {u.resetRequestedAt && manageable && (
        <p className="warehouses-inactive-note">
          <KeyRound size={15} className="shrink-0" /> {u.name} asked for a password reset. Use <strong>Set password</strong> and share it with them privately.
        </p>
      )}

      <dl className="customer-account__figures mill-figures">
        {[
          { label: "Last active", value: timeAgo(u.lastActiveAt), note: u.lastActiveAt ? formatDateTime(u.lastActiveAt) : "Has not signed in yet", icon: Activity },
          { label: "Devices signed in", value: String(u.activeSessions), note: u.activeSessions ? "Open sessions now" : "Signed out everywhere", icon: Monitor },
          { label: "Actions recorded", value: activity.length >= 100 ? "100+" : String(activity.length), note: activity[0] ? `Latest ${timeAgo(activity[0].createdAt).toLowerCase()}` : "Nothing recorded yet", icon: History },
          { label: "Member since", value: formatDate(u.createdAt), note: u.employee ? `Employee ${u.employee.code} · ${u.employee.department}` : "No employee linked", icon: CalendarDays },
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="item-details-section">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><UserCog size={14} /></span>
            <h3 className="text-sm font-bold text-[#1b3c55]">Account</h3>
          </div>
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            <div><dt className="erp-label">Sign-in email</dt><dd className="break-all font-medium text-gray-800">{u.email}</dd></div>
            <div><dt className="erp-label">Role</dt><dd className="font-medium text-gray-800">{roleLabel(u.role)}</dd></div>
            <div><dt className="erp-label">Status</dt><dd className="font-medium text-gray-800">{statusLabel} · {STATUSES.find((s) => s.status === u.status)?.summary}</dd></div>
            <div><dt className="erp-label">Created</dt><dd className="font-medium text-gray-800">{formatDateTime(u.createdAt)}</dd></div>
            <div className="sm:col-span-2">
              <dt className="erp-label">Linked employee</dt>
              <dd className="font-medium text-gray-800">
                {u.employee ? (
                  <Link href={`/masters/employees/${u.employee.id}`} className="text-[#1b3c55] hover:underline">
                    {u.employee.code} · {u.employee.name} ({u.employee.department})
                  </Link>
                ) : (
                  <span className="text-gray-400">Not linked{manageable ? " — link one with Edit" : ""}</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="item-details-section">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><ShieldCheck size={14} /></span>
            <div>
              <h3 className="text-sm font-bold text-[#1b3c55]">What this role can open</h3>
              <p className="text-xs text-gray-500">Pages in the sidebar for a {roleLabel(u.role)}.</p>
            </div>
          </div>
          <RoleAccess role={u.role} />
        </section>
      </div>

      <section className="item-details-section">
        <div className="item-details-section__head">
          <span className="item-details-section__icon"><Monitor size={14} /></span>
          <div>
            <h3 className="text-sm font-bold text-[#1b3c55]">Devices signed in ({sessions.length})</h3>
            <p className="text-xs text-gray-500">Each browser or phone where this login is open now.</p>
          </div>
        </div>
        {sessions.length === 0 ? (
          <div className="purchases-empty">Not signed in anywhere.</div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {sessions.map((s) => {
              const device = deviceName(s.userAgent);
              const Icon = device.mobile ? Smartphone : Monitor;
              return (
                <li key={s.id} className="user-page__device">
                  <span className="customer-account__icon"><Icon size={15} aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-800" title={s.userAgent ?? undefined}>{device.text}</p>
                    <p className="truncate text-xs text-gray-500">
                      Active {timeAgo(s.createdAt).toLowerCase()}{s.ipAddress ? ` · ${s.ipAddress}` : ""}
                    </p>
                    <p className="text-[11px] text-gray-400">Stays signed in until {formatDate(s.expiresAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="item-details-section">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><History size={14} /></span>
            <div>
              <h3 className="text-sm font-bold text-[#1b3c55]">Recent activity</h3>
              <p className="text-xs text-gray-500">What {self ? "you" : u.name.split(" ")[0]} did, newest first (latest 100). The full trail is in <Link href="/admin/audit" className="font-semibold text-[#1b3c55] hover:underline">Audit Logs</Link>.</p>
            </div>
          </div>
          {activity.length === 0 ? (
            <div className="purchases-empty">Nothing recorded yet.</div>
          ) : (
            <div className="purchases-line-table max-h-[28rem] overflow-auto rounded-xl border">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Area</th></tr></thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600" title={formatDateTime(a.createdAt)}>{formatDateTime(a.createdAt)}</td>
                      <td className="px-3 py-2 font-medium">{humanize(a.action).toLowerCase().replace(/^./, (c) => c.toUpperCase())}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{humanize(a.module)}{a.entity ? ` · ${a.entity}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="item-details-section">
          <div className="item-details-section__head">
            <span className="item-details-section__icon"><ShieldCheck size={14} /></span>
            <div>
              <h3 className="text-sm font-bold text-[#1b3c55]">Account changes</h3>
              <p className="text-xs text-gray-500">Changes made to this login, and by whom.</p>
            </div>
          </div>
          {accountChanges.length === 0 ? (
            <div className="purchases-empty">No changes recorded.</div>
          ) : (
            <ul className="space-y-2">
              {accountChanges.map((c) => (
                <li key={c.id} className="rounded-xl border bg-white px-3 py-2 text-sm">
                  <p className="font-medium text-gray-800">{humanize(c.action).toLowerCase().replace(/^./, (ch) => ch.toUpperCase())}</p>
                  <p className="text-xs text-gray-500">
                    {c.actor ? (c.actor.id === u.id ? "By themselves" : `By ${c.actor.name}`) : "By the system"} · {formatDateTime(c.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {mode && (
        <UserDialog
          key={`${mode.kind}-${u.id}`}
          mode={mode}
          meId={me?.id}
          meRole={me?.role}
          employees={employees}
          users={users}
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
