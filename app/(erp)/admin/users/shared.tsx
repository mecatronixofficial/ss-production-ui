"use client";
import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Eye, EyeOff, KeyRound, Wand2, X } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { navFor } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import { useApiAction } from "@/lib/use-api-action";
import type { Role } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type BadgeTone } from "@/components/ui/badge";
import { InlineMessage } from "@/components/ui/inline-message";

/** Shared by Users and a user's own page: types, role / status labels, the create / edit / password window and account actions. */

export type Status = "ACTIVE" | "INACTIVE" | "LOCKED";
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: Status;
  employeeId: string | null;
  createdAt: string;
  employee: { id: string; code: string; name: string; department: string } | null;
  lastActiveAt: string | null;
  activeSessions: number;
  resetRequestedAt: string | null;
};
export type Employee = { id: string; code: string; name: string; department: string; active: boolean };
export type Mode = { kind: "create" } | { kind: "edit"; user: UserRow } | { kind: "password"; user: UserRow };

export const ROLES: Array<{ role: Role; label: string; summary: string }> = [
  { role: "STAFF", label: "Staff", summary: "Warehouse stock, yarn and fabric receipts, movements and printable goods-receipt bills." },
  { role: "MANAGER", label: "Manager", summary: "Assigned knitting tasks: machine, yarn and weight; complete work without seeing prices." },
  { role: "ADMIN", label: "Admin", summary: "Every page, including users, audit logs and settings." },
  { role: "SUPERADMIN", label: "Super Admin", summary: "Everything an Admin can do, plus managing Super Admins." },
];
export const STATUSES: Array<{ status: Status; label: string; summary: string }> = [
  { status: "ACTIVE", label: "Active", summary: "Can sign in." },
  { status: "INACTIVE", label: "Inactive", summary: "Left or on leave; cannot sign in." },
  { status: "LOCKED", label: "Locked", summary: "Blocked for security; cannot sign in." },
];
export const roleLabel = (role: Role) => ROLES.find((r) => r.role === role)?.label ?? role;
const ROLE_TONES: Record<Role, BadgeTone> = { SUPERADMIN: "danger", ADMIN: "warning", MANAGER: "info", STAFF: "default" };
export const roleTone = (role: Role) => ROLE_TONES[role];
/** Only a Super Admin may create, promote to, or manage Super Admin accounts (the API enforces this too). */
export const canManage = (actor: Role | undefined, target: Role) => target !== "SUPERADMIN" || actor === "SUPERADMIN";
export const statusTone = (status: Status): BadgeTone => (status === "ACTIVE" ? "success" : status === "LOCKED" ? "danger" : "warning");
const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "U";

export function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : formatDate(iso);
}

/** 14 characters from an unambiguous set, with at least one of each character class. */
function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?-"];
  const all = sets.join("");
  const random = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
  const chars = sets.map((set) => set[random(set.length)]);
  while (chars.length < 14) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function PasswordField({ value, onChange, required }: { value: string; onChange: (v: string) => void; required: boolean }) {
  const [visible, setVisible] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Password copied. Share it with the user securely.");
    } catch {
      toast.error("Couldn’t copy to the clipboard.");
    }
  };
  return (
    <Field
      label={required ? "Password *" : "New password"}
      hint={required ? `Min ${MIN_PASSWORD} characters` : "Leave blank to keep the current one"}
      error={value && value.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : undefined}
    >
      <span className="users-password">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          autoComplete="new-password"
          className="pr-[6.5rem] font-mono"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="users-password__actions">
          <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide password" : "Show password"} title={visible ? "Hide" : "Show"}>
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button type="button" disabled={!value} onClick={() => void copy()} aria-label="Copy password" title="Copy">
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(generatePassword());
              setVisible(true);
            }}
            aria-label="Generate a strong password"
            title="Generate"
          >
            <Wand2 size={14} />
          </button>
        </span>
      </span>
    </Field>
  );
}

