"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Building2, CheckCircle2, Cog, Eye, Globe2, MapPin, Phone, RotateCcw, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { GSTIN_PATTERN, INDIAN_STATES, PAN_PATTERN, PINCODE_PATTERN, panFromGstin, stateForGstin } from "@/lib/india";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDateTime } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineMessage } from "@/components/ui/inline-message";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type Company = {
  name: string;
  legalName: string;
  gst: string;
  pan: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  currency: string;
  timezone: string;
};
type CompanyResponse = { value: Partial<Company>; updatedAt: string | null; updatedBy: string | null };
type Errors = Partial<Record<keyof Company, string>>;

const EMPTY: Company = {
  name: "",
  legalName: "",
  gst: "",
  pan: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
};
const KEYS = Object.keys(EMPTY) as Array<keyof Company>;

// Keep in sync with CURRENCIES in backend/src/admin/company-settings.dto.ts.
const CURRENCIES = [
  { code: "INR", label: "INR — Indian Rupee (₹)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — Pound Sterling (£)" },
  { code: "AED", label: "AED — UAE Dirham" },
];
const TIMEZONES = [
  { zone: "Asia/Kolkata", label: "India (IST, UTC+05:30)" },
  { zone: "Asia/Dubai", label: "Dubai (UTC+04:00)" },
  { zone: "Asia/Singapore", label: "Singapore (UTC+08:00)" },
  { zone: "Asia/Dhaka", label: "Dhaka (UTC+06:00)" },
  { zone: "Europe/London", label: "London (GMT/BST)" },
  { zone: "America/New_York", label: "New York (ET)" },
  { zone: "UTC", label: "UTC" },
];

