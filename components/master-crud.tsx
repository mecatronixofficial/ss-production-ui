"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Power, Search, Trash2, X, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { toast } from "@/lib/toast-store";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { EDIT_PARAM, useNewParam } from "@/lib/use-new-param";
import { cn } from "@/lib/utils";
import { DataTable, serialColumn } from "./data-table";
import { Loading } from "./loading";
import { ErrorState } from "./page-state";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { InlineMessage } from "./ui/inline-message";

export type MasterField<F> = {
  key: keyof F & string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "date" | "select";
  options?: readonly string[];
  /** Display text for a select option; the stored value is sent unchanged. */
  optionLabel?: (value: string) => string;
  required?: boolean;
  placeholder?: string;
  /** Short note shown beside the label, e.g. "Optional". */
  hint?: string;
  /** Heading the field is grouped under in the dialog form; consecutive fields with the same section share it. */
  section?: string;
  wide?: boolean;
  /** Assigned by the server on create (e.g. an auto-numbered code): read-only and not sent when adding, editable when editing. */
  generated?: boolean;
  /** Longest value the API accepts. */
  maxLength?: number;
  /** Typed in capitals with spaces removed (codes, GSTIN, PAN). */
  uppercase?: boolean;
  /** Called with the new value when the field changes; returns other fields to fill (e.g. the state from a GSTIN). */
  fills?: (value: string, form: Record<string, string>) => Record<string, string> | undefined;
};

/** A problem with the form, shown on the field it belongs to. */
export type MasterProblem<F> = { key: keyof F & string; text: string } | null | undefined;

type FormValues = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generic list + add/edit/delete screen for master data.
 * `prefix` selects the existing page styles in globals.css (e.g. `mills` → `.mills-list-page`).
 */