export function RoleAccess({ role }: { role: Role }) {
  const sections = navFor(role);
  const pages = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="users-access">
      <p className="users-access__title">
        {roleLabel(role)} can open {pages} page{pages === 1 ? "" : "s"}
      </p>
      <div className="users-access__sections">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="users-access__section">{section.title}</p>
            <ul>
              {section.items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Icon size={12} aria-hidden /> {label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UserDialog({
  mode,
  meId,
  meRole,
  employees,
  users,
  onClose,
  onSaved,
}: {
  mode: Mode;
  meId?: string;
  meRole?: Role;
  employees: Employee[];
  users: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = mode.kind === "create" ? null : mode.user;
  const [f, setF] = useState({
    name: editing?.name ?? "",
    email: editing?.email ?? "",
    password: "",
    role: editing?.role ?? ("STAFF" as Role),
    status: editing?.status ?? ("ACTIVE" as Status),
    employeeId: editing?.employeeId ?? "",
  });
  const { message, run, reject, busy } = useApiAction();
  const isSelf = editing?.id === meId;
  const passwordOnly = mode.kind === "password";
  // Employees already linked to someone else can't be linked again.
  const linkedTo = useMemo(
    () => new Map(users.filter((u) => u.employeeId && u.id !== editing?.id).map((u) => [u.employeeId!, u.name])),
    [users, editing?.id],
  );

  const save = async () => {
    if (!passwordOnly && !f.name.trim()) return reject("Name is required.", "Check user");
    if (!editing && !EMAIL.test(f.email.trim())) return reject("Enter a valid email address.", "Check user");
    if ((!editing || passwordOnly || f.password) && f.password.length < MIN_PASSWORD) {
      return reject(`Password must be at least ${MIN_PASSWORD} characters.`, "Check user");
    }
    const ok = !editing
      ? await run(
          () =>
            api("/users", {
              method: "POST",
              body: JSON.stringify({ name: f.name.trim(), email: f.email.trim(), password: f.password, role: f.role, employeeId: f.employeeId || undefined }),
            }),
          `${f.name.trim()} can now sign in.`,
        )
      : await run(
          () =>
            api(`/users/${editing.id}`, {
              method: "PATCH",
              body: JSON.stringify(
                passwordOnly
                  ? { password: f.password }
                  : {
                      name: f.name.trim(),
                      role: f.role,
                      status: f.status,
                      employeeId: f.employeeId || null,
                      ...(f.password ? { password: f.password } : {}),
                    },
              ),
            }),
          f.password ? `Password set for ${editing.name}. Their devices were signed out.` : `${f.name.trim()} updated.`,
        );
    if (ok) onSaved();
  };

  const title = mode.kind === "create" ? "Create user" : mode.kind === "password" ? `Set password for ${mode.user.name}` : `Edit ${mode.user.name}`;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{title}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <form
            noValidate
            className="users-dialog__body"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <InlineMessage message={message} />
            {passwordOnly ? (
              <>
                {mode.user.resetRequestedAt && (
                  <p className="users-note users-note--warn">
                    {mode.user.name} asked for a password reset {timeAgo(mode.user.resetRequestedAt).toLowerCase()}.
                  </p>
                )}
                <PasswordField value={f.password} onChange={(password) => setF({ ...f, password })} required />
                <p className="users-note">Their other devices are signed out. Share the new password privately; they can change it from My Profile.</p>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Full name *">
                    <Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
                  </Field>
                  <Field label="Email *" hint={editing ? "Can’t be changed" : "Sign-in ID"}>
                    <Input type="email" value={f.email} disabled={Boolean(editing)} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
                  </Field>
                </div>

                <fieldset className="space-y-2" disabled={isSelf}>
                  <legend className="erp-label">Role</legend>
                  <div className="users-choice-grid users-choice-grid--roles">
                    {ROLES.filter(({ role }) => canManage(meRole, role)).map(({ role, label, summary }) => (
                      <label key={role} className={cn("users-choice", f.role === role && "is-selected")}>
                        <input type="radio" name="role" value={role} checked={f.role === role} onChange={() => setF({ ...f, role })} />
                        <span className="users-choice__label">
                          {label} {f.role === role && <Check size={13} aria-hidden />}
                        </span>
                        <span className="users-choice__summary">{summary}</span>
                      </label>
                    ))}
                  </div>
                  <RoleAccess role={f.role} />
                </fieldset>

                {editing && (
                  <fieldset className="space-y-2" disabled={isSelf}>
                    <legend className="erp-label">Status</legend>
                    <div className="users-choice-grid">
                      {STATUSES.map(({ status, label, summary }) => (
                        <label key={status} className={cn("users-choice", f.status === status && "is-selected")}>
                          <input type="radio" name="status" value={status} checked={f.status === status} onChange={() => setF({ ...f, status })} />
                          <span className="users-choice__label">
                            {label} {f.status === status && <Check size={13} aria-hidden />}
                          </span>
                          <span className="users-choice__summary">{summary}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {isSelf && <p className="users-note">You can’t change your own role or status.</p>}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Linked employee" hint="Optional">
                    <select className="erp-input" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
                      <option value="">Not linked</option>
                      {/* Inactive employees can't be newly linked; keep the current link visible. */}
                      {employees.filter((e) => e.active || e.id === editing?.employeeId).map((e) => (
                        <option key={e.id} value={e.id} disabled={linkedTo.has(e.id)}>
                          {e.code} · {e.name} ({e.department}){linkedTo.has(e.id) ? ` — linked to ${linkedTo.get(e.id)}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <PasswordField value={f.password} onChange={(password) => setF({ ...f, password })} required={!editing} />
                </div>
                {editing && (f.role !== editing.role || f.status !== editing.status || f.password) && (
                  <p className="users-note users-note--warn">Saving signs {editing.name} out of every device so the change applies immediately.</p>
                )}
              </>
            )}
            <div className="users-dialog__foot">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {passwordOnly ? <KeyRound size={15} /> : <Check size={15} />}
                {busy ? "Saving..." : mode.kind === "create" ? "Create user" : passwordOnly ? "Set password" : "Save changes"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A user's own page. */
export const userHref = (id: string) => `/admin/users/${id}`;

/**
 * Sign out everywhere, deactivate / reactivate and delete, each confirmed first. Each returns true when it went
 * through; `onDone` runs after any of them.
 */
export function useUserActions(onDone: () => void) {
  const { run } = useApiAction();
  return {
    signOut: async (user: UserRow) => {
      const ok = await confirmDialog({
        title: `Sign ${user.name} out everywhere?`,
        description: "They’ll need to sign in again on every device. Their account stays active.",
        confirmLabel: "Sign out",
      });
      if (!ok) return false;
      const done = await run(() => api(`/users/${user.id}/sign-out`, { method: "POST" }), `${user.name} was signed out of every device.`);
      if (done) onDone();
      return done;
    },
    toggle: async (user: UserRow) => {
      const activate = user.status !== "ACTIVE";
      const ok = await confirmDialog({
        title: activate ? `Reactivate ${user.name}?` : `Deactivate ${user.name}?`,
        description: activate
          ? "They’ll be able to sign in again with their current password."
          : "They’ll be signed out immediately and can’t sign in until reactivated. Their records and history are kept.",
        confirmLabel: activate ? "Reactivate" : "Deactivate",
        tone: activate ? undefined : "danger",
      });
      if (!ok) return false;
      const status: Status = activate ? "ACTIVE" : "INACTIVE";
      const done = await run(() => api(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status }) }), activate ? `${user.name} reactivated.` : `${user.name} deactivated.`);
      if (done) onDone();
      return done;
    },
    remove: async (user: UserRow) => {
      const ok = await confirmDialog({
        title: `Delete ${user.name}?`,
        description:
          "Their login is removed permanently and they’re signed out immediately. Only accounts with no recorded work can be deleted — otherwise deactivate them to keep their history.",
        confirmLabel: "Delete user",
        tone: "danger",
      });
      if (!ok) return false;
      const done = await run(() => api(`/users/${user.id}`, { method: "DELETE" }), `${user.name} was deleted.`);
      if (done) onDone();
      return done;
    },
  };
}