/** Details that print on invoices, POs and delivery challans; the preview lists whichever are still empty. */
const PRINTED: Array<[keyof Company, string]> = [
  ["name", "Company name"],
  ["gst", "GSTIN"],
  ["pan", "PAN"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["address", "Street address"],
  ["city", "City"],
  ["state", "State"],
  ["pincode", "PIN code"],
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const WEBSITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

const toForm = (value: Partial<Company>): Company => {
  const form = { ...EMPTY };
  for (const key of KEYS) {
    const v = value[key];
    if (typeof v === "string") form[key] = v;
  }
  return form;
};
const trimmed = (form: Company): Company => {
  const out = { ...form };
  for (const key of KEYS) out[key] = form[key].trim();
  return out;
};

/** Mirrors the backend DTO so problems show next to the field before saving. */
function validate(f: Company): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = "Company name is required.";
  if (f.gst && !GSTIN_PATTERN.test(f.gst)) e.gst = "Enter a valid 15-character GSTIN.";
  if (f.pan && !PAN_PATTERN.test(f.pan)) e.pan = "PAN must look like ABCDE1234F.";
  if (!e.gst && !e.pan && f.gst && f.pan && panFromGstin(f.gst) !== f.pan) e.pan = "PAN doesn’t match the one inside the GSTIN.";
  if (f.email.trim() && !EMAIL.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (f.phone.trim() && !PHONE.test(f.phone.trim())) e.phone = "Enter a valid phone number.";
  if (f.website.trim() && !WEBSITE.test(f.website.trim())) e.website = "Enter a valid website address.";
  if (f.pincode.trim() && !PINCODE_PATTERN.test(f.pincode.trim())) e.pincode = "PIN code must be 6 digits.";
  return e;
}

function Section({ icon: Icon, title, caption, children }: { icon: typeof Building2; title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <Icon size={15} />
        </span>
        <div>
          <h3 className="settings-section__title">{title}</h3>
          <p className="settings-section__caption">{caption}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Full-page letterhead preview: how the company block will look at the top of printed documents. */
function PreviewDialog({ form, dirty, onClose }: { form: Company; dirty: boolean; onClose: () => void }) {
  const f = trimmed(form);
  const stateCode = INDIAN_STATES.find((s) => s.name === f.state)?.code;
  const cityLine = [f.city, [f.state, f.pincode].filter(Boolean).join(" – ")].filter(Boolean).join(", ");
  const contact = [f.phone, f.email, f.website].filter(Boolean);
  const missing = PRINTED.filter(([key]) => !f[key]).map(([, label]) => label);
  const timezone = TIMEZONES.find((t) => t.zone === f.timezone)?.label ?? f.timezone;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog settings-preview-dialog" aria-describedby="settings-preview-help">
          <div className="users-dialog__head">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-[#1b3c55]">Letterhead preview</Dialog.Title>
              <p id="settings-preview-help" className="text-xs text-gray-500">
                How your company details appear on invoices, purchase orders and challans.
              </p>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close preview">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="settings-preview-dialog__body">
            {dirty && (
              <p className="settings-preview-note">
                <AlertTriangle size={14} aria-hidden /> Showing unsaved changes — save to use them on documents.
              </p>
            )}

            <article className="settings-sheet" aria-label="Sample document">
              <header className="settings-sheet__head">
                <span className="settings-sheet__logo">
                  <Image src={BRAND.logo} alt="" width={64} height={64} className="h-full w-full object-cover" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("settings-sheet__name", !f.name && "is-empty")}>{f.name || "Company name"}</p>
                  {f.legalName && f.legalName !== f.name && <p className="settings-sheet__legal">{f.legalName}</p>}
                  <p className={cn("settings-sheet__line", !f.address && !cityLine && "is-empty")}>
                    {[f.address, cityLine].filter(Boolean).join(", ") || "Address not set"}
                  </p>
                  {contact.length > 0 && <p className="settings-sheet__line">{contact.join("  ·  ")}</p>}
                </div>
                <p className="settings-sheet__doc">Tax Invoice</p>
              </header>

              <dl className="settings-sheet__tax">
                <div>
                  <dt>GSTIN</dt>
                  <dd>{f.gst || "—"}</dd>
                </div>
                <div>
                  <dt>PAN</dt>
                  <dd>{f.pan || "—"}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>{f.state ? `${f.state}${stateCode ? ` (${stateCode})` : ""}` : "—"}</dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>{f.currency}</dd>
                </div>
              </dl>

              {/* Placeholder body so the header is seen in the context of a real page. */}
              <div className="settings-sheet__body" aria-hidden>
                <div className="settings-sheet__meta">
                  <span />
                  <span />
                </div>
                <div className="settings-sheet__table">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              </div>

              <footer className="settings-sheet__foot">
                <span>{timezone}</span>
                <span className="text-right">
                  For <strong>{f.legalName || f.name || "Company name"}</strong>
                  <br />
                  Authorised Signatory
                </span>
              </footer>
            </article>

            <div className={cn("settings-preview-check", missing.length ? "is-missing" : "is-complete")}>
              {missing.length ? (
                <>
                  <AlertTriangle size={15} aria-hidden />
                  <span>
                    <strong>Not filled yet:</strong> {missing.join(", ")}.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} aria-hidden />
                  <span>All printed details are filled in.</span>
                </>
              )}
            </div>
          </div>

          <div className="users-dialog__foot settings-preview-dialog__foot">
            <Dialog.Close asChild>
              <Button variant="outline">Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function Settings() {
  const { data, error, reload, setData } = useApiQuery<CompanyResponse>("/admin/settings/company");
  const saved = useMemo(() => (data ? toForm(data.value) : null), [data]);
  const [form, setForm] = useState<Company>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { message, run, reject, busy } = useApiAction();

  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  const errors = useMemo(() => validate(form), [form]);
  const dirty = saved ? KEYS.some((k) => form[k].trim() !== saved[k].trim()) : false;

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const set = (key: keyof Company, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const fieldError = (key: keyof Company) => (showErrors ? errors[key] : undefined);

  // A valid GSTIN already carries the state and PAN, so fill those in when they're empty.
  const setGst = (raw: string) => {
    const gst = raw.toUpperCase().replace(/\s/g, "");
    setForm((current) => {
      const next = { ...current, gst };
      if (GSTIN_PATTERN.test(gst)) {
        if (!current.pan) next.pan = panFromGstin(gst);
        if (!current.state) next.state = stateForGstin(gst) ?? "";
      }
      return next;
    });
  };

  const save = async () => {
    if (!dirty || busy) return;
    setShowErrors(true);
    const first = Object.values(errors)[0];
    if (first) return reject(first, "Check company details");
    const ok = await run(async () => {
      setData(await api<CompanyResponse>("/admin/settings/company", { method: "PUT", body: JSON.stringify(trimmed(form)) }));
    }, "Company settings saved.");
    if (ok) setShowErrors(false);
  };
  const discard = () => {
    if (saved) setForm(saved);
    setShowErrors(false);
  };

  // Ctrl/Cmd + S saves, like a desktop app.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!data && error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data || !saved) return <Loading />;

  const stateOptions = form.state && !INDIAN_STATES.some((s) => s.name === form.state) ? [form.state] : [];
  const timezoneOptions = TIMEZONES.some((t) => t.zone === form.timezone) ? TIMEZONES : [...TIMEZONES, { zone: form.timezone, label: form.timezone }];
  const gstState = GSTIN_PATTERN.test(form.gst) ? stateForGstin(form.gst) : undefined;
  const stateMismatch = Boolean(gstState && form.state && gstState !== form.state);

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <span className="settings-page-icon">
          <Cog size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold md:text-xl">Settings</h2>
          <p className="text-xs text-gray-500">Company profile, tax identity and regional preferences.</p>
        </div>
        <div className="settings-page-actions">
          <p className="settings-saved-meta">
            {dirty ? (
              <span className="settings-dirty-badge">Unsaved changes</span>
            ) : data.updatedAt ? (
              <>
                Last saved {formatDateTime(data.updatedAt)}
                {data.updatedBy ? ` by ${data.updatedBy}` : ""}
              </>
            ) : (
              "Not saved yet"
            )}
          </p>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} aria-haspopup="dialog">
            <Eye size={15} /> Preview
          </Button>
        </div>
      </div>

      <Card className="settings-card">
        <CardContent className="p-0">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {message && (
              <div className="px-4 pt-4 md:px-5">
                <InlineMessage message={message} />
              </div>
            )}

            <div className="settings-sections">
              <Section icon={Building2} title="Business identity" caption="How the company is named and registered for tax.">
                <Field label="Company name *" error={fieldError("name")}>
                  <Input value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(fieldError("name"))} />
                </Field>
                <Field label="Legal name" hint="If different">
                  <Input value={form.legalName} maxLength={160} placeholder="Registered business name" onChange={(e) => set("legalName", e.target.value)} />
                </Field>
                <Field label="GSTIN" hint="Fills state & PAN" error={fieldError("gst")}>
                  <Input
                    value={form.gst}
                    maxLength={15}
                    placeholder="33ABCDE1234F1Z5"
                    className="uppercase tracking-wide"
                    onChange={(e) => setGst(e.target.value)}
                    aria-invalid={Boolean(fieldError("gst"))}
                  />
                </Field>
                <Field label="PAN" error={fieldError("pan")}>
                  <Input
                    value={form.pan}
                    maxLength={10}
                    placeholder="ABCDE1234F"
                    className="uppercase tracking-wide"
                    onChange={(e) => set("pan", e.target.value.toUpperCase().replace(/\s/g, ""))}
                    aria-invalid={Boolean(fieldError("pan"))}
                  />
                </Field>
              </Section>

              <Section icon={Phone} title="Contact" caption="Where distributors and parties can reach you.">
                <Field label="Phone" error={fieldError("phone")}>
                  <Input type="tel" value={form.phone} maxLength={20} placeholder="+91 98765 43210" onChange={(e) => set("phone", e.target.value)} aria-invalid={Boolean(fieldError("phone"))} />
                </Field>
                <Field label="Email" error={fieldError("email")}>
                  <Input type="email" value={form.email} maxLength={254} placeholder="accounts@company.com" onChange={(e) => set("email", e.target.value)} aria-invalid={Boolean(fieldError("email"))} />
                </Field>
                <Field label="Website" error={fieldError("website")} className="sm:col-span-2">
                  <Input value={form.website} maxLength={200} placeholder="www.company.com" onChange={(e) => set("website", e.target.value)} aria-invalid={Boolean(fieldError("website"))} />
                </Field>
              </Section>

              <Section icon={MapPin} title="Address" caption="Registered or main factory address.">
                <Field label="Street address" className="sm:col-span-2">
                  <Input value={form.address} maxLength={300} placeholder="Door no., street, area" onChange={(e) => set("address", e.target.value)} />
                </Field>
                <Field label="City">
                  <Input value={form.city} maxLength={80} onChange={(e) => set("city", e.target.value)} />
                </Field>
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
                  <Field label="State">
                    <select className="erp-input" value={form.state} onChange={(e) => set("state", e.target.value)}>
                      <option value="">Select state</option>
                      {[...stateOptions, ...INDIAN_STATES.map((s) => s.name)].map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="PIN code" error={fieldError("pincode")}>
                    <Input inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, ""))} aria-invalid={Boolean(fieldError("pincode"))} />
                  </Field>
                </div>
                {stateMismatch && (
                  <p className="settings-hint sm:col-span-2">
                    <AlertTriangle size={13} aria-hidden />
                    <span>
                      The GSTIN is registered in <strong>{gstState}</strong>.{" "}
                      <button type="button" className="settings-hint__action" onClick={() => set("state", gstState ?? "")}>
                        Use {gstState}
                      </button>
                    </span>
                  </p>
                )}
              </Section>

              <Section icon={Globe2} title="Regional" caption="Currency and time zone for amounts and dates.">
                <Field label="Currency">
                  <select className="erp-input" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Time zone">
                  <select className="erp-input" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                    {timezoneOptions.map((t) => (
                      <option key={t.zone} value={t.zone}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>
            </div>

            <div className="settings-form-footer">
              <p className="settings-form-footer__tip">
                Press <kbd>Ctrl</kbd> + <kbd>S</kbd> to save
              </p>
              <Button variant="outline" disabled={!dirty || busy} onClick={discard}>
                <RotateCcw size={15} /> Discard
              </Button>
              <Button type="submit" className="settings-action-btn" disabled={!dirty || busy}>
                <Save size={15} /> {busy ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {previewOpen && <PreviewDialog form={form} dirty={dirty} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
