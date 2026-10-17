"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, Download, Eye, Layers, Pencil, Plus, Scale, Search, Trash2, Warehouse as WarehouseIcon, X } from "lucide-react";
import { parseSort, sortRows, SortMenu } from "./sort-menu";
import { DatePick } from "./date-pick";
import { api, qs } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { downloadCsv } from "@/lib/csv";
import { ADMIN_ROLES, GODOWN_EDIT_ROLES } from "@/lib/navigation";
import { type PurchaseOrder } from "@/lib/purchases";
import { toast } from "@/lib/toast-store";
import type { StockCategory, Warehouse } from "@/lib/types";
import { useApiAction } from "@/lib/use-api-action";
import { useApiQuery } from "@/lib/use-api-query";
import { useNewParam } from "@/lib/use-new-param";
import { quantity, stockText } from "@/lib/warehouses";
import { cn, formatDate, formatDateTime, humanize, kg, money, todayInput, toNumber, unitQty } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { DataTable, serialColumn } from "@/components/data-table";
import { ReceiveDialog, receiptSummary } from "@/components/receive-dialog";
import { ReceivedChallanDialog } from "@/components/received-challan";
import { DeliveryChallanDialog } from "@/components/delivery-challan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { itemHref } from "./item-details";
import { ReceiveFabricDialog, type IncomingFabric } from "./receive-fabric-dialog";
import { DispatchDialog } from "./dispatch-dialog";
import { ActionCenter } from "./action-center";
import { WarehousePicker } from "./warehouse-picker";
import { BILL_SHORT, StockBillDialog, type StockBillKind } from "@/components/stock-bill";
import { ShareMenu } from "@/components/share-menu";
import { warehouseShare } from "@/lib/challan-share";
import { PARTY_LABEL, type Sale } from "@/lib/sales";
import { WarehouseManager } from "./warehouse-manager";

// The godown only holds yarn and fabric.
const GODOWN_CATEGORIES: StockCategory[] = ["YARN", "GREY_FABRIC", "DYED_FABRIC", "FINISHED_FABRIC"];
/** Every material a warehouse can hold, in tab order. Only yarn and fabric take manual entries; the rest come from purchases. */
const ALL_CATEGORIES: StockCategory[] = [...GODOWN_CATEGORIES, "RAW_MATERIAL", "CHEMICAL", "PACKING"];
const isGodownCategory = (category: string) => GODOWN_CATEGORIES.includes(category as StockCategory);
/** Net stock per unit as text, e.g. "1,200.000 KG · 40.000 CONE". */
const totalsText = (rows: Array<{ unit: string; balanceKg: number }>) => {
  const totals: Record<string, number> = {};
  for (const row of rows) totals[row.unit] = (totals[row.unit] ?? 0) + row.balanceKg;
  return stockText({ totals }) === "Empty" ? "0.000 KG" : stockText({ totals });
};
/** Sum of one quantity per unit, as text: "120.000 KG · 40.000 CONE" ("0.000 KG" when there is nothing). */
const unitTotalsText = <T extends { unit: string }>(rows: T[], pick: (row: T) => number) => {
  const totals: Record<string, number> = {};
  for (const row of rows) totals[row.unit] = (totals[row.unit] ?? 0) + pick(row);
  return stockText({ totals }) === "Empty" ? "0.000 KG" : stockText({ totals });
};
/** Entries made on this page; other movements were posted by another module (e.g. purchase receipts). */
const GODOWN_ENTRY = "GODOWN_ENTRY";

type View = "stock" | "history" | "sold" | "bills";

/** One line sold from this warehouse (a dispatched sale's item), for the Sold view. */
type SoldLine = {
  id: string;
  saleId: string;
  saleNo: string;
  /** Delivery challan it left on. */
  challanNo: string | null;
  dispatchedAt: string;
  partyName: string;
  partyType: Sale["partyType"];
  vehicleNo: string | null;
  category: StockCategory;
  itemCode: string;
  itemName: string;
  lotNo: string | null;
  unit: string;
  quantity: number;
  amount: number | null;
};

/** A row of the Challans view. */
type BillRow = {
  id: string;
  billNo: string;
  kind: StockBillKind;
  createdAt: string;
  partyName: string | null;
  vehicleNo: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  warehouse: { id: string; code: string; name: string };
  lines: number;
  /** Item names on it, and the total per unit. */
  items: string[];
  totals: Record<string, number>;
  source: { label: string };
};
type Direction = "IN" | "OUT";

/** Reasons an entry can give; must match ENTRY_TYPES in the API. */
const ENTRY_TYPES: Record<Direction, Array<{ value: string; label: string }>> = {
  IN: [
    { value: "PURCHASE_IN", label: "Received" },
    { value: "OPENING", label: "Opening stock" },
    { value: "RETURN_IN", label: "Returned" },
    { value: "ADJUSTMENT", label: "Adjustment" },
  ],
  OUT: [
    { value: "PRODUCTION_ISSUE", label: "Issued to production" },
    { value: "DISPATCH_OUT", label: "Sold / sent out" },
    { value: "WASTE", label: "Waste" },
    { value: "ADJUSTMENT", label: "Adjustment" },
  ],
};

type Balance = {
  category: string;
  itemCode: string;
  itemName: string;
  lotNo?: string | null;
  warehouseId: string;
  quantityIn: number;
  quantityOut: number;
  /** In `unit` (KG unless a purchase was made in cones, bags…). */
  balanceKg: number;
  unit: string;
  /** When the item last moved in or out (for sorting by date). */
  lastMovedAt?: string | null;
};

type Txn = {
  id: string;
  category: StockCategory;
  txnType: string;
  itemCode: string;
  itemName: string;
  lotNo?: string | null;
  warehouseId: string;
  quantityIn: string;
  quantityOut: string;
  unit: string;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
  createdAt: string;
  warehouse: { code: string; name: string };
  /** The received / export bill this movement is on (issued by an admin). */
  stockBill: { id: string; billNo: string; kind: StockBillKind } | null;
  /** Cleared by an admin as needing no bill (an old movement). */
  billWaivedAt?: string | null;
};

type EntryForm = {
  direction: Direction;
  category: StockCategory;
  txnType: string;
  itemName: string;
  lotNo: string;
  warehouseId: string;
  quantityKg: string;
  entryDate: string;
  notes: string;
};

/** Balances under this are treated as zero (3-decimal rounding). */
const EMPTY = 0.0005;
const decimals = (value: string) => (value.split(".")[1] ?? "").length;

type EntryMode = { kind: "create"; preset?: Partial<EntryForm> } | { kind: "edit"; txn: Txn };

/** Local `YYYY-MM-DD` for a date input. */
const dateInput = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const referenceLabel = (t: Txn) => (t.referenceType === GODOWN_ENTRY ? `Godown entry · ${t.referenceId}` : humanize(t.referenceType));

/** An item shown by its code; clicking opens the item's own page with its full details. */
function ItemCodeLink({ code, warehouseId }: { code: string; warehouseId: string }) {
  return (
    <Link href={itemHref(code, warehouseId)} className="warehouses-code" title="Open this item's full details">
      {code}
    </Link>
  );
}

function Tabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex rounded-xl border border-gray-200 bg-white p-1" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold",
            value === option.value ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function EntryDialog({
  mode,
  warehouses,
  onClose,
  onSaved,
}: {
  mode: EntryMode;
  warehouses: Warehouse[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = mode.kind === "edit" ? mode.txn : null;
  const activeWarehouses = warehouses.filter((w) => w.active !== false);
  const [f, setF] = useState<EntryForm>(() => {
    if (editing) {
      const direction: Direction = toNumber(editing.quantityIn) > 0 ? "IN" : "OUT";
      return {
        direction,
        category: editing.category,
        txnType: editing.txnType,
        itemName: editing.itemName,
        lotNo: editing.lotNo ?? "",
        warehouseId: editing.warehouseId,
        quantityKg: String(toNumber(direction === "IN" ? editing.quantityIn : editing.quantityOut)),
        entryDate: dateInput(editing.createdAt),
        notes: editing.notes ?? "",
      };
    }
    const preset = mode.kind === "create" ? mode.preset : undefined;
    const direction = preset?.direction ?? "IN";
    return {
      direction,
      category: preset?.category ?? "YARN",
      txnType: ENTRY_TYPES[direction][0].value,
      itemName: preset?.itemName ?? "",
      lotNo: preset?.lotNo ?? "",
      warehouseId: preset?.warehouseId ?? (activeWarehouses.length === 1 ? activeWarehouses[0].id : ""),
      quantityKg: "",
      entryDate: todayInput(),
      notes: "",
    };
  });
  const { message, run, reject, busy } = useApiAction();
  const posted = editing && editing.referenceType !== GODOWN_ENTRY ? editing : null;
  const editingIn = editing ? toNumber(editing.quantityIn) > 0 : false;
  // An old movement may carry a type the form doesn't offer (e.g. knitting issue); let it keep that type.
  const reasons =
    editing && editingIn === (f.direction === "IN") && !ENTRY_TYPES[f.direction].some((type) => type.value === editing.txnType)
      ? [{ value: editing.txnType, label: humanize(editing.txnType) }, ...ENTRY_TYPES[f.direction]]
      : ENTRY_TYPES[f.direction];
  const set = (changes: Partial<EntryForm>) => setF((current) => ({ ...current, ...changes }));

  // Existing items and lots in this material, for suggestions and the current balance.
  const { data: balances = [] } = useApiQuery<Balance[]>(`/inventory/balances${qs({ category: f.category })}`);
  const items = useMemo(() => {
    const byCode = new Map<string, { itemCode: string; itemName: string }>();
    for (const row of balances) if (!byCode.has(row.itemCode)) byCode.set(row.itemCode, { itemCode: row.itemCode, itemName: row.itemName });
    return [...byCode.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [balances]);
  const typedName = f.itemName.trim().toLowerCase();
  const matched = items.find((item) => item.itemName.toLowerCase() === typedName);
  // Keep an edited entry's code while its name is unchanged, so it stays on the same stock row.
  const itemCode =
    editing && editing.category === f.category && editing.itemName.toLowerCase() === typedName ? editing.itemCode : matched?.itemCode;
  const lots = useMemo(
    () => [...new Set(balances.filter((row) => row.itemCode === itemCode && row.lotNo).map((row) => row.lotNo as string))],
    [balances, itemCode],
  );
  const currentBalance =
    itemCode && f.warehouseId
      ? balances
          .filter((row) => row.itemCode === itemCode && row.warehouseId === f.warehouseId && (row.lotNo ?? "") === f.lotNo.trim())
          .reduce((sum, row) => sum + row.balanceKg, 0)
      : null;

  // Issuing (not editing) more than this warehouse and lot holds; the API refuses to go below zero.
  const overIssue =
    !editing && f.direction === "OUT" && f.itemName.trim() !== "" && f.warehouseId !== "" && Number(f.quantityKg) > (currentBalance ?? 0) + EMPTY;

  const save = async () => {
    const quantityKg = Number(f.quantityKg);
    if (!f.itemName.trim()) return reject("Enter the item name.");
    if (!f.warehouseId) return reject("Choose a warehouse.");
    if (!(quantityKg > 0)) return reject("Enter a quantity above 0 KG.");
    if (decimals(f.quantityKg) > 3) return reject("Use up to 3 decimals for the quantity.");
    if (overIssue) {
      return reject(
        currentBalance === null || currentBalance <= EMPTY
          ? `There is no ${f.itemName.trim()}${f.lotNo.trim() ? ` (lot ${f.lotNo.trim()})` : ""} in this warehouse to issue.`
          : `Only ${kg(currentBalance)} in stock in this warehouse${f.lotNo.trim() ? " and lot" : ""}.`,
      );
    }
    // Keep the original time when the date is unchanged; today means "now"; other days are recorded at midday.
    const entryDate =
      editing && f.entryDate === dateInput(editing.createdAt)
        ? editing.createdAt
        : !editing && f.entryDate === todayInput()
          ? undefined
          : new Date(`${f.entryDate}T12:00:00`).toISOString();
    const body = {
      direction: f.direction,
      category: f.category,
      txnType: f.txnType,
      itemName: f.itemName.trim(),
      itemCode,
      lotNo: f.lotNo.trim() || undefined,
      warehouseId: f.warehouseId,
      quantityKg: Math.round(quantityKg * 1000) / 1000,
      entryDate,
      notes: f.notes.trim() || undefined,
    };
    const label = `${kg(body.quantityKg)} ${f.itemName.trim()}`;
    const ok = await run(
      () =>
        editing
          ? api(`/inventory/entries/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
          : api("/inventory/entries", { method: "POST", body: JSON.stringify(body) }),
      editing ? "Entry updated." : f.direction === "IN" ? `${label} received.` : `${label} issued.`,
    );
    if (ok) onSaved();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">
              {editing ? `Edit entry ${editing.referenceId}` : "New godown entry"}
            </Dialog.Title>
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
            {posted && (
              <p className="users-note">
                Posted by {humanize(posted.referenceType).toLowerCase()}
                {posted.notes ? ` (${posted.notes})` : ""}. Correcting it here changes godown stock only; the source record stays as it is.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Tabs<Direction>
                label="Direction"
                value={f.direction}
                options={[
                  { value: "IN", label: "Stock in" },
                  { value: "OUT", label: "Stock out" },
                ]}
                onChange={(direction) =>
                  set({ direction, txnType: editing && editingIn === (direction === "IN") ? editing.txnType : ENTRY_TYPES[direction][0].value })
                }
              />
              <Tabs<StockCategory>
                label="Material"
                value={f.category}
                options={GODOWN_CATEGORIES.map((value) => ({ value, label: humanize(value) }))}
                onChange={(category) => set({ category })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Item *" hint={itemCode ? itemCode : f.itemName.trim() ? "New item" : undefined}>
                <Input
                  value={f.itemName}
                  maxLength={120}
                  list="godown-items"
                  placeholder={f.category === "YARN" ? "e.g. 30s Combed Cotton" : "e.g. Single Jersey 180 GSM"}
                  onChange={(e) => set({ itemName: e.target.value })}
                  autoComplete="off"
                />
                <datalist id="godown-items">
                  {items.map((item) => (
                    <option key={item.itemCode} value={item.itemName} />
                  ))}
                </datalist>
              </Field>
              <Field label="Reason">
                <select className="erp-input" value={f.txnType} onChange={(e) => set({ txnType: e.target.value })}>
                  {reasons.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Warehouse *">
                <select className="erp-input" value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
                  <option value="">Choose…</option>
                  {warehouses
                    .filter((w) => w.active !== false || w.id === editing?.warehouseId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} · {w.name}
                        {w.active === false ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Lot no" hint="Optional">
                <Input value={f.lotNo} maxLength={60} list="godown-lots" onChange={(e) => set({ lotNo: e.target.value })} autoComplete="off" />
                <datalist id="godown-lots">
                  {lots.map((lot) => (
                    <option key={lot} value={lot} />
                  ))}
                </datalist>
              </Field>
              <Field
                label="Quantity (KG) *"
                hint={currentBalance !== null ? `In stock: ${kg(currentBalance)}` : undefined}
                error={overIssue && f.quantityKg ? (currentBalance && currentBalance > EMPTY ? `Only ${kg(currentBalance)} in stock here.` : "None in stock here.") : undefined}
              >
                <span className="flex gap-1.5">
                  <WeightInput
                    wrapperClassName="flex-1"
                    value={f.quantityKg}
                    onValueChange={(quantityKg) => set({ quantityKg })}
                    aria-invalid={overIssue && Boolean(f.quantityKg)}
                  />
                  {!editing && f.direction === "OUT" && currentBalance !== null && currentBalance > EMPTY && (
                    <Button size="sm" variant="outline" className="h-auto shrink-0" title="Issue everything in stock" onClick={() => set({ quantityKg: String(Math.round(currentBalance * 1000) / 1000) })}>
                      All
                    </Button>
                  )}
                </span>
              </Field>
              <Field label="Date">
                <Input type="date" value={f.entryDate} max={todayInput()} onChange={(e) => set({ entryDate: e.target.value || todayInput() })} />
              </Field>
            </div>
            <Field label="Notes" hint="Optional">
              <Input value={f.notes} maxLength={500} placeholder="Party, vehicle, reference no…" onChange={(e) => set({ notes: e.target.value })} />
            </Field>

            <div className="users-dialog__foot">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || (overIssue && Boolean(f.quantityKg))}>
                <Check size={15} />
                {busy ? "Saving..." : editing ? "Save changes" : f.direction === "IN" ? "Add stock" : "Issue stock"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Most movements the ledger returns at once (LEDGER_LIMIT in the API). */
const LEDGER_LIMIT = 500;

/** ISO start / end of a local `YYYY-MM-DD` day, for the ledger's date range. */
const dayStart = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const dayEnd = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);

/** `?warehouse=all` lists every warehouse (with add / edit / delete); otherwise the page shows one warehouse's stock. */
const ALL = "all";
/** The warehouse this viewer looked at last, opened when the page has no `?warehouse=`. */
const LAST_WAREHOUSE_KEY = "erp:warehouses:last";

const rememberedWarehouse = () => {
  try {
    return localStorage.getItem(LAST_WAREHOUSE_KEY) ?? "";
  } catch {
    return "";
  }
};

function Warehouses() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const canEdit = !!user && GODOWN_EDIT_ROLES.includes(user.role);
  const canManageWarehouses = !!user && ADMIN_ROLES.includes(user.role);
  const categoryParam = params.get("category") as StockCategory | null;
  const category = categoryParam && ALL_CATEGORIES.includes(categoryParam) ? categoryParam : "YARN";
  const viewParam = params.get("view");
  const view: View = viewParam === "history" || viewParam === "sold" || viewParam === "bills" ? viewParam : "stock";
  const itemCode = params.get("itemCode") ?? "";
  const lotNo = params.get("lotNo") ?? "";
  const warehouseParam = params.get("warehouse") ?? "";
  const showAll = warehouseParam === ALL;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  /** Row order of every tab: by date, name (A to Z / Z to A) or code. */
  const sort = parseSort(params.get("sort"));
  const [filter, setFilter] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  /** Stock view narrowed to positions below zero, from the "Negative balances" tile. */
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [mode, setMode] = useState<EntryMode | null>(null);
  /** The bill open in the print window, the movement whose bill is being issued, and the "without a bill" filter. */
  const [billOpen, setBillOpen] = useState<string | null>(null);
  const [billing, setBilling] = useState<string | null>(null);
  const [unbilledOnly, setUnbilledOnly] = useState(false);
  /** The goods receipt whose received challan is open, right after receiving a PO. */
  const [challanId, setChallanId] = useState<string | null>(null);
  /** The dispatched sale whose delivery challan is open, right after dispatch or from Sold / Entries. */
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const { run } = useApiAction();

  const setParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const { data: warehouseList, reload: reloadWarehouses } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouses = useMemo(() => warehouseList ?? [], [warehouseList]);
  const selectedWarehouse = showAll ? undefined : warehouses.find((w) => w.id === warehouseParam);
  const warehouseId = selectedWarehouse?.id ?? "";

  // No (or an unknown) warehouse in the address: open the last one viewed, else the first active one, else the list.
  useEffect(() => {
    if (!warehouseList || showAll || selectedWarehouse) return;
    const remembered = rememberedWarehouse();
    const fallback =
      warehouseList.find((w) => w.id === remembered)?.id ?? warehouseList.find((w) => w.active !== false)?.id ?? warehouseList[0]?.id ?? ALL;
    setParams({ warehouse: fallback });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setParams is recreated each render; the inputs above decide.
  }, [warehouseList, showAll, selectedWarehouse]);
  useEffect(() => {
    if (!warehouseId) return;
    try {
      localStorage.setItem(LAST_WAREHOUSE_KEY, warehouseId);
    } catch {
      // Private window or blocked storage: the page just opens the first warehouse next time.
    }
  }, [warehouseId]);

  // Every material's balances in this warehouse (for the totals row); the stock table shows the chosen one.
  const balances = useApiQuery<Balance[]>(warehouseId ? `/inventory/balances${qs({ warehouseId })}` : null);
  const history = useApiQuery<Txn[]>(
    warehouseId && view === "history" ? `/inventory/ledger${qs({ category, itemCode, lotNo, warehouseId, from: dayStart(from), to: dayEnd(to) })}` : null,
  );
  // Received / export bills of this warehouse, and how many movements have none yet.
  const bills = useApiQuery<{ unbilled: number; bills: BillRow[] }>(warehouseId && view === "bills" ? `/inventory/bills${qs({ warehouseId })}` : null);
  // What was sold from here: dispatched sales, within the chosen dates (prices only for admins).
  const sold = useApiQuery<Sale[]>(warehouseId && view === "sold" ? `/sales/dispatched${qs({ warehouseId, from: dayStart(from), to: dayEnd(to) })}` : null);
  const soldLines = useMemo<SoldLine[]>(
    () =>
      (sold.data ?? []).flatMap((sale) =>
        sale.items
          .filter((item) => Number(item.dispatchedQty ?? 0) > EMPTY)
          .map((item) => ({
            id: item.id,
            saleId: sale.id,
            saleNo: sale.saleNo,
            challanNo: sale.challanNo,
            dispatchedAt: sale.dispatchedAt ?? sale.saleDate,
            partyName: sale.partyName,
            partyType: sale.partyType,
            vehicleNo: sale.vehicleNo,
            category: item.category,
            itemCode: item.itemCode,
            itemName: item.itemName,
            lotNo: item.lotNo,
            unit: item.unit,
            quantity: Number(item.dispatchedQty),
            amount: item.amount === null ? null : toNumber(item.amount),
          })),
      ),
    [sold.data],
  );
  const visibleSold = useMemo(
    () => sortRows(soldLines, sort, (l) => ({ date: l.dispatchedAt, name: l.itemName, code: l.itemCode })),
    [soldLines, sort],
  );
  const visibleBills = useMemo(
    () => sortRows(bills.data?.bills ?? [], sort, (b) => ({ date: b.createdAt, name: b.partyName ?? b.source.label, code: b.billNo })),
    [bills.data, sort],
  );
  const billCount = useApiQuery<{ unbilled: number }>(warehouseId && canManageWarehouses ? `/inventory/bills${qs({ warehouseId })}` : null);
  // Purchase orders being delivered here: shown as "waiting to receive", and received from this page.
  const incoming = useApiQuery<PurchaseOrder[]>(warehouseId ? `/procurement/incoming${qs({ warehouseId })}` : null);
  const [receivingPo, setReceivingPo] = useState<string | null>(null);
  // Finished fabric sent here from production, received from this page too.
  const incomingFabric = useApiQuery<IncomingFabric[]>(warehouseId ? `/production/incoming-fabric${qs({ warehouseId })}` : null);
  const [receivingFabric, setReceivingFabric] = useState<IncomingFabric | null>(null);
  // Sales to load and dispatch from here, verified by the godown staff (and admins).
  const outgoing = useApiQuery<Sale[]>(warehouseId && canEdit ? `/sales/outgoing${qs({ warehouseId })}` : null);
  const [dispatching, setDispatching] = useState<Sale | null>(null);
  const outgoingSales = outgoing.data ?? [];
  const incomingPos = incoming.data ?? [];
  const incomingFabricRows = incomingFabric.data ?? [];
  const stockRows = useMemo(() => balances.data ?? [], [balances.data]);
  // Yarn and fabric always get a tab; other materials (raw material, chemicals…) once this warehouse has had them, e.g. from a purchase.
  const shownCategories = useMemo(
    () => ALL_CATEGORIES.filter((value) => isGodownCategory(value) || value === category || stockRows.some((row) => row.category === value)),
    [stockRows, category],
  );
  const materials = useMemo(
    () =>
      shownCategories.map((value) => {
        const rows = stockRows.filter((row) => row.category === value);
        return {
          category: value,
          total: totalsText(rows),
          negative: rows.some((row) => row.balanceKg < -EMPTY),
          items: rows.filter((row) => Math.abs(row.balanceKg) > EMPTY).length,
        };
      }),
    [shownCategories, stockRows],
  );
  const negatives = stockRows.filter((row) => row.balanceKg < -EMPTY);
  const visibleStock = useMemo(
    () =>
      sortRows(
        stockRows.filter(
          (row) => row.category === category && (onlyNegative ? row.balanceKg < -EMPTY : !hideEmpty || Math.abs(row.balanceKg) > EMPTY),
        ),
        sort,
        (row) => ({ date: row.lastMovedAt, name: row.itemName, code: `${row.itemCode} ${row.lotNo ?? ""}` }),
      ),
    [stockRows, category, hideEmpty, onlyNegative, sort],
  );
  const totalStock = totalsText(visibleStock);
  const visibleHistory = useMemo(
    () =>
      sortRows(
        (history.data ?? []).filter((t) => !unbilledOnly || (!t.stockBill && !t.billWaivedAt)),
        sort,
        (t) => ({ date: t.createdAt, name: t.itemName, code: t.itemCode }),
      ),
    [history.data, unbilledOnly, sort],
  );
  // Per unit: KG and cones must not be added together.
  const totals = useMemo(() => {
    const rows = visibleHistory;
    return {
      in: unitTotalsText(rows, (row) => toNumber(row.quantityIn)),
      out: unitTotalsText(rows, (row) => toNumber(row.quantityOut)),
      net: unitTotalsText(rows, (row) => toNumber(row.quantityIn) - toNumber(row.quantityOut)),
    };
  }, [visibleHistory]);
  const historyCapped = (history.data?.length ?? 0) >= LEDGER_LIMIT;

  const active = view === "stock" ? balances : view === "history" ? history : view === "sold" ? sold : bills;

  /** Admins: a challan for every movement here still waiting for one (older movements, or freed by a cancelled challan). */
  const issueAllChallans = async () => {
    const count = billCount.data?.unbilled ?? 0;
    const ok = await confirmDialog({
      title: `Issue challans for ${count} movement${count === 1 ? "" : "s"}?`,
      description: `Each source (a goods receipt, a sale, a batch, a godown entry…) gets one received or export challan for its lines in ${selectedWarehouse?.code ?? "this warehouse"}. They can be printed and shared from Challans.`,
      confirmLabel: "Issue challans",
    });
    if (!ok) return;
    const done = await run(async () => {
      const result = await api<{ issued: number }>("/inventory/bills/issue-all", { method: "POST", body: JSON.stringify({ warehouseId }) });
      toast.success(`${result.issued} challan${result.issued === 1 ? "" : "s"} issued.`);
    });
    if (done) {
      void billCount.reload();
      if (view === "history") void history.reload();
      if (view === "bills") void bills.reload();
    }
  };

  /** Admins: old movements without a challan stop waiting for one (they can still get one from Entries). */
  const clearUnbilled = async () => {
    const count = billCount.data?.unbilled ?? 0;
    const ok = await confirmDialog({
      title: `Clear ${count} old movement${count === 1 ? "" : "s"} without a challan?`,
      description: `Every movement in ${selectedWarehouse?.code ?? "this warehouse"} that has no challan now is marked "No challan needed" and leaves this list. Stock doesn't change, and you can still issue a challan for any of them from Entries. New movements get their challan automatically.`,
      confirmLabel: "Clear them",
    });
    if (!ok) return;
    const done = await run(async () => {
      const result = await api<{ cleared: number }>("/inventory/bills/clear-unbilled", { method: "POST", body: JSON.stringify({ warehouseId }) });
      toast.success(`${result.cleared} old movement${result.cleared === 1 ? "" : "s"} cleared.`);
    });
    if (done) {
      void billCount.reload();
      if (view === "history") void history.reload();
      if (view === "bills") void bills.reload();
    }
  };

  /** After any stock change: the totals and both views. */
  const stockChanged = () => {
    void balances.reload();
    if (view === "history") void history.reload();
  };

  const chooseCategory = (value: StockCategory) => {
    setOnlyNegative(false);
    setParams({ category: value, itemCode: "", lotNo: "" });
  };
  /** Shows the items below zero, in the material of the first one if the current material has none. */
  const showNegatives = () => {
    if (!negatives.length) return;
    setOnlyNegative(true);
    const next = negatives.some((row) => row.category === category) ? category : negatives[0].category;
    setParams({ category: next, view: "", itemCode: "", lotNo: "" });
  };

  /** The rows on screen as a CSV file, in the chosen order (the search box is not applied). */
  const exportView = () => {
    const stamp = `${selectedWarehouse?.code ?? "warehouse"}-${category.toLowerCase()}-${todayInput()}`;
    if (view === "stock") {
      downloadCsv(
        `stock-${stamp}.csv`,
        ["Item code", "Item name", "Material", "Lot", "In", "Out", "Balance", "Unit"],
        visibleStock.map((r) => [r.itemCode, r.itemName, humanize(r.category), r.lotNo ?? "", r.quantityIn.toFixed(3), r.quantityOut.toFixed(3), r.balanceKg.toFixed(3), r.unit]),
      );
    } else if (view === "sold") {
      downloadCsv(
        `sold-${selectedWarehouse?.code ?? "warehouse"}-${todayInput()}.csv`,
        ["Dispatched", "Bill no", "Sold to", "Party type", "Item code", "Item name", "Material", "Lot", "Quantity", "Unit", "Vehicle", ...(canManageWarehouses ? ["Amount"] : [])],
        visibleSold.map((l) => [l.dispatchedAt.slice(0, 10), l.saleNo, l.partyName, PARTY_LABEL[l.partyType], l.itemCode, l.itemName, humanize(l.category), l.lotNo, l.quantity.toFixed(3), l.unit, l.vehicleNo, ...(canManageWarehouses ? [l.amount?.toFixed(2)] : [])]),
      );
    } else {
      downloadCsv(
        `entries-${stamp}.csv`,
        ["Date", "Type", "Item code", "Item name", "Lot", "In", "Out", "Unit", "Reference", "Notes"],
        visibleHistory.map((t) => [
          formatDateTime(t.createdAt),
          humanize(t.txnType),
          t.itemCode,
          t.itemName,
          t.lotNo ?? "",
          toNumber(t.quantityIn).toFixed(3),
          toNumber(t.quantityOut).toFixed(3),
          t.unit,
          referenceLabel(t),
          t.notes ?? "",
        ]),
      );
    }
  };

  // A new entry starts in the warehouse being viewed (if it can still take entries), in yarn when another material is shown.
  const newEntry = () =>
    setMode({
      kind: "create",
      preset: { category: isGodownCategory(category) ? category : "YARN", ...(selectedWarehouse?.active !== false && warehouseId ? { warehouseId } : {}) },
    });
  // `?new=1` opens a stock entry; with `?warehouse=all` it adds a warehouse instead (WarehouseManager).
  useNewParam(() => !showAll && canEdit && newEntry());

  // Memoised columns call the latest handlers through a ref.
  const actions = useRef({
    open: (_m: EntryMode) => {},
    remove: async (_t: Txn) => {},
    issueBill: async (_t: Txn) => {},
    openBill: (_id: string) => {},
    openChallan: (_id: string) => {},
    openDelivery: (_saleId: string) => {},
  });
  actions.current = {
    open: setMode,
    openBill: setBillOpen,
    openChallan: setChallanId,
    openDelivery: setDeliveryId,
    // Issues the challan for this movement's source (all its lines without one in this direction), then opens it.
    issueBill: async (t) => {
      const kind: StockBillKind = toNumber(t.quantityIn) > 0 ? "RECEIVED" : "EXPORT";
      setBilling(t.id);
      let billId = "";
      const ok = await run(async () => {
        const bill = await api<{ id: string }>("/inventory/bills", { method: "POST", body: JSON.stringify({ warehouseId: t.warehouseId, referenceType: t.referenceType, referenceId: t.referenceId, kind }) });
        billId = bill.id;
      }, `${BILL_SHORT[kind]} issued.`);
      setBilling(null);
      if (ok && billId) {
        void history.reload();
        void billCount.reload();
        setBillOpen(billId);
      }
    },
    remove: async (t) => {
      const qty = toNumber(t.quantityIn) > 0 ? `+${quantity(toNumber(t.quantityIn), t.unit)}` : `−${quantity(toNumber(t.quantityOut), t.unit)}`;
      const ok = await confirmDialog({
        title: `Delete ${qty} of ${t.itemCode}?`,
        description:
          t.referenceType === GODOWN_ENTRY
            ? `Entry ${t.referenceId} is removed and the godown balance changes by the same amount.`
            : `This movement was posted by ${humanize(t.referenceType).toLowerCase()} (${t.notes || t.referenceId}). Only the godown stock changes; the source record stays.`,
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!ok) return;
      if (await run(() => api(`/inventory/entries/${t.id}`, { method: "DELETE" }), "Entry deleted.")) stockChanged();
    },
  };

  const stockColumns = useMemo<ColumnDef<Balance>[]>(
    () => [
      serialColumn<Balance>(),
      {
        // Items are shown by code; the name and everything else is one click away. Search still finds names.
        header: "Item code",
        id: "item",
        accessorFn: (r) => `${r.itemCode} ${r.itemName}`,
        cell: ({ row }) => <ItemCodeLink code={row.original.itemCode} warehouseId={row.original.warehouseId} />,
      },
      { header: "Lot", accessorFn: (r) => r.lotNo || "—" },
      { header: "In", accessorKey: "quantityIn", meta: { align: "right" }, cell: ({ row }) => quantity(row.original.quantityIn, row.original.unit) },
      { header: "Out", accessorKey: "quantityOut", meta: { align: "right" }, cell: ({ row }) => quantity(row.original.quantityOut, row.original.unit) },
      {
        header: "Balance",
        accessorKey: "balanceKg",
        meta: { align: "right" },
        cell: ({ row }) => (
          <b className={row.original.balanceKg < -EMPTY ? "text-red-600" : "text-emerald-700"} title={row.original.balanceKg < -EMPTY ? "More issued than received: check the entries" : undefined}>
            {quantity(row.original.balanceKg, row.original.unit)}
          </b>
        ),
      },
      {
        header: "",
        id: "actions",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const r = row.original;
          const preset = { category: r.category as StockCategory, itemName: r.itemName, lotNo: r.lotNo ?? "", warehouseId: r.warehouseId };
          return (
            <div className="flex items-center justify-end gap-1.5">
              {/* Manual in / out is for yarn and fabric (in KG); other materials move through purchases. */}
              {canEdit && isGodownCategory(r.category) && r.unit === "KG" && (
                <>
                  <Button size="sm" variant="outline" aria-label={`Stock in ${r.itemCode}`} onClick={() => actions.current.open({ kind: "create", preset: { ...preset, direction: "IN" } })}>
                    <ArrowDownLeft size={13} /> In
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Stock out ${r.itemCode}`} onClick={() => actions.current.open({ kind: "create", preset: { ...preset, direction: "OUT" } })}>
                    <ArrowUpRight size={13} /> Out
                  </Button>
                </>
              )}
              <Link
                className="px-1.5 text-xs font-semibold text-primary hover:underline"
                href={`/warehouses${qs({ warehouse: r.warehouseId, category: r.category, view: "history", itemCode: r.itemCode, lotNo: r.lotNo })}`}
              >
                Entries
              </Link>
            </div>
          );
        },
      },
    ],
    [canEdit],
  );

  const historyColumns = useMemo<ColumnDef<Txn>[]>(
    () => [
      { header: "Date", accessorKey: "createdAt", cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span> },
      {
        header: "Type",
        accessorKey: "txnType",
        cell: ({ row }) => (
          <Badge tone={toNumber(row.original.quantityIn) > 0 ? "success" : "warning"}>{humanize(row.original.txnType)}</Badge>
        ),
      },
      {
        header: "Item code",
        id: "item",
        accessorFn: (r) => `${r.itemCode} ${r.itemName}`,
        cell: ({ row }) => <ItemCodeLink code={row.original.itemCode} warehouseId={row.original.warehouseId} />,
      },
      { header: "Lot", accessorFn: (r) => r.lotNo || "—" },
      {
        header: "In",
        id: "in",
        meta: { align: "right" },
        accessorFn: (r) => toNumber(r.quantityIn),
        cell: ({ row, getValue }) => (getValue<number>() > 0 ? <span className="font-semibold text-emerald-700">+{quantity(getValue<number>(), row.original.unit)}</span> : "—"),
      },
      {
        header: "Out",
        id: "out",
        meta: { align: "right" },
        accessorFn: (r) => toNumber(r.quantityOut),
        cell: ({ row, getValue }) => (getValue<number>() > 0 ? <span className="font-semibold text-rose-600">−{quantity(getValue<number>(), row.original.unit)}</span> : "—"),
      },
      {
        header: "Reference",
        id: "reference",
        accessorFn: (r) => `${referenceLabel(r)} ${r.notes ?? ""}`,
        cell: ({ row }) => (
          <div className="max-w-[16rem]">
            <p className="text-sm">{referenceLabel(row.original)}</p>
            {row.original.notes && <p className="truncate text-xs text-gray-400">{row.original.notes}</p>}
            {/* Challans are office documents: only admins open and print them. */}
            {canManageWarehouses && row.original.referenceType === "PURCHASE_RECEIPT" && (
              <button type="button" className="customers-code mt-0.5" title="Open the received challan of this goods receipt" onClick={() => actions.current.openChallan(row.original.referenceId)}>
                Received challan
              </button>
            )}
            {canManageWarehouses && row.original.referenceType === "SALE" && row.original.txnType === "DISPATCH_OUT" && (
              <button type="button" className="customers-code mt-0.5" title="Open the delivery challan of this sale" onClick={() => actions.current.openDelivery(row.original.referenceId)}>
                Delivery challan
              </button>
            )}
          </div>
        ),
      },
      {
        // Every movement in or out gets its challan automatically; everyone can open, print and share it.
        header: "Challan",
        id: "bill",
        accessorFn: (r) => r.stockBill?.billNo ?? "",
        cell: ({ row }) => {
          const t = row.original;
          if (t.stockBill) {
            return (
              <button type="button" className="customers-code" title={`Open ${BILL_SHORT[t.stockBill.kind].toLowerCase()} ${t.stockBill.billNo}`} onClick={() => actions.current.openBill(t.stockBill!.id)}>
                {t.stockBill.billNo}
              </button>
            );
          }
          const kind: StockBillKind = toNumber(t.quantityIn) > 0 ? "RECEIVED" : "EXPORT";
          if (t.billWaivedAt) return <span className="text-xs text-gray-400" title={`Cleared ${formatDate(t.billWaivedAt)}`}>No challan needed</span>;
          return canManageWarehouses ? (
            <Button size="sm" variant="outline" disabled={billing !== null} onClick={() => void actions.current.issueBill(t)}>
              {billing === t.id ? "Issuing…" : BILL_SHORT[kind]}
            </Button>
          ) : (
            <span className="text-xs font-semibold text-amber-700">No challan yet</span>
          );
        },
      },
      ...(canEdit
        ? [
            {
              header: "",
              id: "actions",
              enableSorting: false,
              enableGlobalFilter: false,
              cell: ({ row }) => {
                const t = row.original;
                // The entry form handles yarn and fabric in KG; other movements are corrected at their source (e.g. the purchase).
                if (!isGodownCategory(t.category) || t.unit !== "KG") return null;
                // A billed movement changes only after an admin cancels its bill.
                if (t.stockBill) return <span className="block text-right text-[11px] text-gray-400">Locked by bill</span>;
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <Button size="sm" variant="outline" aria-label={`Edit entry for ${t.itemCode}`} onClick={() => actions.current.open({ kind: "edit", txn: t })}>
                      <Pencil size={13} /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50"
                      aria-label={`Delete entry for ${t.itemCode}`}
                      onClick={() => void actions.current.remove(t)}
                    >
                      <Trash2 size={13} /> Delete
                    </Button>
                  </div>
                );
              },
            } satisfies ColumnDef<Txn>,
          ]
        : []),
    ],
    [canEdit, canManageWarehouses, billing],
  );

  const soldColumns = useMemo<ColumnDef<SoldLine>[]>(
    () => [
      {
        header: "Dispatched",
        id: "date",
        accessorFn: (r) => r.dispatchedAt,
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.dispatchedAt)}</span>,
      },
      {
        header: "Bill / challan",
        id: "bill",
        accessorFn: (r) => `${r.saleNo} ${r.challanNo ?? ""}`,
        // The Sales page and the delivery challan (an office document) are for admins; others see the numbers.
        cell: ({ row }) => (
          <div>
            {canManageWarehouses ? <Link href={`/sales/${row.original.saleId}`} className="customers-code">{row.original.saleNo}</Link> : <span className="font-mono text-xs font-semibold">{row.original.saleNo}</span>}
            {canManageWarehouses ? (
              <button type="button" className="mt-0.5 block text-xs font-semibold text-[#1b3c55] hover:underline" title="Open the delivery challan" onClick={() => actions.current.openDelivery(row.original.saleId)}>
                {row.original.challanNo ?? "Delivery challan"}
              </button>
            ) : (
              row.original.challanNo && <span className="mt-0.5 block font-mono text-xs text-gray-500">{row.original.challanNo}</span>
            )}
          </div>
        ),
      },
      {
        header: "Sold to",
        id: "party",
        accessorFn: (r) => `${r.partyName} ${PARTY_LABEL[r.partyType]}`,
        cell: ({ row }) => (
          <div className="max-w-[14rem]">
            <p className="truncate font-medium">{row.original.partyName}</p>
            <p className="text-xs text-gray-400">{PARTY_LABEL[row.original.partyType]}</p>
          </div>
        ),
      },
      {
        header: "Item code",
        id: "item",
        accessorFn: (r) => `${r.itemCode} ${r.itemName} ${r.lotNo ?? ""}`,
        cell: ({ row }) => (
          <div>
            <ItemCodeLink code={row.original.itemCode} warehouseId={warehouseId} />
            <span className="mt-0.5 block text-xs text-gray-500">{row.original.itemName}{row.original.lotNo ? ` · lot ${row.original.lotNo}` : ""}</span>
          </div>
        ),
      },
      {
        header: "Material",
        id: "material",
        accessorFn: (r) => humanize(r.category),
        cell: ({ row }) => <Badge tone="info">{humanize(row.original.category)}</Badge>,
      },
      {
        header: "Quantity",
        id: "qty",
        meta: { align: "right" },
        accessorFn: (r) => r.quantity,
        cell: ({ row }) => <b className="text-blue-700">{quantity(row.original.quantity, row.original.unit)}</b>,
      },
      ...(canManageWarehouses
        ? [{ header: "Amount", id: "amount", meta: { align: "right" }, accessorFn: (r: SoldLine) => r.amount ?? 0, cell: ({ row }: { row: { original: SoldLine } }) => money(row.original.amount) } as ColumnDef<SoldLine>]
        : []),
      { header: "Vehicle", id: "vehicle", accessorFn: (r) => r.vehicleNo ?? "", cell: ({ row }) => row.original.vehicleNo || <span className="text-gray-400">—</span> },
    ],
    [canManageWarehouses, warehouseId],
  );

  const billColumns = useMemo<ColumnDef<BillRow>[]>(
    () => [
      {
        header: "Challan",
        id: "bill",
        accessorFn: (r) => `${r.billNo} ${r.createdAt}`,
        cell: ({ row }) => (
          <div>
            <button type="button" className="customers-code" onClick={() => actions.current.openBill(row.original.id)}>{row.original.billNo}</button>
            <span className="mt-0.5 block text-xs text-gray-400">{formatDateTime(row.original.createdAt)}</span>
          </div>
        ),
      },
      {
        header: "Type",
        id: "kind",
        accessorFn: (r) => BILL_SHORT[r.kind],
        cell: ({ row }) => <Badge tone={row.original.kind === "RECEIVED" ? "success" : "info"}>{BILL_SHORT[row.original.kind]}</Badge>,
      },
      { header: "Source", id: "source", accessorFn: (r) => r.source.label, cell: ({ row }) => <span className="text-sm">{row.original.source.label}</span> },
      {
        header: "Party / vehicle",
        id: "party",
        accessorFn: (r) => `${r.partyName ?? ""} ${r.vehicleNo ?? ""}`,
        cell: ({ row }) => (
          <div className="max-w-[14rem]">
            <p className="truncate">{row.original.partyName || "—"}</p>
            {row.original.vehicleNo && <p className="text-xs text-gray-400">{row.original.vehicleNo}</p>}
          </div>
        ),
      },
      {
        header: "Items",
        id: "items",
        accessorFn: (r) => r.items.join(" "),
        cell: ({ row }) => {
          const text = row.original.items.join(", ");
          return (
            <p className="line-clamp-2 max-w-[16rem] text-xs text-gray-700" title={text}>
              {text || "—"}
              <span className="block text-gray-400">{row.original.lines} line{row.original.lines === 1 ? "" : "s"}</span>
            </p>
          );
        },
      },
      {
        header: "Quantity",
        id: "quantity",
        meta: { align: "right" },
        accessorFn: (r) => Object.values(r.totals).reduce((sum, value) => sum + value, 0),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-semibold">
            {Object.entries(row.original.totals).map(([unit, value]) => unitQty(value, unit)).join(" · ") || "—"}
          </span>
        ),
      },
      {
        header: "Status",
        id: "status",
        accessorFn: (r) => (r.cancelledAt ? "Cancelled" : "Issued"),
        cell: ({ row }) => (
          <span title={row.original.cancelReason ?? undefined}>
            <Badge tone={row.original.cancelledAt ? "default" : "success"}>{row.original.cancelledAt ? "Cancelled" : "Issued"}</Badge>
          </span>
        ),
      },
      {
        header: "",
        id: "actions",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" title="Open, print or share" onClick={() => actions.current.openBill(row.original.id)}>
              <Eye size={14} /> Open
            </Button>
            <ShareMenu
              target={warehouseShare({
                ...row.original,
                cancelled: !!row.original.cancelledAt,
                // A list row has only item names and totals (its `lines` is a count).
                lines: undefined,
                items: row.original.items,
                totals: Object.entries(row.original.totals).map(([unit, value]) => unitQty(value, unit)).join(" · "),
              })}
            />
          </div>
        ),
      },
    ],
    [],
  );

  // Top right, on its own: the warehouse being shown, and "All" for the list (where admins add and edit warehouses).
  const warehouseSelect = (
    <WarehousePicker
      warehouses={warehouses}
      value={showAll ? null : warehouseId || null}
      onSelect={(id) => setParams({ warehouse: id, view: "", itemCode: "", lotNo: "" })}
      onAll={() => setParams({ warehouse: ALL, view: "", itemCode: "", lotNo: "" })}
    />
  );

  if (showAll) {
    return (
      <div className="inventory-list-page">
        <header className="wh-hero">
          <div className="wh-hero__top">
            <div className="flex min-w-0 items-center gap-3">
              <span className="wh-hero__icon"><WarehouseIcon size={20} /></span>
              <div className="min-w-0">
                <p className="wh-hero__eyebrow">Warehouses</p>
                <h2 className="wh-hero__title">All warehouses</h2>
                <p className="text-xs text-white/60">Every warehouse and the stock it holds{canManageWarehouses ? ". Add, edit, deactivate or delete them here." : "."} Open one for its full details.</p>
              </div>
            </div>
            {warehouseSelect}
          </div>
        </header>
        <WarehouseManager
          canManage={canManageWarehouses}
          onOpen={(id) => router.push(`/warehouses/${id}`)}
          onChanged={() => void reloadWarehouses()}
        />
      </div>
    );
  }
  if (!selectedWarehouse) return <Loading />;

  return (
    <div className="inventory-list-page">
      <header className="wh-hero">
        <div className="wh-hero__top">
          <div className="flex min-w-0 items-center gap-3">
            <span className="wh-hero__icon"><WarehouseIcon size={20} /></span>
            <div className="min-w-0">
              <p className="wh-hero__eyebrow">Warehouse{selectedWarehouse.location ? ` · ${selectedWarehouse.location}` : ""}</p>
              <h2 className="wh-hero__title">
                {selectedWarehouse.code}
                <span>{selectedWarehouse.name}</span>
                {selectedWarehouse.active === false && <Badge tone="warning">Inactive</Badge>}
                {!canEdit && (
                  <Badge tone="info">
                    <Eye size={11} className="mr-1 inline" /> View only
                  </Badge>
                )}
              </h2>
            </div>
          </div>
          {warehouseSelect}
        </div>
        <div className="wh-hero__stats">
          <div><p>In stock</p><strong>{balances.data ? totalsText(stockRows) : "…"}</strong></div>
          <div><p>Items in stock</p><strong>{balances.data ? stockRows.filter((row) => Math.abs(row.balanceKg) > EMPTY).length : "…"}</strong></div>
          <div><p>Waiting here</p><strong>{outgoingSales.length + incomingPos.length + incomingFabricRows.length}</strong></div>
          <div className={cn(negatives.length > 0 && "is-alert")}><p>Below zero</p><strong>{balances.data ? negatives.length : "…"}</strong></div>
        </div>
      </header>

      <div className="wh-toolbar">
        {view !== "sold" && (
          <Tabs
            label="Material"
            value={category}
            options={shownCategories.map((value) => ({ value, label: humanize(value) }))}
            onChange={chooseCategory}
          />
        )}
        <Tabs<View>
          label="View"
          value={view}
          options={[
            { value: "stock", label: "Stock" },
            { value: "history", label: "Entries" },
            { value: "sold", label: "Sold" },
            { value: "bills", label: "Challans" },
          ]}
          onChange={(value) => setParams({ view: value === "stock" ? "" : value, itemCode: "", lotNo: "" })}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/warehouses/${selectedWarehouse.id}`}><Eye size={15} /> Full details</Link>
          </Button>
          {canEdit && (
            <Button onClick={newEntry}>
              <Plus size={16} /> New entry
            </Button>
          )}
        </div>
        <p className="w-full text-xs text-gray-500">
          {view === "stock" ? (
            <>
              {humanize(category)} in stock · total <b className="text-gray-700">{totalStock}</b>
              {!isGodownCategory(category) && " · received from purchases"}
              {canEdit && " · to fix a wrong entry, open Entries."}
            </>
          ) : view === "history" ? (
            <>
              {humanize(category)} received and issued, newest first.
              {canEdit && " Use Edit or Delete on a row to fix a wrong entry."}
              {canManageWarehouses ? " Issue a received or export bill for every movement." : " Admins issue a bill for every movement."}
            </>
          ) : (
            view === "sold" ? (
              <>Everything sold from {selectedWarehouse.code}, every material: each sale dispatched from here, newest first.</>
            ) : (
              <>Received and export challans of {selectedWarehouse.code}, newest first: issued automatically for every movement in or out, ready to print and share.</>
            )
          )}
        </p>
      </div>

      {selectedWarehouse.active === false && (
        <p className="warehouses-inactive-note" role="status">
          <AlertTriangle size={15} aria-hidden className="shrink-0" />
          {selectedWarehouse.code} is inactive: it keeps its history but can&apos;t take new receipts or stock entries.
          {canManageWarehouses && " Reactivate it from View all warehouses."}
        </p>
      )}

      <ActionCenter
        sales={outgoingSales}
        purchaseOrders={incomingPos}
        fabric={incomingFabricRows}
        unbilled={canManageWarehouses ? billCount.data?.unbilled ?? null : null}
        negatives={negatives.map((n) => ({ ...n, lotNo: n.lotNo ?? null }))}
        canEdit={canEdit}
        canBill={canManageWarehouses}
        inactive={selectedWarehouse.active === false}
        onDispatch={setDispatching}
        onReceivePo={setReceivingPo}
        onReceiveFabric={setReceivingFabric}
        onShowUnbilled={() => {
          setUnbilledOnly(true);
          setParams({ view: "history", itemCode: "", lotNo: "" });
        }}
        onShowNegatives={showNegatives}
        onClearUnbilled={clearUnbilled}
        onIssueAll={issueAllChallans}
      />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {materials.map((m) => (
          <button
            key={m.category}
            type="button"
            onClick={() => chooseCategory(m.category)}
            aria-pressed={m.category === category && !onlyNegative}
            data-material={m.category}
            className={cn("wh-tile", m.category === category && !onlyNegative && "is-active")}
          >
            <span className="wh-tile__icon"><Layers size={16} /></span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">{humanize(m.category)}</span>
              <span className={cn("block text-lg font-bold", m.negative && "text-red-600")}>{balances.data ? m.total : "…"}</span>
              <span className="block text-[11px] text-gray-400">{m.items ? `${m.items} item${m.items === 1 ? "" : "s"} in stock` : "Nothing in stock"}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={negatives.length === 0}
          aria-pressed={onlyNegative}
          title={negatives.length ? "Show only the items below zero" : undefined}
          onClick={showNegatives}
          data-material="NEGATIVE"
          className={cn("wh-tile text-left", negatives.length > 0 && "is-warning", onlyNegative && "is-active")}
        >
          <span className="wh-tile__icon"><AlertTriangle size={16} /></span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">Negative balances</span>
            <span className="block text-lg font-bold">{balances.data ? negatives.length : "…"}</span>
            <span className="block truncate text-[11px] text-gray-400">
              {negatives.length ? `Click to check: ${negatives.slice(0, 2).map((row) => row.itemName).join(", ")}${negatives.length > 2 ? "…" : ""}` : "Every item is at or above zero"}
            </span>
          </span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inventory-search flex items-center gap-2">
          <Search className="text-gray-400" size={17} aria-hidden />
          <Input
            placeholder={view === "stock" ? "Search item, code or lot..." : view === "sold" ? "Search bill, party, item..." : view === "bills" ? "Search challan, party, item..." : "Search item, lot, type..."}
            aria-label="Search godown"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {view === "stock" &&
          (onlyNegative ? (
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => setOnlyNegative(false)}>
              Below zero only <X size={13} />
            </Button>
          ) : (
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              Hide zero balances
            </label>
          ))}
        {view === "history" && (
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
            <input type="checkbox" checked={unbilledOnly} onChange={(e) => setUnbilledOnly(e.target.checked)} />
            Without a challan only
          </label>
        )}
        {view === "history" && (itemCode || lotNo) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-gray-500">Filtered to:</span>
            {itemCode && (
              <Button size="sm" variant="outline" onClick={() => setParams({ itemCode: "" })}>
                Item {itemCode} <X size={13} />
              </Button>
            )}
            {lotNo && (
              <Button size="sm" variant="outline" onClick={() => setParams({ lotNo: "" })}>
                Lot {lotNo} <X size={13} />
              </Button>
            )}
          </div>
        )}

        {/* Right side: dates (Entries / Sold), the sort, and the export. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {(view === "history" || view === "sold") && (
            <div className="wh-dates">
              <DatePick label="From date" value={from} max={to || todayInput()} onChange={(value) => setParams({ from: value })} />
              <span>to</span>
              <DatePick label="To date" value={to} min={from || undefined} max={todayInput()} onChange={(value) => setParams({ to: value })} />
              {(from || to) && (
                <button type="button" className="wh-dates__clear" aria-label="All dates" title="All dates" onClick={() => setParams({ from: "", to: "" })}>
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          <SortMenu value={sort} onChange={(value) => setParams({ sort: value === "newest" ? "" : value })} />
          <Button
            size="sm"
            variant="outline"
            disabled={view === "stock" ? visibleStock.length === 0 : view === "sold" ? visibleSold.length === 0 : view === "history" ? visibleHistory.length === 0 : true}
            title={view === "stock" ? "Download the stock shown" : view === "sold" ? "Download the sold items shown" : "Download the entries shown"}
            onClick={exportView}
          >
            <Download size={14} /> Export CSV
          </Button>
        </div>
      </div>

      {view === "history" && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {[
              { label: "Total in", value: totals.in, icon: ArrowDownLeft, tone: "bg-emerald-50 text-emerald-700" },
              { label: "Total out", value: totals.out, icon: ArrowUpRight, tone: "bg-rose-50 text-rose-700" },
              { label: "Net movement", value: totals.net, icon: Scale, tone: "bg-blue-50 text-blue-700" },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="erp-card flex items-center gap-3 p-4">
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}>
                  <Icon size={17} />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    {label}
                    {historyCapped ? " · shown entries" : from || to ? " · in these dates" : ""}
                  </p>
                  <p className="text-lg font-bold">{value}</p>
                </div>
              </div>
            ))}
          </div>
          {historyCapped && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              Showing the latest {LEDGER_LIMIT} movements only, and the totals above cover just these. Choose a From / To date to see older entries.
            </p>
          )}
        </>
      )}

      {!active.data && active.error ? (
        <ErrorState message={active.error} onRetry={() => void active.reload()} />
      ) : view === "stock" ? (
        !balances.data ? (
          <Loading />
        ) : (
          <div className={balances.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <DataTable
              columns={stockColumns}
              data={visibleStock}
              filter={filter}
              onFilterChange={setFilter}
              hideSearch
              emptyTitle={`No ${humanize(category).toLowerCase()} in ${selectedWarehouse.code}`}
              emptyDescription={canEdit ? "Use “New entry” to record stock coming in." : "Stock appears here once entries are recorded."}
            />
          </div>
        )
      ) : view === "sold" ? (
        !sold.data ? (
          <Loading />
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                { label: "Sold", value: unitTotalsText(soldLines, (l) => l.quantity), note: `${soldLines.length} line${soldLines.length === 1 ? "" : "s"}${from || to ? " in these dates" : ""}` },
                { label: "Sales", value: String(new Set(soldLines.map((l) => l.saleId)).size), note: `to ${new Set(soldLines.map((l) => l.partyName)).size} part${new Set(soldLines.map((l) => l.partyName)).size === 1 ? "y" : "ies"}` },
                canManageWarehouses
                  ? { label: "Value (before GST)", value: money(soldLines.reduce((sum, l) => sum + (l.amount ?? 0), 0)), note: "Of what was loaded" }
                  : { label: "Last sold", value: soldLines[0] ? formatDate(soldLines[0].dispatchedAt) : "—", note: soldLines[0]?.partyName ?? "Nothing sold yet" },
              ].map((tile) => (
                <div key={tile.label} className="wh-tile" data-material="DYED_FABRIC">
                  <span className="wh-tile__icon"><ArrowUpRight size={16} /></span>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">{tile.label}</span>
                    <span className="block truncate text-lg font-bold">{tile.value}</span>
                    <span className="block truncate text-[11px] text-gray-400">{tile.note}</span>
                  </span>
                </div>
              ))}
            </div>
            {(sold.data?.length ?? 0) >= 500 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">Showing the latest 500 sales only. Choose a From / To date to see older ones.</p>
            )}
            <DataTable
              data={visibleSold}
              columns={soldColumns}
              filter={filter}
              onFilterChange={setFilter}
              hideSearch
              pageSize={25}
              minWidth={980}
              getRowId={(row) => row.id}
              emptyTitle={`Nothing sold from ${selectedWarehouse.code} yet`}
              emptyDescription={from || to ? "Nothing in these dates. Try other dates." : "Sales show here once they are dispatched from this warehouse."}
            />
          </>
        )
      ) : view === "bills" ? (
        !bills.data ? (
          <Loading />
        ) : (
          <>
            {bills.data.unbilled > 0 && (
              <p className="warehouses-inactive-note">
                <AlertTriangle size={15} className="shrink-0" /> {bills.data.unbilled} movement{bills.data.unbilled === 1 ? " in this warehouse has" : "s in this warehouse have"} no challan yet (from before challans were automatic, or freed by a cancelled one).
                <button type="button" className="ml-1 font-bold underline" onClick={() => { setUnbilledOnly(true); setParams({ view: "history", itemCode: "", lotNo: "" }); }}>
                  Show {bills.data.unbilled === 1 ? "it" : "them"}
                </button>
              </p>
            )}
            <DataTable
              data={visibleBills}
              columns={billColumns}
              filter={filter}
              onFilterChange={setFilter}
              hideSearch
              pageSize={25}
              minWidth={900}
              getRowId={(row) => row.id}
              emptyTitle="No challans yet"
              emptyDescription="A challan is issued automatically whenever material comes into or goes out of this warehouse."
            />
          </>
        )
      ) : !history.data ? (
        <Loading />
      ) : (
        <div className={history.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <DataTable
            data={visibleHistory}
            columns={historyColumns}
            filter={filter}
            onFilterChange={setFilter}
            hideSearch
            pageSize={25}
            minWidth={1180}
            getRowId={(row) => row.id}
            emptyTitle={history.data.length ? "No entries without a challan" : "No stock movements"}
            emptyDescription={history.data.length ? "Every movement shown has a challan." : from || to ? "Nothing in these dates. Try other dates." : "Entries appear when material is received or issued."}
          />
        </div>
      )}

      {mode && (
        <EntryDialog
          key={mode.kind === "edit" ? mode.txn.id : "create"}
          mode={mode}
          warehouses={warehouses}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            stockChanged();
          }}
        />
      )}


      {receivingFabric && (
        <ReceiveFabricDialog
          delivery={receivingFabric}
          warehouseCode={selectedWarehouse.code}
          onClose={() => setReceivingFabric(null)}
          onReceived={(receivedCategory) => {
            setReceivingFabric(null);
            void incomingFabric.reload();
            // Show the finished fabric that just came in.
            if (category !== receivedCategory) setParams({ category: receivedCategory, view: "", itemCode: "", lotNo: "" });
            stockChanged();
          }}
        />
      )}

      {receivingPo && incoming.data && (
        <ReceiveDialog
          purchaseOrders={incoming.data}
          initialPurchaseOrderId={receivingPo}
          warehouses={[selectedWarehouse]}
          fixedWarehouse={selectedWarehouse}
          onClose={() => setReceivingPo(null)}
          onReceived={(result, po) => {
            setReceivingPo(null);
            // The received challan is an office document: it opens for admins; the office gets it for staff receipts.
            if (canManageWarehouses) setChallanId(result.receiptId);
            // Show the material that just came in, so the new stock is in view.
            if (result.categories[0] && !result.categories.includes(category)) setParams({ category: result.categories[0], view: "", itemCode: "", lotNo: "" });
            toast.success(
              `${result.receiptNo} posted to ${selectedWarehouse.code}. ${po.poNo} is ${result.status === "RECEIVED" ? "fully received" : "partly received; the rest stays in the waiting list"}.${receiptSummary(result)}${canManageWarehouses ? "" : " The office has its received challan."}`,
            );
            void incoming.reload();
            stockChanged();
          }}
        />
      )}

      {challanId && <ReceivedChallanDialog receiptId={challanId} onClose={() => setChallanId(null)} />}

      {billOpen && (
        <StockBillDialog
          billId={billOpen}
          canManage={canManageWarehouses}
          onClose={() => setBillOpen(null)}
          onChanged={() => {
            void history.reload();
            void bills.reload();
            void billCount.reload();
          }}
        />
      )}

      {dispatching && (
        <DispatchDialog
          sale={dispatching}
          onClose={() => setDispatching(null)}
          onDone={(_text, dispatched) => {
            const saleId = dispatching.id;
            setDispatching(null);
            // The delivery challan is an office document: it opens for admins to print; staff just dispatch.
            if (dispatched && canManageWarehouses) setDeliveryId(saleId);
            void outgoing.reload();
            if (view === "sold") void sold.reload();
            stockChanged();
          }}
        />
      )}

      {deliveryId && <DeliveryChallanDialog saleId={deliveryId} onClose={() => setDeliveryId(null)} />}
    </div>
  );
}

export default function WarehousesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Warehouses />
    </Suspense>
  );
}
