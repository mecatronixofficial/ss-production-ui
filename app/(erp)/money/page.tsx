"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Banknote,
  BookOpen,
  Building2,
  ClipboardList,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  HandCoins,
  LayoutDashboard,
  Pencil,
  Plus,
  Receipt,
  ShieldCheck,
  Smartphone,
  Truck,
  UsersRound,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import {
  ACCOUNT_LABEL,
  accountText,
  chequeLabel,
  chequeTone,
  isOpenCheque,
  KIND_LABEL,
  MODE_LABEL,
  MODES,
  payableText,
  PARTY_TYPE_LABEL,
  receivableText,
  type AccountType,
  type DistributorParty,
  encryptionProblem,
  type EncryptionStatus,
  type MoneyAccount,
  type MoneySummary,
  type MoneyTxn,
  type Parties,
  type PaymentMode,
  type TextileParty,
  type TxnKind,
} from "@/lib/money";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, money, todayInput } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { MoneyAccountDialog } from "@/components/money-account-dialog";
import { MoneyEntryDialog, type MoneyEntryPreset } from "@/components/money-entry-dialog";
import { CashbookDialog, ChequeActionDialog, StatementDialog, TxnDetailsDialog, type ChequeAction, type PartyRef } from "./dialogs";
import { ExpensesTab } from "./expenses-tab";
import { ExpenseDialog } from "@/components/expense-dialog";

type Tab = "overview" | "accounts" | "entries" | "cheques" | "expenses" | "parties";
const TABS: Array<{ value: Tab; label: string; icon: typeof Wallet }> = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "accounts", label: "Cash, bank & UPI", icon: Wallet },
  { value: "entries", label: "Entries", icon: ClipboardList },
  { value: "cheques", label: "Cheques", icon: FileCheck2 },
  { value: "expenses", label: "Expenses", icon: Receipt },
  { value: "parties", label: "Textiles & distributors", icon: UsersRound },
];
const ACCOUNT_ICON: Record<AccountType, typeof Wallet> = { CASH: Banknote, BANK: Building2, UPI: Smartphone };
const MODE_ICON: Record<PaymentMode, typeof Wallet> = { CASH: Banknote, UPI: Smartphone, BANK: Building2, CHEQUE: FileCheck2 };
type ChequeFilter = "TO_DEPOSIT" | "DEPOSITED" | "ISSUED" | "CLEARED" | "BOUNCED" | "ALL";

const signed = (value: number) => `${value < 0 ? "−" : ""}${money(Math.abs(value))}`;
/** Local day bounds as ISO, for the date filters. */
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

function Stat({ label, value, note, icon: Icon, tone, onClick }: { label: string; value: string; note: string; icon: typeof Wallet; tone: "invoiced" | "received" | "outstanding" | "expenses"; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} className={cn(`finance-stat-tile finance-stat-tile--${tone}`, onClick && "text-left")}>
      <div className="finance-stat-icon"><Icon size={15} /></div>
      <div className="min-w-0">
        <p className="finance-stat-label">{label}</p>
        <p className="finance-stat-value truncate">{value}</p>
        <p className="truncate text-[11px] text-gray-500">{note}</p>
      </div>
    </Comp>
  );
}

