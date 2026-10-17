"use client";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Briefcase,
  CalendarDays,
  Eye,
  EyeOff,
  KeyRound,
  LaptopMinimal,
  LogOut,
  Mail,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { toast } from "@/lib/toast-store";
import type { Role } from "@/lib/types";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, formatDateTime, humanize } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineMessage } from "@/components/ui/inline-message";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  createdAt: string;
  passwordChangedAt: string | null;
  employee: {
    code: string;
    name: string;
    department: string;
    shift?: string | null;
    mobile?: string | null;
    joiningDate?: string | null;
  } | null;
};
type Session = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string; current: boolean };

const MIN_PASSWORD = 8;

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

/** Rough, dependency-free description of a user-agent string ("Chrome on Windows"). */
function describeDevice(ua: string | null) {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobi|Android|iPhone|iPad/.test(ua) };
}

/** 0–4 score with a label; length matters most. */
function passwordStrength(password: string) {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= MIN_PASSWORD) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (password.length < MIN_PASSWORD) score = Math.min(score, 1);
  return { score, label: ["Too weak", "Weak", "Fair", "Good", "Strong"][score] };
}

function PasswordInput({ value, onChange, autoComplete, invalid }: { value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <Input
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        className="pr-11"
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="profile-eye"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

function PersonalDetails({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const [name, setName] = useState(profile.name);
  const { message, run, reject, busy } = useApiAction();
  const dirty = name.trim() !== profile.name;

  const save = async () => {
    if (!name.trim()) return reject("Name is required.", "Check your details");
    await run(async () => {
      onSaved(await api<Profile>("/auth/profile", { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }));
    }, "Profile updated.");
  };

  return (
    <section className="profile-card">
      <header className="profile-card__head">
        <span className="profile-card__icon"><UserRound size={15} /></span>
        <div>
          <h3>Personal details</h3>
          <p>How your name appears across the ERP.</p>
        </div>
      </header>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <InlineMessage message={message} />
        <Field label="Full name *">
          <Input value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" hint="Sign-in ID">
          <Input value={profile.email} readOnly disabled className="cursor-not-allowed bg-gray-50 text-gray-500" />
        </Field>
        <p className="text-xs text-gray-500">To change your email or role, ask an Admin.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!dirty || busy} onClick={() => setName(profile.name)}>
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || busy}>
            <Save size={15} /> {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [touched, setTouched] = useState(false);
  const { message, run, reject, busy } = useApiAction();
  const strength = passwordStrength(form.next);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.next;

  const submit = async () => {
    setTouched(true);
    if (!form.current) return reject("Enter your current password.", "Change password");
    if (form.next.length < MIN_PASSWORD) return reject(`New password must be at least ${MIN_PASSWORD} characters.`, "Change password");
    if (form.next !== form.confirm) return reject("The new passwords don’t match.", "Change password");
    if (form.next === form.current) return reject("Choose a password different from the current one.", "Change password");

    let signedOut = 0;
    const ok = await run(async () => {
      const result = await api<{ otherSessionsSignedOut: number }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      signedOut = result.otherSessionsSignedOut;
    });
    if (!ok) return;
    setForm({ current: "", next: "", confirm: "" });
    setTouched(false);
    toast.success(
      signedOut > 0 ? `Password changed. ${signedOut} other device${signedOut === 1 ? " was" : "s were"} signed out.` : "Password changed.",
      "Security",
    );
    onChanged();
  };

  return (
    <section className="profile-card">
      <header className="profile-card__head">
        <span className="profile-card__icon profile-card__icon--gold"><KeyRound size={15} /></span>
        <div>
          <h3>Change password</h3>
          <p>Other devices are signed out when you change it.</p>
        </div>
      </header>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <InlineMessage message={message} />
        {/* Hidden username helps password managers pair the new password with this account. */}
        <input type="text" autoComplete="username" hidden readOnly />
        <Field label="Current password" error={touched && !form.current ? "Enter your current password." : undefined}>
          <PasswordInput value={form.current} autoComplete="current-password" onChange={(current) => setForm({ ...form, current })} />
        </Field>
        <Field label="New password" hint={`Min ${MIN_PASSWORD} characters`}>
          <PasswordInput value={form.next} autoComplete="new-password" onChange={(next) => setForm({ ...form, next })} />
        </Field>
        {form.next && (
          <div className="profile-strength" aria-live="polite">
            <div className="profile-strength__bar">
              {[1, 2, 3, 4].map((step) => (
                <span key={step} className={cn(step <= strength.score && `is-on is-${strength.score}`)} />
              ))}
            </div>
            <span className={`profile-strength__label is-${strength.score}`}>{strength.label}</span>
          </div>
        )}
        <Field label="Confirm new password" error={mismatch ? "Passwords don’t match." : undefined}>
          <PasswordInput value={form.confirm} autoComplete="new-password" invalid={mismatch} onChange={(confirm) => setForm({ ...form, confirm })} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !form.current || !form.next || !form.confirm}>
            <ShieldCheck size={15} /> {busy ? "Updating..." : "Update password"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Sessions() {
  const { logout } = useAuth();
  const { data: sessions, error, reload } = useApiQuery<Session[]>("/auth/sessions");
  const { run, busy } = useApiAction();
  const others = (sessions ?? []).filter((s) => !s.current);

  const signOut = async (session: Session) => {
    if (await run(() => api(`/auth/sessions/${session.id}`, { method: "DELETE" }), "Device signed out.")) void reload();
  };
  const signOutOthers = async () => {
    const ok = await confirmDialog({
      title: "Sign out all other devices?",
      description: "Every other browser or phone signed in to your account will need to sign in again.",
      confirmLabel: "Sign out others",
      tone: "danger",
    });
    if (ok && (await run(() => api("/auth/sessions/revoke-others", { method: "POST" }), "Other devices signed out."))) void reload();
  };

  return (
    <section className="profile-card">
      <header className="profile-card__head">
        <span className="profile-card__icon"><MonitorSmartphone size={15} /></span>
        <div className="min-w-0 flex-1">
          <h3>Signed-in devices</h3>
          <p>Sign out anywhere you don’t recognise.</p>
        </div>
      </header>
      {!sessions && error && <p className="text-sm text-red-600">{error}</p>}
      {!sessions && !error && <p className="text-sm text-gray-400">Loading devices…</p>}
      {sessions && (
        <ul className="profile-sessions">
          {sessions.map((session) => {
            const device = describeDevice(session.userAgent);
            const Icon = device.mobile ? Smartphone : LaptopMinimal;
            return (
              <li key={session.id} className={cn("profile-session", session.current && "is-current")}>
                <span className="profile-session__icon"><Icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-800">
                    {device.label}
                    {session.current && <span className="profile-session__badge">This device</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {session.ipAddress ? `${session.ipAddress} · ` : ""}Signed in {formatDateTime(session.createdAt)}
                  </p>
                </div>
                {session.current ? (
                  <Button size="sm" variant="outline" onClick={() => void logout()}>
                    <LogOut size={14} /> Sign out
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void signOut(session)} aria-label={`Sign out ${device.label}`}>
                    <LogOut size={14} /> Sign out
                  </Button>
                )}
              </li>
            );
          })}
          {sessions.length === 0 && <li className="text-sm text-gray-400">No active sessions.</li>}
        </ul>
      )}
      {others.length > 0 && (
        <Button variant="outline" className="profile-danger-btn mt-3 w-full" disabled={busy} onClick={() => void signOutOthers()}>
          Sign out all other devices ({others.length})
        </Button>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const { refresh } = useAuth();
  const { data: profile, error, reload, setData } = useApiQuery<Profile>("/auth/profile");
  const [sessionsKey, setSessionsKey] = useState(0);
  const facts = useMemo(
    () =>
      profile
        ? [
            { icon: BadgeCheck, label: "Role", value: humanize(profile.role) },
            { icon: CalendarDays, label: "Member since", value: formatDate(profile.createdAt) },
            { icon: KeyRound, label: "Password changed", value: profile.passwordChangedAt ? formatDate(profile.passwordChangedAt) : "Never" },
          ]
        : [],
    [profile],
  );

  if (!profile && error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!profile) return <Loading />;

  return (
    <div className="profile-page">
      <section className="profile-hero">
        <span className="profile-hero__avatar" aria-hidden>{initials(profile.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="profile-hero__eyebrow">My profile</p>
          <h2 className="profile-hero__name">{profile.name}</h2>
          <p className="profile-hero__email">
            <Mail size={13} aria-hidden /> {profile.email}
          </p>
        </div>
        <dl className="profile-hero__facts">
          {facts.map(({ icon: Icon, label, value }) => (
            <div key={label}>
              <dt><Icon size={12} aria-hidden /> {label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <PersonalDetails
            key={profile.name}
            profile={profile}
            onSaved={(updated) => {
              setData(updated);
              void refresh(); // Update the name shown in the top bar.
            }}
          />
          {profile.employee && (
            <section className="profile-card">
              <header className="profile-card__head">
                <span className="profile-card__icon"><Briefcase size={15} /></span>
                <div>
                  <h3>Employee record</h3>
                  <p>Linked by your administrator.</p>
                </div>
              </header>
              <dl className="profile-facts">
                <div><dt>Employee code</dt><dd>{profile.employee.code}</dd></div>
                <div><dt>Department</dt><dd>{profile.employee.department}</dd></div>
                <div><dt>Shift</dt><dd>{profile.employee.shift || "—"}</dd></div>
                <div><dt>Mobile</dt><dd>{profile.employee.mobile || "—"}</dd></div>
                <div><dt>Joined</dt><dd>{formatDate(profile.employee.joiningDate)}</dd></div>
              </dl>
            </section>
          )}
        </div>
        <div className="space-y-3">
          <ChangePassword
            onChanged={() => {
              void reload();
              setSessionsKey((k) => k + 1);
            }}
          />
          <Sessions key={sessionsKey} />
        </div>
      </div>
    </div>
  );
}