export function MasterCrud<T extends { id: string }, F extends FormValues>({
  prefix,
  title,
  description,
  entity,
  endpoint,
  listEndpoint = endpoint,
  fields,
  blank,
  toForm,
  columns,
  searchPlaceholder,
  canEdit = true,
  canDelete = true,
  describe,
  summary,
  onChanged,
  loadDefaults,
  activeField,
  activeHint = "",
  dialog,
  validate,
  headerActions,
}: {
  prefix: string;
  title: string;
  description: string;
  entity: string;
  endpoint: string;
  /** Where the list is loaded from when it differs from `endpoint` (which create / update / delete use). */
  listEndpoint?: string;
  fields: MasterField<F>[];
  blank: F;
  toForm: (row: T) => F;
  columns: ColumnDef<T>[];
  searchPlaceholder: string;
  canEdit?: boolean;
  canDelete?: boolean;
  describe: (row: T) => string;
  /** Rendered between the header and the form (e.g. stat tiles); a function receives the loaded rows. */
  summary?: React.ReactNode | ((rows: T[]) => React.ReactNode);
  /** Called after a successful create / update / delete. */
  onChanged?: () => void;
  /** Values fetched when the Add form opens (e.g. a preview of the next generated code). */
  loadDefaults?: () => Promise<Partial<F>>;
  /**
   * Boolean field for records that are never deleted: each row gets an Active / Inactive switch instead,
   * and the list can be filtered by it. Pass `canDelete={false}` alongside.
   */
  activeField?: keyof T & string;
  /** Added to the "mark inactive" confirmation, e.g. what an inactive record can no longer be used for. */
  activeHint?: string;
  /** Open Add / Edit in a modal window instead of the inline panel. */
  dialog?: { icon: LucideIcon; caption?: string };
  /** Page-specific checks run before saving (after required and email), mirroring the API's rules. */
  validate?: (form: F, context: { rows: T[]; editingId: string | null }) => MasterProblem<F>;
  /** Extra buttons in the header beside "Add" (e.g. an export), given the rows shown. */
  headerActions?: (rows: T[]) => React.ReactNode;
}) {
  const { data: rows, error, reload } = useApiQuery<T[]>(listEndpoint);
  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [form, setForm] = useState<F>(blank);
  // The field a validation message belongs to; cleared as soon as it is edited.
  const [invalid, setInvalid] = useState<{ key: string; text: string } | null>(null);
  const { message, setMessage, run, reject, busy } = useApiAction();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Bumped whenever the panel opens or closes, so late defaults from an earlier Add are dropped.
  const panelSession = useRef(0);
  const locked = (field: MasterField<F>) => Boolean(field.generated && !editingId);

  const closePanel = () => {
    panelSession.current++;
    setInvalid(null);
    if (message?.error) setMessage(null);
    setShow(false);
    setEditingId(null);
    setForm(blank);
  };

  const startAdd = () => {
    const session = ++panelSession.current;
    setInvalid(null);
    setMessage(null);
    setEditingId(null);
    setForm(blank);
    setShow(true);
    loadDefaults?.()
      .then((defaults) => {
        if (panelSession.current !== session) return;
        // Don't overwrite anything typed while the defaults were loading.
        setForm((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(defaults)) {
            if (value !== undefined && current[key] === blank[key]) (next as FormValues)[key] = value;
          }
          return next;
        });
      })
      .catch(() => {}); // The placeholder already says the value is assigned on save.
  };

  // Quick-create menu links here with `?new=1`.
  useNewParam(startAdd);

  // `?edit=<id>` (e.g. from a record's own page) opens that record's Edit form once the list has loaded.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const editParam = params.get(EDIT_PARAM);
  useEffect(() => {
    if (!editParam || !rows) return;
    const row = rows.find((r) => r.id === editParam);
    if (row && canEdit) handlersRef.current.startEdit(row);
    router.replace(pathname, { scroll: false });
  }, [editParam, rows, canEdit, router, pathname]);

  // Bring the form into view and focus its first field when it opens.
  const focusPanel = useCallback((panel: HTMLFormElement | null) => {
    panel?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)")?.focus();
  }, []);

  // The action column is memoised, so it calls the latest handlers through a ref.
  const handlersRef = useRef({
    startEdit: (_row: T) => {},
    remove: async (_row: T) => {},
    toggleActive: async (_row: T) => {},
  });
  handlersRef.current = {
    startEdit: (row) => {
      panelSession.current++;
      setInvalid(null);
      setMessage(null);
      setEditingId(row.id);
      setForm(toForm(row));
      setShow(true);
    },
    remove: async (row) => {
      const ok = await confirmDialog({
        title: `Delete ${entity.toLowerCase()} “${describe(row)}”?`,
        description: "This cannot be undone. Records that reference it may block deletion.",
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!ok) return;
      if (await run(() => api(`${endpoint}/${row.id}`, { method: "DELETE" }), `${describe(row)} deleted.`)) {
        void reload();
        onChanged?.();
      }
    },
    toggleActive: async (row) => {
      if (!activeField) return;
      const activate = !row[activeField];
      const name = describe(row);
      const ok = await confirmDialog({
        title: activate ? `Mark “${name}” active?` : `Mark “${name}” inactive?`,
        description: activate
          ? "It can be used again for new records."
          : `It stays in the list with its code and history, and can be made active again at any time.${activeHint ? ` ${activeHint}` : ""}`,
        confirmLabel: activate ? "Mark active" : "Mark inactive",
        tone: activate ? undefined : "danger",
      });
      if (!ok) return;
      const done = await run(
        () => api(`${endpoint}/${row.id}`, { method: "PATCH", body: JSON.stringify({ [activeField]: activate }) }),
        `${name} marked ${activate ? "active" : "inactive"}.`,
      );
      if (done) {
        void reload();
        onChanged?.();
      }
    },
  };

  const cols = useMemo<ColumnDef<T>[]>(() => {
    const base: ColumnDef<T>[] = [serialColumn<T>(), ...columns];
    if (!canEdit && !canDelete && !activeField) return base;
    return [
      ...base,
      {
        header: "Actions",
        id: "actions",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <div className={`${prefix}-row-actions flex items-center justify-end gap-1.5`}>
            {canEdit && (
              <button
                type="button"
                className={`${prefix}-row-action ${prefix}-row-action--edit`}
                onClick={() => handlersRef.current.startEdit(row.original)}
                aria-label={`Edit ${describe(row.original)}`}
              >
                <Pencil size={14} />
              </button>
            )}
            {activeField && (
              <button
                type="button"
                className={cn(`${prefix}-row-action ${prefix}-row-action--toggle`, !row.original[activeField] && "is-inactive")}
                onClick={() => void handlersRef.current.toggleActive(row.original)}
                aria-label={`Mark ${describe(row.original)} ${row.original[activeField] ? "inactive" : "active"}`}
                title={row.original[activeField] ? "Mark inactive" : "Mark active"}
              >
                <Power size={14} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className={`${prefix}-row-action ${prefix}-row-action--delete`}
                onClick={() => void handlersRef.current.remove(row.original)}
                aria-label={`Delete ${describe(row.original)}`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ),
      },
    ];
  }, [columns, canEdit, canDelete, activeField, prefix, describe]);

  const save = async () => {
    const missing = fields.find((f) => f.required && !locked(f) && !form[f.key]?.trim());
    if (missing) {
      setInvalid({ key: missing.key, text: `${missing.label} is required.` });
      return reject(`${missing.label} is required.`, `Check ${entity.toLowerCase()}`);
    }
    const badEmail = fields.find((f) => f.type === "email" && form[f.key]?.trim() && !EMAIL.test(form[f.key].trim()));
    if (badEmail) {
      setInvalid({ key: badEmail.key, text: `Enter a valid ${badEmail.label.toLowerCase()}.` });
      return reject(`Enter a valid ${badEmail.label.toLowerCase()}.`, `Check ${entity.toLowerCase()}`);
    }
    const badNumber = fields.find((f) => f.type === "number" && form[f.key]?.trim() && !Number.isFinite(Number(form[f.key].trim())));
    if (badNumber) {
      setInvalid({ key: badNumber.key, text: `${badNumber.label} must be a number.` });
      return reject(`${badNumber.label} must be a number.`, `Check ${entity.toLowerCase()}`);
    }
    const problem = validate?.(form, { rows: rows ?? [], editingId });
    if (problem) {
      setInvalid(problem);
      return reject(problem.text, `Check ${entity.toLowerCase()}`);
    }
    setInvalid(null);

    // POST: omit empty optional fields. PATCH: send null so a cleared field is actually cleared.
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      if (locked(field)) continue;
      const raw = form[field.key]?.trim() ?? "";
      if (!raw) {
        if (editingId && !field.required) body[field.key] = null;
        continue;
      }
      body[field.key] = field.type === "number" ? Number(raw) : raw;
    }
    let created: Record<string, unknown> | undefined;
    const ok = await run(
      async () => {
        if (editingId) await api(`${endpoint}/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        else created = await api<Record<string, unknown>>(endpoint, { method: "POST", body: JSON.stringify(body) });
      },
      editingId ? `${entity} updated.` : undefined,
    );
    if (ok && !editingId) {
      // Name the value the server actually assigned; it can differ from the preview if someone else saved first.
      const generated = fields.find((f) => f.generated && created?.[f.key]);
      const text = generated ? `${entity} created with ${generated.label.toLowerCase()} ${String(created![generated.key])}.` : `${entity} created.`;
      setMessage({ text, error: false });
      toast.success(text);
    }
    if (ok) {
      closePanel();
      void reload();
      onChanged?.();
    }
  };

  const setField = (key: string, raw: string) => {
    const field = fields.find((f) => f.key === key);
    const value = field?.uppercase ? raw.toUpperCase().replace(/\s/g, "") : raw;
    setForm((current) => ({ ...current, [key]: value, ...field?.fills?.(value, current) }));
    setInvalid((current) => (current?.key === key ? null : current));
  };

  const renderField = (field: MasterField<F>) => {
    const fieldError = invalid?.key === field.key ? invalid.text : undefined;
    return (
      <Field
        key={field.key}
        label={field.required && !locked(field) ? `${field.label} *` : field.label}
        hint={locked(field) ? "Assigned on save" : field.hint}
        error={fieldError}
        className={cn(field.wide && (dialog ? "sm:col-span-2" : "md:col-span-2"))}
      >
        {field.type === "select" ? (
          <select
            className="erp-input"
            value={form[field.key]}
            aria-invalid={Boolean(fieldError)}
            onChange={(e) => setField(field.key, e.target.value)}
          >
            {!field.required && <option value="">—</option>}
            {/* Keep legacy values that aren't in the option list selectable. */}
            {[...(field.options ?? []), ...(form[field.key] && !field.options?.includes(form[field.key]) ? [form[field.key]] : [])].map((option) => (
              <option key={option} value={option}>
                {field.optionLabel?.(option) ?? option}
              </option>
            ))}
          </select>
        ) : (
          <Input
            type={field.type ?? "text"}
            value={form[field.key]}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            className={cn(field.uppercase && "uppercase tracking-wide")}
            required={field.required && !locked(field)}
            disabled={locked(field)}
            aria-invalid={Boolean(fieldError)}
            onChange={(e) => setField(field.key, e.target.value)}
          />
        )}
      </Field>
    );
  };

  // Consecutive fields with the same `section` share one heading in the dialog.
  const sections: Array<{ title?: string; fields: MasterField<F>[] }> = [];
  for (const field of fields) {
    const last = sections[sections.length - 1];
    if (last && last.title === field.section) last.fields.push(field);
    else sections.push({ title: field.section, fields: [field] });
  }
  // Title the edit window with the saved name, not the one being typed.
  const editingRow = editingId ? rows?.find((row) => row.id === editingId) : undefined;

  if (!rows && error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!rows) return <Loading />;

  return (
    <div className={`${prefix}-list-page`}>
      <div className={`${prefix}-list-header flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`${prefix}-search flex items-center gap-2`}>
            <Search className="text-gray-400" size={17} aria-hidden />
            <Input
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {activeField && (
            <select
              className="erp-input w-auto"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Filter by status"
            >
              <option value="all">All ({rows.length})</option>
              <option value="active">Active ({rows.filter((r) => r[activeField]).length})</option>
              <option value="inactive">Inactive ({rows.filter((r) => !r[activeField]).length})</option>
            </select>
          )}
          {headerActions?.(activeField && statusFilter !== "all" ? rows.filter((r) => Boolean(r[activeField]) === (statusFilter === "active")) : rows)}
          <Button className={`${prefix}-add-btn`} onClick={startAdd}>
            <Plus size={16} />
            Add {entity}
          </Button>
        </div>
      </div>
      <InlineMessage message={dialog && show ? null : message} />
      {typeof summary === "function" ? summary(rows) : summary}
      {show && !dialog && (
        <form
          ref={focusPanel}
          noValidate
          className={`${prefix}-add-panel`}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className={`${prefix}-add-panel__header`}>
            <h3>{editingId ? `Edit ${entity}` : `Add ${entity}`}</h3>
            <button type="button" className={`${prefix}-add-panel__close`} onClick={closePanel} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {fields.map(renderField)}
            <div className="flex items-end">
              <Button type="submit" className={`${prefix}-save-btn w-full`} disabled={busy}>
                {busy ? "Saving..." : editingId ? `Update ${entity}` : `Save ${entity}`}
              </Button>
            </div>
          </div>
        </form>
      )}
      {show && dialog && (
        <Dialog.Root open onOpenChange={(open) => !open && !busy && closePanel()}>
          <Dialog.Portal>
            <Dialog.Overlay className="users-dialog__overlay" />
            <Dialog.Content
              ref={dialogRef}
              className={`users-dialog master-dialog ${prefix}-dialog`}
              aria-describedby={dialog.caption ? "master-dialog-caption" : undefined}
              onOpenAutoFocus={(event) => {
                // Start at the first empty field (the name, once a code is suggested) rather than the close button.
                event.preventDefault();
                const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not(:disabled), select:not(:disabled)") ?? []);
                (controls.find((control) => !control.value) ?? controls[0])?.focus();
              }}
            >
              <div className="users-dialog__head">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="master-dialog__icon">
                    <dialog.icon size={17} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <Dialog.Title className="master-dialog__title truncate">
                      {editingId && editingRow ? `Edit ${entity.toLowerCase()} · ${describe(editingRow)}` : `Add ${entity.toLowerCase()}`}
                    </Dialog.Title>
                    {dialog.caption && (
                      <Dialog.Description id="master-dialog-caption" className="text-xs text-gray-500">
                        {dialog.caption}
                      </Dialog.Description>
                    )}
                  </div>
                </div>
                <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}>
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
                {message?.error && (
                  <p className="master-dialog__alert" role="alert">
                    {message.text}
                  </p>
                )}
                {sections.map((group, index) => (
                  <section key={group.title ?? index} className="master-dialog__section">
                    {group.title && <h4 className="master-dialog__section-title">{group.title}</h4>}
                    <div className="grid gap-3 sm:grid-cols-2">{group.fields.map(renderField)}</div>
                  </section>
                ))}
                <div className="users-dialog__foot items-center">
                  <Button type="button" variant="outline" onClick={closePanel} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" className={`${prefix}-save-btn`} disabled={busy}>
                    {busy ? "Saving..." : editingId ? "Save changes" : `Add ${entity.toLowerCase()}`}
                  </Button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <DataTable
        data={activeField && statusFilter !== "all" ? rows.filter((r) => Boolean(r[activeField]) === (statusFilter === "active")) : rows}
        columns={cols}
        filter={filter}
        onFilterChange={setFilter}
        hideSearch
        getRowId={(row) => row.id}
        emptyTitle={`No ${title.toLowerCase()} yet`}
        emptyDescription={`Use “Add ${entity}” to create the first record.`}
      />
    </div>
  );
}