function Panel({ title, icon: Icon, badge = 3, action, tone, children }: { title: string; icon: typeof Wallet; badge?: 1 | 2 | 3 | 4 | 5; action?: React.ReactNode; tone?: string; children: React.ReactNode }) {
  return (
    <Card className={cn("finance-card", tone)}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="finance-card-heading">
          <span className={`finance-step-badge finance-step-badge--${badge}`}><Icon size={14} /></span>
          <h3 className="font-bold">{title}</h3>
        </div>
        {action}
      </CardHeader>
      <CardContent className="space-y-2.5">{children}</CardContent>
    </Card>
  );
}

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="purchases-filters" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={cn(value === o.value && "is-active")} onClick={() => onChange(o.value)}>
          {o.label} {o.count !== undefined && <span>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** `/money`: cash, bank and UPI balances; every receipt, payment and transfer; cheques; and what each party owes. */
export default function MoneyPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? tabParam! : "overview";
  const setTab = (next: Tab) => router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false });

  const summary = useApiQuery<MoneySummary>("/money/summary");
  const parties = useApiQuery<Parties>(tab === "parties" || tab === "overview" ? "/money/parties" : null);
  const security = useApiQuery<EncryptionStatus>(tab === "accounts" ? "/money/security" : null);

  // Entries tab filters
  const [kind, setKind] = useState<"ALL" | TxnKind>("ALL");
  const [mode, setMode] = useState<"ALL" | PaymentMode>("ALL");
  const [accountFilter, setAccountFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const entriesPath =
    tab === "entries" || tab === "overview"
      ? `/money/transactions?${new URLSearchParams({
          ...(tab === "entries" && kind !== "ALL" ? { kind } : {}),
          ...(tab === "entries" && mode !== "ALL" ? { mode } : {}),
          ...(tab === "entries" && accountFilter ? { accountId: accountFilter } : {}),
          ...(tab === "entries" && from ? { from: dayStart(from) } : {}),
          ...(tab === "entries" && to ? { to: dayEnd(to) } : {}),
          ...(tab === "entries" && showCancelled ? { includeCancelled: "true" } : {}),
        }).toString()}`
      : null;
  const entries = useApiQuery<MoneyTxn[]>(entriesPath);
  const cheques = useApiQuery<MoneyTxn[]>(tab === "cheques" || tab === "overview" ? "/money/transactions?mode=CHEQUE" : null);
  const [chequeFilter, setChequeFilter] = useState<ChequeFilter>("TO_DEPOSIT");
  const [partyView, setPartyView] = useState<"TEXTILE" | "DISTRIBUTOR">("TEXTILE");
  const [onlyOpen, setOnlyOpen] = useState(true);

  const [entry, setEntry] = useState<{ kind: TxnKind; preset?: MoneyEntryPreset } | null>(null);
  const [accountDialog, setAccountDialog] = useState<{ account?: MoneyAccount } | null>(null);
  const [details, setDetails] = useState<MoneyTxn | null>(null);
  const [chequeAction, setChequeAction] = useState<{ txn: MoneyTxn; action: ChequeAction } | null>(null);
  const [statement, setStatement] = useState<PartyRef | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; accountNo: string } | null>(null);
  const [cashbook, setCashbook] = useState<MoneyAccount | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  /** Bumped when an expense is saved here, so the Expenses tab reloads. */
  const [expenseVersion, setExpenseVersion] = useState(0);

  // A revealed account number disappears after 30 seconds.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(timer);
  }, [revealed]);

  const reload = () => {
    void summary.reload();
    void parties.reload();
    void entries.reload();
    void cheques.reload();
  };

  const accounts = useMemo(() => summary.data?.accounts ?? [], [summary.data]);
  const chequeRows = useMemo(() => {
    const rows = cheques.data ?? [];
    const match: Record<ChequeFilter, (t: MoneyTxn) => boolean> = {
      TO_DEPOSIT: (t) => t.kind === "RECEIPT" && t.chequeStatus === "PENDING",
      DEPOSITED: (t) => t.kind === "RECEIPT" && t.chequeStatus === "DEPOSITED",
      ISSUED: (t) => t.kind === "PAYMENT" && isOpenCheque(t),
      CLEARED: (t) => t.chequeStatus === "CLEARED",
      BOUNCED: (t) => t.chequeStatus === "BOUNCED",
      ALL: () => true,
    };
    return { rows, match };
  }, [cheques.data]);

  if (!summary.data) return summary.error ? <ErrorState message={summary.error} onRetry={reload} /> : <Loading />;
  const s = summary.data;
  const isSuperAdmin = user?.role === "SUPERADMIN";

  const reveal = async (account: MoneyAccount) => {
    try {
      const r = await api<{ accountNo: string }>(`/money/accounts/${account.id}/reveal`, { method: "POST" });
      setRevealed({ id: account.id, accountNo: r.accountNo });
    } catch {
      // api() already showed the error.
    }
  };

  // ---------------- Columns
  const partyCell = (t: MoneyTxn) =>
    t.kind === "TRANSFER" ? (
      <span className="text-gray-600">{t.account?.name} → {t.toAccount?.name}</span>
    ) : (
      <div className="max-w-[16rem]">
        <p className="truncate font-medium">{t.partyName}</p>
        <p className="text-xs text-gray-400">{t.partyType ? PARTY_TYPE_LABEL[t.partyType] : ""}{t.sale ? ` · ${t.sale.saleNo}` : t.kind === "RECEIPT" ? " · on account" : ""}</p>
      </div>
    );
  const entryColumns: ColumnDef<MoneyTxn>[] = [
    {
      header: "Entry",
      id: "entry",
      accessorFn: (r) => `${r.txnNo} ${r.txnDate}`,
      cell: ({ row }) => (
        <div>
          <button type="button" className="customers-code" onClick={() => setDetails(row.original)}>{row.original.txnNo}</button>
          <span className="mt-0.5 block text-xs text-gray-400">{formatDate(row.original.txnDate)}</span>
        </div>
      ),
    },
    { header: "Kind", id: "kind", accessorFn: (r) => KIND_LABEL[r.kind], cell: ({ row }) => <Badge tone={row.original.cancelledAt ? "default" : row.original.kind === "RECEIPT" ? "success" : row.original.kind === "PAYMENT" ? "warning" : "info"}>{row.original.cancelledAt ? "Cancelled" : KIND_LABEL[row.original.kind]}</Badge> },
    { header: "Party", id: "party", accessorFn: (r) => `${r.partyName ?? ""} ${r.sale?.saleNo ?? ""} ${r.account?.name ?? ""} ${r.toAccount?.name ?? ""}`, cell: ({ row }) => partyCell(row.original) },
    {
      header: "Mode / account",
      id: "mode",
      accessorFn: (r) => `${MODE_LABEL[r.mode]} ${r.account?.name ?? ""} ${r.referenceNo ?? ""} ${r.chequeNo ?? ""}`,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div>
            <p className="font-medium">{MODE_LABEL[t.mode]}{t.mode === "CHEQUE" && <Badge tone={chequeTone(t.chequeStatus)} className="ml-1.5 align-middle">{chequeLabel(t)}</Badge>}</p>
            <p className="max-w-[14rem] truncate text-xs text-gray-400">{[t.kind !== "TRANSFER" ? t.account?.name : null, t.chequeNo ? `No ${t.chequeNo}` : t.referenceNo].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        );
      },
    },
    {
      header: "Amount",
      id: "amount",
      meta: { align: "right" },
      accessorFn: (r) => r.amount,
      cell: ({ row }) => {
        const t = row.original;
        return <b className={cn(t.cancelledAt || t.chequeStatus === "BOUNCED" ? "text-gray-400 line-through" : !t.counted ? "text-gray-500" : t.kind === "RECEIPT" ? "text-emerald-700" : t.kind === "PAYMENT" ? "text-rose-700" : "text-[#1b3c55]")}>{t.kind === "RECEIPT" ? "+" : t.kind === "PAYMENT" ? "−" : ""}{money(t.amount)}</b>;
      },
    },
  ];
  const exportEntries = (rows: MoneyTxn[]) =>
    downloadCsv(
      `money-entries-${todayInput()}.csv`,
      ["Entry", "Date", "Kind", "Mode", "Amount", "Account", "To account", "Party type", "Party", "Bill", "Reference", "Cheque no", "Cheque status", "Counts", "Notes", "Entered by", "Cancelled"],
      rows.map((t) => [t.txnNo, t.txnDate.slice(0, 10), KIND_LABEL[t.kind], MODE_LABEL[t.mode], t.amount.toFixed(2), t.account?.name, t.toAccount?.name, t.partyType ? PARTY_TYPE_LABEL[t.partyType] : "", t.partyName, t.sale?.saleNo, t.referenceNo, t.chequeNo, t.chequeStatus ? chequeLabel(t) : "", t.counted ? "yes" : "no", t.notes, t.createdBy, t.cancelledAt ? `${t.cancelledAt.slice(0, 10)} ${t.cancelReason ?? ""}` : ""]),
    );

  const chequeColumns: ColumnDef<MoneyTxn>[] = [
    { header: "Cheque", id: "cheque", accessorFn: (r) => `${r.chequeNo} ${r.chequeBank ?? ""} ${r.txnNo}`, cell: ({ row }) => <div><button type="button" className="customers-code" onClick={() => setDetails(row.original)}>{row.original.chequeNo}</button><span className="mt-0.5 block text-xs text-gray-400">{row.original.chequeBank || "—"} · {row.original.txnNo}</span></div> },
    { header: "Dated", id: "dated", accessorFn: (r) => r.chequeDate ?? "", cell: ({ row }) => { const t = row.original; const future = !!t.chequeDate && t.chequeDate.slice(0, 10) > todayInput(); return <span className={cn("whitespace-nowrap", future && "font-semibold text-amber-700")}>{formatDate(t.chequeDate)}{future && <span className="block text-[11px]">Post-dated</span>}</span>; } },
    { header: "Party", id: "party", accessorFn: (r) => `${r.kind === "RECEIPT" ? "from" : "to"} ${r.partyName ?? ""}`, cell: ({ row }) => <div><p className="font-medium">{row.original.partyName}</p><p className="text-xs text-gray-400">{row.original.kind === "RECEIPT" ? "Received" : "Issued"} {formatDate(row.original.txnDate)}{row.original.sale ? ` · ${row.original.sale.saleNo}` : ""}</p></div> },
    { header: "Bank", id: "bank", accessorFn: (r) => r.account?.name ?? "", cell: ({ row }) => row.original.account?.name ?? <span className="text-gray-400">Not deposited</span> },
    { header: "Status", id: "status", accessorFn: (r) => chequeLabel(r), cell: ({ row }) => { const t = row.original; return <div><Badge tone={chequeTone(t.chequeStatus)}>{chequeLabel(t)}</Badge><span className="mt-0.5 block text-[11px] text-gray-400">{t.clearedAt ? `Cleared ${formatDate(t.clearedAt)}` : t.bouncedAt ? `${formatDate(t.bouncedAt)} · ${t.bounceReason}` : t.depositedAt ? `Deposited ${formatDate(t.depositedAt)}` : ""}</span></div>; } },
    { header: "Amount", id: "amount", meta: { align: "right" }, accessorFn: (r) => r.amount, cell: ({ row }) => <b className={cn(row.original.chequeStatus === "BOUNCED" && "text-gray-400 line-through", row.original.kind === "RECEIPT" ? "text-emerald-700" : "text-rose-700")}>{money(row.original.amount)}</b> },
    {
      header: "",
      id: "actions",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => {
        const t = row.original;
        if (!isOpenCheque(t)) return null;
        return (
          <div className="flex justify-end gap-1">
            {t.kind === "RECEIPT" && t.chequeStatus === "PENDING" && <Button size="sm" variant="outline" onClick={() => setChequeAction({ txn: t, action: "DEPOSIT" })}>Deposit</Button>}
            <Button size="sm" variant="outline" onClick={() => setChequeAction({ txn: t, action: "CLEAR" })}>Cleared</Button>
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setChequeAction({ txn: t, action: "BOUNCE" })}>Bounced</Button>
          </div>
        );
      },
    },
  ];

  const textileColumns: ColumnDef<TextileParty>[] = [
    { header: "Textile", id: "name", accessorFn: (r) => `${r.name} ${r.code} ${r.phone ?? ""}`, cell: ({ row }) => <div><Link href={`/masters/textiles/${row.original.textileId}`} className="customers-code text-left">{row.original.name}</Link><span className="block text-xs text-gray-400">{row.original.code}{row.original.active ? "" : " · inactive"}{row.original.phone ? ` · ${row.original.phone}` : ""}{row.original.lastActivity ? ` · last ${formatDate(row.original.lastActivity)}` : ""}</span></div> },
    { header: "Billed", id: "billed", meta: { align: "right" }, accessorFn: (r) => r.billed, cell: ({ row }) => <span>{money(row.original.billed)}<span className="block text-xs text-gray-400">{row.original.bills} bill{row.original.bills === 1 ? "" : "s"}</span></span> },
    { header: "Received", id: "received", meta: { align: "right" }, accessorFn: (r) => r.received, cell: ({ row }) => <span className="text-emerald-700">{money(row.original.received)}{row.original.refunded > 0 && <span className="block text-xs text-gray-400">refunded {money(row.original.refunded)}</span>}</span> },
    { header: "Cheques to clear", id: "pending", meta: { align: "right" }, accessorFn: (r) => r.receiveChequesPending, cell: ({ getValue }) => (getValue<number>() > 0 ? <span className="text-blue-700">{money(getValue<number>())}</span> : <span className="text-gray-300">—</span>) },
    { header: "Balance", id: "balance", meta: { align: "right" }, accessorFn: (r) => r.receivable, cell: ({ row }) => <b className={row.original.receivable > 0.005 ? "text-amber-700" : row.original.receivable < -0.005 ? "text-emerald-700" : "text-gray-400"}>{receivableText(row.original.receivable)}</b> },
    { header: "", id: "actions", enableSorting: false, enableGlobalFilter: false, cell: ({ row }) => <div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setStatement({ type: "TEXTILE", textileId: row.original.textileId, name: row.original.name })}>Account</Button><Button size="sm" onClick={() => setEntry({ kind: "RECEIPT", preset: { partyType: "TEXTILE", textileId: row.original.textileId, amount: row.original.receivable > 0 ? row.original.receivable : undefined } })}>Receive</Button></div> },
  ];
  const distributorColumns: ColumnDef<DistributorParty>[] = [
    { header: "Distributor", id: "name", accessorFn: (r) => `${r.name} ${r.code}`, cell: ({ row }) => <div><button type="button" className="customers-code text-left" onClick={() => setStatement({ type: "DISTRIBUTOR", supplierId: row.original.supplierId, name: row.original.name })}>{row.original.name}</button><span className="block text-xs text-gray-400">{row.original.code}{row.original.paymentTerms ? ` · ${row.original.paymentTerms}` : ""}{row.original.active ? "" : " · inactive"}</span></div> },
    { header: "Purchases", id: "purchased", meta: { align: "right" }, accessorFn: (r) => r.purchased, cell: ({ row }) => <span>{money(row.original.purchased)}<span className="block text-xs text-gray-400">paid {money(row.original.paid)}{row.original.payChequesPending > 0 ? ` · ${money(row.original.payChequesPending)} cheque` : ""}</span></span> },
    { header: "We owe", id: "payable", meta: { align: "right" }, accessorFn: (r) => r.payable, cell: ({ row }) => <b className={row.original.payable > 0.005 ? "text-red-700" : row.original.payable < -0.005 ? "text-emerald-700" : "text-gray-400"}>{payableText(row.original.payable)}</b> },
    { header: "Sales to them", id: "billed", meta: { align: "right" }, accessorFn: (r) => r.billed, cell: ({ row }) => <span>{money(row.original.billed)}<span className="block text-xs text-gray-400">received {money(row.original.received)}{row.original.receiveChequesPending > 0 ? ` · ${money(row.original.receiveChequesPending)} cheque` : ""}</span></span> },
    { header: "They owe", id: "receivable", meta: { align: "right" }, accessorFn: (r) => r.receivable, cell: ({ row }) => <b className={row.original.receivable > 0.005 ? "text-amber-700" : row.original.receivable < -0.005 ? "text-emerald-700" : "text-gray-400"}>{receivableText(row.original.receivable)}</b> },
    {
      header: "",
      id: "actions",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => {
        const d = row.original;
        return (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setStatement({ type: "DISTRIBUTOR", supplierId: d.supplierId, name: d.name })}>Account</Button>
            <Button size="sm" variant="outline" onClick={() => setEntry({ kind: "PAYMENT", preset: { partyType: "DISTRIBUTOR", supplierId: d.supplierId, amount: d.payable > 0 ? d.payable : undefined } })}>Pay</Button>
            {(d.billed > 0 || d.receivable !== 0) && <Button size="sm" onClick={() => setEntry({ kind: "RECEIPT", preset: { partyType: "DISTRIBUTOR", supplierId: d.supplierId, amount: d.receivable > 0 ? d.receivable : undefined } })}>Receive</Button>}
          </div>
        );
      },
    },
  ];

  const liveAccounts = accounts.filter((a) => a.active);
  const recent = (entries.data ?? []).slice(0, 8);
  const openCheques = (cheques.data ?? []).filter(isOpenCheque).sort((a, b) => (a.chequeDate ?? a.txnDate).localeCompare(b.chequeDate ?? b.txnDate));

  return (
    <div className="finance-page money-page">
      <div className="finance-page-header flex-wrap">
        <span className="finance-page-icon"><Wallet size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold md:text-xl">Money</h2>
          <p className="text-xs text-gray-500">Cash, bank and UPI balances; money received on sales and paid to distributors; cheques until they clear; and what each textile and distributor owes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEntry({ kind: "TRANSFER" })}><ArrowLeftRight size={15} /> Transfer</Button>
          <Button variant="outline" onClick={() => setExpenseOpen(true)}><Receipt size={15} /> Expense</Button>
          <Button variant="outline" onClick={() => setEntry({ kind: "PAYMENT" })}><ArrowUpCircle size={15} /> Money paid</Button>
          <Button onClick={() => setEntry({ kind: "RECEIPT" })}><ArrowDownCircle size={15} /> Money received</Button>
        </div>
      </div>

      <div className="finance-tabs" role="tablist" aria-label="Money sections">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={cn(tab === value && "is-active")} onClick={() => setTab(value)}>
            <Icon size={14} aria-hidden /> {label}
            {value === "cheques" && s.cheques.received.count + s.cheques.issued.count > 0 && <span className="finance-tabs__count">{s.cheques.received.count + s.cheques.issued.count}</span>}
          </button>
        ))}
      </div>

      <div className="finance-stats grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat tone="received" icon={Wallet} label="Money in hand & bank" value={signed(s.balances.total)} note={`Cash ${money(s.balances.cash)} · Bank ${money(s.balances.bank)} · UPI ${money(s.balances.upi)}`} onClick={() => setTab("accounts")} />
        <Stat tone="outstanding" icon={HandCoins} label="To collect" value={money(s.parties.receivable)} note={`${s.parties.textilesDue} textile${s.parties.textilesDue === 1 ? "" : "s"} · ${s.parties.distributorsDue} distributor${s.parties.distributorsDue === 1 ? "" : "s"} owe`} onClick={() => setTab("parties")} />
        <Stat tone="expenses" icon={Truck} label="To pay distributors" value={money(s.parties.payable)} note={s.parties.advancePaid > 0 ? `${money(s.parties.advancePaid)} paid in advance` : `${s.parties.distributorsToPay} to pay`} onClick={() => { setPartyView("DISTRIBUTOR"); setTab("parties"); }} />
        <Stat tone="invoiced" icon={FileCheck2} label="Cheques to clear" value={money(s.cheques.received.amount)} note={`${s.cheques.received.count} received${s.cheques.issued.count ? ` · ${s.cheques.issued.count} issued (${money(s.cheques.issued.amount)})` : ""}`} onClick={() => setTab("cheques")} />
      </div>

      {tab === "overview" && (
        <>
          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Accounts" icon={Wallet} badge={2} tone="finance-card--payment" action={<Button size="sm" variant="outline" onClick={() => setTab("accounts")}>Manage</Button>}>
              {liveAccounts.length === 0 ? (
                <div className="space-y-2 text-sm text-gray-500">
                  <p>No accounts yet. Add your cash in hand, bank accounts and UPI so every rupee has a place.</p>
                  <Button size="sm" onClick={() => setAccountDialog({})}><Plus size={14} /> Add account</Button>
                </div>
              ) : (
                liveAccounts.map((a) => {
                  const Icon = ACCOUNT_ICON[a.type];
                  return (
                    <div key={a.id} className="finance-list-row">
                      <span className={cn("finance-list-icon", (a.balance ?? 0) >= 0 ? "finance-list-icon--in" : "finance-list-icon--out")}><Icon size={13} /></span>
                      <span className="finance-list-text"><span className="font-medium">{a.name}</span><span className="block text-xs text-gray-500">{ACCOUNT_LABEL[a.type]}{a.accountNoLast4 ? ` · …${a.accountNoLast4}` : a.upiId ? ` · ${a.upiId}` : ""}</span></span>
                      <b className={cn("finance-list-amount", (a.balance ?? 0) < 0 && "text-red-700")}>{signed(a.balance ?? 0)}</b>
                    </div>
                  );
                })
              )}
            </Panel>

            <Panel title="This month" icon={ArrowDownCircle} badge={1} tone="finance-card--invoice">
              <dl className="finance-flow">
                {MODES.map((m) => {
                  const r = s.month.received.find((x) => x.mode === m)!;
                  const p = s.month.paid.find((x) => x.mode === m)!;
                  if (!r.amount && !p.amount) return null;
                  const Icon = MODE_ICON[m];
                  return (
                    <div key={m}>
                      <dt className="flex items-center gap-1.5"><Icon size={13} aria-hidden /> {MODE_LABEL[m]}</dt>
                      <dd><span className="text-emerald-700">+{money(r.amount)}</span> <span className="text-gray-300">/</span> <span className="text-rose-700">−{money(p.amount)}</span></dd>
                    </div>
                  );
                })}
                {s.month.collected > 0 && <div><dt>Collected on deliveries</dt><dd className="text-emerald-700">+{money(s.month.collected)}</dd></div>}
                <div><dt>Expenses</dt><dd className="text-rose-700">−{money(s.month.expenses)}</dd></div>
                <div className="is-total"><dt>Net this month</dt><dd className={s.month.net >= 0 ? "text-emerald-700" : "text-red-700"}>{signed(s.month.net)}</dd></div>
              </dl>
              <p className="text-[11px] text-gray-500">In {money(s.month.moneyIn)} · out {money(s.month.moneyOut)}. A cheque counts on the day it clears. The same figures are on Finance.</p>
            </Panel>

            <Panel title="Cheques waiting" icon={FileCheck2} badge={4} tone="finance-card--payments-list" action={<Button size="sm" variant="outline" onClick={() => setTab("cheques")}>All cheques</Button>}>
              {!cheques.data ? (
                cheques.error ? <p className="text-sm text-red-600">{cheques.error}</p> : <Loading />
              ) : openCheques.length === 0 ? (
                <p className="text-sm text-gray-500">No cheques waiting to clear.</p>
              ) : (
                openCheques.slice(0, 6).map((t) => (
                  <div key={t.id} className="finance-list-row">
                    <span className={cn("finance-list-icon", t.kind === "RECEIPT" ? "finance-list-icon--in" : "finance-list-icon--out")}><FileCheck2 size={13} /></span>
                    <button type="button" className="finance-list-text text-left" onClick={() => setDetails(t)}>
                      <span className="font-medium">{t.partyName}</span>
                      <span className="block text-xs text-gray-500">No {t.chequeNo} · {chequeLabel(t)} · dated {formatDate(t.chequeDate)}</span>
                    </button>
                    <b className="finance-list-amount">{money(t.amount)}</b>
                  </div>
                ))
              )}
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Panel title="Who owes what" icon={UsersRound} badge={5} action={<Button size="sm" variant="outline" onClick={() => setTab("parties")}>All parties</Button>}>
              <dl className="finance-flow">
                <div><dt>To collect from textiles & distributors</dt><dd className="text-amber-700">{money(s.parties.receivable)}</dd></div>
                <div><dt>Advances received (not yet billed)</dt><dd className="text-emerald-700">{money(s.parties.advanceReceived)}</dd></div>
                <div><dt>To pay distributors</dt><dd className="text-red-700">{money(s.parties.payable)}</dd></div>
                <div><dt>Advances paid to distributors</dt><dd className="text-emerald-700">{money(s.parties.advancePaid)}</dd></div>
              </dl>
              {parties.data && (
                <ul className="space-y-1 pt-1">
                  {parties.data.textiles.filter((t) => t.receivable > 0.005).slice(0, 4).map((t) => (
                    <li key={t.key} className="flex items-center justify-between gap-2 text-sm">
                      <button type="button" className="truncate text-left text-[#1b3c55] hover:underline" onClick={() => setStatement({ type: "TEXTILE", textileId: t.textileId, name: t.name })}>{t.name}</button>
                      <b className="text-amber-700">{money(t.receivable)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Latest entries" icon={ClipboardList} badge={3} tone="finance-card--register" action={<Button size="sm" variant="outline" onClick={() => setTab("entries")}>All entries</Button>}>
              {!entries.data ? (
                entries.error ? <p className="text-sm text-red-600">{entries.error}</p> : <Loading />
              ) : (
                <DataTable data={recent} columns={entryColumns} getRowId={(r) => r.id} minWidth={640} hideSearch pageSize={8} emptyTitle="No money entries yet" emptyDescription="Use “Money received” or “Money paid” above." />
              )}
            </Panel>
          </div>
        </>
      )}

      {tab === "accounts" && (
        <Panel title="Cash, bank & UPI accounts" icon={Wallet} badge={2} tone="finance-card--payment" action={<Button size="sm" onClick={() => setAccountDialog({})}><Plus size={14} /> Add account</Button>}>
          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <ShieldCheck size={14} className="mt-px shrink-0 text-emerald-700" aria-hidden />
            Bank account numbers are stored encrypted. Only the last 4 digits are shown{isSuperAdmin ? "; you can view the full number for 30 seconds, and each view is recorded in the audit log" : "; only a super admin can view the full number"}.
          </p>
          {encryptionProblem(security.data) && (
            <p className="money-note money-note--warn" role="status">
              {encryptionProblem(security.data)} Everything else (balances, entries, cheques) works normally.
            </p>
          )}
          {s.unassignedPayments > 0 && <p className="money-note">{s.unassignedPayments} older distributor payment{s.unassignedPayments === 1 ? " was" : "s were"} recorded before accounts existed. They count for the distributor but are not in any account balance; set each account&apos;s opening balance to today&apos;s real balance.</p>}
          {accounts.length === 0 ? (
            <p className="text-sm text-gray-500">No accounts yet.</p>
          ) : (
            <div className="money-accounts">
              {accounts.map((a) => {
                const Icon = ACCOUNT_ICON[a.type];
                const shown = revealed?.id === a.id;
                return (
                  <article key={a.id} className={cn("money-account", `money-account--${a.type.toLowerCase()}`, !a.active && "is-inactive")}>
                    <div className="flex items-start gap-2.5">
                      <span className="money-account__icon"><Icon size={16} aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-[#1b3c55]">{a.name}</p>
                        <p className="truncate text-xs text-gray-500">{ACCOUNT_LABEL[a.type]}{a.bankName ? ` · ${a.bankName}` : ""}{a.branch ? `, ${a.branch}` : ""}{a.active ? "" : " · inactive"}</p>
                      </div>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${a.name}`} onClick={() => setAccountDialog({ account: a })}><Pencil size={14} /></Button>
                    </div>
                    <p className={cn("money-account__balance", (a.balance ?? 0) < 0 && "text-red-700")}>{signed(a.balance ?? 0)}</p>
                    <dl className="money-account__meta">
                      {a.type === "BANK" && (
                        <div>
                          <dt>A/c no</dt>
                          <dd className="flex items-center gap-1 font-mono">
                            {shown ? revealed.accountNo : a.accountNoMasked ?? "Not saved"}
                            {isSuperAdmin && a.hasAccountNo && security.data?.ready && !security.data.keyChanged && (
                              <button type="button" className="text-gray-400 hover:text-[#1b3c55]" aria-label={shown ? "Hide account number" : "Show account number"} onClick={() => (shown ? setRevealed(null) : void reveal(a))}>
                                {shown ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            )}
                          </dd>
                        </div>
                      )}
                      {a.ifsc && <div><dt>IFSC</dt><dd className="font-mono">{a.ifsc}</dd></div>}
                      {a.upiId && <div><dt>UPI</dt><dd className="truncate">{a.upiId}</dd></div>}
                      <div><dt>In / out</dt><dd><span className="text-emerald-700">{money(a.moneyIn)}</span> / <span className="text-rose-700">{money(a.moneyOut)}</span></dd></div>
                      {(a.chequesToClear ?? 0) > 0 && <div><dt>Cheques to clear</dt><dd className="text-blue-700">+{money(a.chequesToClear)}</dd></div>}
                      {(a.chequesIssued ?? 0) > 0 && <div><dt>Cheques issued</dt><dd className="text-amber-700">−{money(a.chequesIssued)}</dd></div>}
                      <div><dt>Opening</dt><dd>{money(a.openingBalance)}</dd></div>
                    </dl>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setCashbook(a)}><BookOpen size={14} /> Cash book</Button>
                      <Button size="sm" variant="outline" onClick={() => { setAccountFilter(a.id); setTab("entries"); }}>Entries</Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {tab === "entries" && (
        <Panel
          title="Money entries"
          icon={ClipboardList}
          badge={3}
          tone="finance-card--register"
          action={<Button size="sm" variant="outline" disabled={!entries.data?.length} onClick={() => exportEntries(entries.data ?? [])}><Download size={14} /> Export</Button>}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Chips label="Kind" value={kind} onChange={setKind} options={[{ value: "ALL", label: "All" }, { value: "RECEIPT", label: "Received" }, { value: "PAYMENT", label: "Paid" }, { value: "TRANSFER", label: "Transfers" }]} />
            <select className="erp-input w-auto" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode">
              <option value="ALL">All modes</option>
              {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
            <select className="erp-input w-auto" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Account">
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{accountText(a)}</option>)}
            </select>
            <Field label="From" className="w-36"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To" className="w-36"><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
            <label className="flex h-11 items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled</label>
          </div>
          {entries.data && (
            <p className="text-xs text-gray-500">
              {entries.data.length} entr{entries.data.length === 1 ? "y" : "ies"} · received <b className="text-emerald-700">{money(entries.data.filter((t) => t.kind === "RECEIPT" && t.counted).reduce((sum, t) => sum + t.amount, 0))}</b> · paid <b className="text-rose-700">{money(entries.data.filter((t) => t.kind === "PAYMENT" && t.counted).reduce((sum, t) => sum + t.amount, 0))}</b> (counted)
            </p>
          )}
          {!entries.data ? (
            entries.error ? <ErrorState message={entries.error} onRetry={() => void entries.reload()} /> : <Loading />
          ) : (
            <DataTable data={entries.data} columns={entryColumns} getRowId={(r) => r.id} minWidth={760} pageSize={25} searchPlaceholder="Search entry, party, bill, reference, cheque..." emptyTitle="No entries" emptyDescription="Try other filters, or record money received / paid." />
          )}
        </Panel>
      )}

      {tab === "cheques" && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <Stat tone="outstanding" icon={FileCheck2} label="Received · to deposit" value={money(s.cheques.toDeposit.amount)} note={`${s.cheques.toDeposit.count} cheque${s.cheques.toDeposit.count === 1 ? "" : "s"} in hand`} onClick={() => setChequeFilter("TO_DEPOSIT")} />
            <Stat tone="invoiced" icon={Building2} label="Deposited · to clear" value={money(s.cheques.deposited.amount)} note={`${s.cheques.deposited.count} waiting for the bank`} onClick={() => setChequeFilter("DEPOSITED")} />
            <Stat tone="received" icon={ArrowDownCircle} label="Cleared this month" value={money(s.cheques.clearedInMonth.amount)} note={`${s.cheques.clearedInMonth.count} received · ${money(s.cheques.clearedOutMonth.amount)} paid out`} onClick={() => setChequeFilter("CLEARED")} />
            <Stat tone="expenses" icon={ArrowUpCircle} label="Issued · not cleared" value={money(s.cheques.issued.amount)} note={`${s.cheques.issued.count} issued${s.cheques.bouncedMonth.count ? ` · ${s.cheques.bouncedMonth.count} bounced this month` : ""}`} onClick={() => setChequeFilter("ISSUED")} />
          </div>
          <Panel
            title="Cheques"
            icon={FileCheck2}
            badge={4}
            tone="finance-card--register"
            action={<Button size="sm" variant="outline" disabled={!chequeRows.rows.length} onClick={() => exportEntries(chequeRows.rows.filter(chequeRows.match[chequeFilter]))}><Download size={14} /> Export</Button>}
          >
            <Chips
              label="Cheque status"
              value={chequeFilter}
              onChange={setChequeFilter}
              options={(["TO_DEPOSIT", "DEPOSITED", "ISSUED", "CLEARED", "BOUNCED", "ALL"] as ChequeFilter[]).map((value) => ({
                value,
                label: { TO_DEPOSIT: "To deposit", DEPOSITED: "Deposited", ISSUED: "Issued", CLEARED: "Cleared", BOUNCED: "Bounced", ALL: "All" }[value],
                count: chequeRows.rows.filter(chequeRows.match[value]).length,
              }))}
            />
            {!cheques.data ? (
              cheques.error ? <ErrorState message={cheques.error} onRetry={() => void cheques.reload()} /> : <Loading />
            ) : (
              <DataTable data={chequeRows.rows.filter(chequeRows.match[chequeFilter])} columns={chequeColumns} getRowId={(r) => r.id} minWidth={900} pageSize={25} searchPlaceholder="Search cheque no, party, bank..." emptyTitle="No cheques here" emptyDescription="Record a cheque with “Money received” or “Money paid” and choose Cheque." />
            )}
          </Panel>
        </>
      )}

      {tab === "expenses" && <ExpensesTab accounts={accounts} version={expenseVersion} onAdd={() => setExpenseOpen(true)} onChanged={reload} />}

      {tab === "parties" && (
        <Panel
          title={partyView === "TEXTILE" ? "Textiles: billed, received, to collect" : "Distributors: purchases and sales"}
          icon={UsersRound}
          badge={5}
          tone="finance-card--register"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Chips
                label="Party type"
                value={partyView}
                onChange={setPartyView}
                options={[
                  { value: "TEXTILE", label: "Textiles", count: parties.data?.textiles.length },
                  { value: "DISTRIBUTOR", label: "Distributors", count: parties.data?.distributors.length },
                ]}
              />
              <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only with a balance</label>
              <Button
                size="sm"
                variant="outline"
                disabled={!parties.data}
                onClick={() =>
                  parties.data &&
                  (partyView === "TEXTILE"
                    ? downloadCsv(`textile-balances-${todayInput()}.csv`, ["Textile", "Phone", "Bills", "Billed", "Received", "Refunded", "Cheques to clear", "Balance (+ to collect, − advance)"], parties.data.textiles.map((t) => [t.name, t.phone, t.bills, t.billed.toFixed(2), t.received.toFixed(2), t.refunded.toFixed(2), t.receiveChequesPending.toFixed(2), t.receivable.toFixed(2)]))
                    : downloadCsv(`distributor-balances-${todayInput()}.csv`, ["Code", "Distributor", "Opening", "Purchased", "Paid", "Pay cheques to clear", "We owe (− advance paid)", "Sold to them", "Received", "Receive cheques to clear", "They owe (− advance)"], parties.data.distributors.map((d) => [d.code, d.name, d.openingBalance.toFixed(2), d.purchased.toFixed(2), d.paid.toFixed(2), d.payChequesPending.toFixed(2), d.payable.toFixed(2), d.billed.toFixed(2), d.received.toFixed(2), d.receiveChequesPending.toFixed(2), d.receivable.toFixed(2)])))
                }
              >
                <Download size={14} /> Export
              </Button>
            </div>
          }
        >
          {!parties.data ? (
            parties.error ? <ErrorState message={parties.error} onRetry={() => void parties.reload()} /> : <Loading />
          ) : partyView === "TEXTILE" ? (
            <DataTable
              data={parties.data.textiles.filter((t) => !onlyOpen || Math.abs(t.receivable) > 0.005 || t.receiveChequesPending > 0)}
              columns={textileColumns}
              getRowId={(r) => r.key}
              minWidth={860}
              pageSize={25}
              searchPlaceholder="Search textile..."
              emptyTitle={onlyOpen ? "No textile has a balance" : "No textiles yet"}
              emptyDescription="Textiles appear here from sales and money received from them."
            />
          ) : (
            <DataTable
              data={parties.data.distributors.filter((d) => !onlyOpen || Math.abs(d.payable) > 0.005 || Math.abs(d.receivable) > 0.005 || d.payChequesPending > 0 || d.receiveChequesPending > 0)}
              columns={distributorColumns}
              getRowId={(r) => r.key}
              minWidth={1000}
              pageSize={25}
              searchPlaceholder="Search distributor..."
              emptyTitle={onlyOpen ? "No distributor has a balance" : "No distributors yet"}
            />
          )}
          <p className="text-[11px] text-gray-500">Balances count cleared money only; cheques still to clear are shown on their own. Open “Account” for the full statement with every bill and payment.</p>
        </Panel>
      )}

      {entry && <MoneyEntryDialog kind={entry.kind} preset={entry.preset} lockKind={!!entry.preset} onClose={() => setEntry(null)} onSaved={reload} />}
      {accountDialog && <MoneyAccountDialog account={accountDialog.account} onClose={() => setAccountDialog(null)} onSaved={reload} />}
      {details && <TxnDetailsDialog txn={details} accounts={accounts} onClose={() => setDetails(null)} onChanged={reload} />}
      {chequeAction && <ChequeActionDialog txn={chequeAction.txn} action={chequeAction.action} accounts={accounts} onClose={() => setChequeAction(null)} onDone={reload} />}
      {statement && <StatementDialog party={statement} onClose={() => setStatement(null)} onChanged={reload} />}
      {cashbook && <CashbookDialog account={cashbook} onClose={() => setCashbook(null)} />}
      {expenseOpen && (
        <ExpenseDialog
          onClose={() => setExpenseOpen(false)}
          onSaved={() => {
            setExpenseVersion((v) => v + 1);
            reload();
          }}
        />
      )}
    </div>
  );
}
