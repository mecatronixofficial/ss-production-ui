import type { BadgeTone } from "@/components/ui/badge";
import { money } from "@/lib/utils";

/** Shapes returned by `/money/*`. Amounts are numbers. */
export type PaymentMode = "CASH" | "UPI" | "BANK" | "CHEQUE";
export type AccountType = "CASH" | "BANK" | "UPI";
export type TxnKind = "RECEIPT" | "PAYMENT" | "TRANSFER";
export type PartyType = "DISTRIBUTOR" | "TEXTILE" | "OTHER";
export type ChequeStatus = "PENDING" | "DEPOSITED" | "CLEARED" | "BOUNCED";

export type MoneyAccount = {
  id: string;
  type: AccountType;
  name: string;
  bankName: string | null;
  branch: string | null;
  ifsc: string | null;
  accountHolder: string | null;
  accountNoLast4: string | null;
  accountNoMasked: string | null;
  hasAccountNo: boolean;
  upiId: string | null;
  openingBalance: number;
  notes: string | null;
  active: boolean;
  createdAt: string;
  /** Only from `/money/accounts` and the summary. */
  balance?: number;
  moneyIn?: number;
  moneyOut?: number;
  chequesToClear?: number;
  chequesIssued?: number;
  lastTxnAt?: string | null;
};

export type MoneyTxn = {
  id: string;
  txnNo: string;
  kind: TxnKind;
  txnDate: string;
  mode: PaymentMode;
  amount: number;
  account: { id: string; name: string; type: AccountType } | null;
  toAccount: { id: string; name: string; type: AccountType } | null;
  partyType: PartyType | null;
  supplierId: string | null;
  supplier: { id: string; code: string; name: string } | null;
  textileId: string | null;
  textile: { id: string; code: string; name: string } | null;
  partyName: string | null;
  saleId: string | null;
  sale: { id: string; saleNo: string; totalAmount: number; status: string } | null;
  referenceNo: string | null;
  chequeNo: string | null;
  chequeDate: string | null;
  chequeBank: string | null;
  chequeStatus: ChequeStatus | null;
  depositedAt: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  bounceReason: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  /** Counts toward balances: not cancelled, and not a cheque still to clear or bounced. */
  counted: boolean;
};

export type OpenSale = {
  id: string;
  saleNo: string;
  saleDate: string;
  status: string;
  partyType: "DISTRIBUTOR" | "TEXTILE";
  supplierId: string | null;
  textileId: string | null;
  partyName: string;
  totalAmount: number;
  /** Still to receive, counting cheques not yet cleared as received. */
  open: number;
};

/** One textile per name, however it is typed: "  Sri  Murugan TEX " and "sri murugan tex" are the same (as on the server). */
export const textileNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** `/money/security`: whether bank account numbers can be saved and read on this server. */
export type EncryptionStatus = { ready: boolean; keyChanged: boolean; savedNumbers: number };

/** Plain-language status for the account number field, or null when everything is fine. */
export const encryptionProblem = (s?: EncryptionStatus) =>
  !s
    ? null
    : !s.ready
      ? "Saving bank account numbers is switched off on this server: the encryption key (DATA_ENCRYPTION_KEY) is not set. Save the account now without the number and add it later, once the administrator has set the key and restarted the backend."
      : s.keyChanged
        ? "The server's encryption key is different from the one the saved account numbers were stored with, so they can't be read or changed. The administrator must put the original DATA_ENCRYPTION_KEY back in the backend .env and restart."
        : null;

export type MoneyContext = {
  accounts: MoneyAccount[];
  distributors: Array<{ id: string; code: string; name: string; active: boolean }>;
  textiles: Array<{ id: string; code: string; name: string; active: boolean }>;
  others: string[];
  openSales: OpenSale[];
};

export type DistributorParty = {
  type: "DISTRIBUTOR";
  key: string;
  supplierId: string;
  code: string;
  name: string;
  active: boolean;
  phone: string | null;
  paymentTerms: string | null;
  openingBalance: number;
  purchased: number;
  paid: number;
  payChequesPending: number;
  /** We owe them (minus: advance paid to them). */
  payable: number;
  billed: number;
  bills: number;
  received: number;
  receiveChequesPending: number;
  /** They owe us on sales (minus: advance received from them). */
  receivable: number;
  lastActivity: string | null;
};
export type TextileParty = {
  type: "TEXTILE";
  key: string;
  textileId: string;
  code: string;
  name: string;
  active: boolean;
  phone: string | null;
  paymentTerms: string | null;
  creditLimit: number | null;
  openingBalance: number;
  billed: number;
  bills: number;
  received: number;
  receiveChequesPending: number;
  refunded: number;
  receivable: number;
  lastActivity: string | null;
};
export type PartyTotals = {
  receivable: number;
  advanceReceived: number;
  payable: number;
  advancePaid: number;
  textilesDue: number;
  distributorsToPay: number;
  distributorsDue: number;
};
export type Parties = { distributors: DistributorParty[]; textiles: TextileParty[]; totals: PartyTotals };

export type StatementLine = {
  date: string;
  kind: "OPENING" | "SALE" | "GOODS" | "RECEIPT" | "PAYMENT";
  ref: string;
  refId: string | null;
  text: string;
  debit: number;
  credit: number;
  counted: boolean;
  status: ChequeStatus | null;
  balance: number;
};
export type Statement = {
  party: { type: PartyType; supplierId: string | null; code: string | null; name: string; phone: string | null; gst: string | null };
  opening: number;
  lines: StatementLine[];
  totals: { debit: number; credit: number; chequesPending: number; balance: number };
};

type ModeTotal = { mode: PaymentMode; amount: number; count: number };
type CountAmount = { count: number; amount: number };

/** Money in and out over a period: the one calculation behind Money, Finance, the Dashboard and the Monthly report. */
export type CashFlow = {
  from: string;
  to: string;
  received: ModeTotal[];
  paid: ModeTotal[];
  receivedTotal: number;
  paidTotal: number;
  /** Collected on production deliveries (Production page; not in any account). */
  collected: number;
  deliveries: number;
  supplierPaid: number;
  otherPaid: number;
  expenses: number;
  expenseCount: number;
  moneyIn: number;
  moneyOut: number;
  net: number;
};

export type Expense = {
  id: string;
  expenseNo: string;
  expenseDate: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  amount: number;
  paymentMode: string;
  account: { id: string; name: string; type: AccountType } | null;
  createdBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};

export type CashbookLine = {
  id: string;
  date: string;
  ref: string;
  kind: "RECEIPT" | "PAYMENT" | "TRANSFER_IN" | "TRANSFER_OUT" | "EXPENSE";
  text: string;
  mode: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
};
export type Cashbook = {
  account: MoneyAccount;
  opening: number;
  lines: CashbookLine[];
  totals: { moneyIn: number; moneyOut: number; balance: number };
  openCheques: MoneyTxn[];
};

/** `/finance/overview`: one period's results. */
export type FinanceOverview = {
  period: { from: string; to: string };
  earned: {
    salesTaxable: number;
    salesGst: number;
    salesTotal: number;
    salesCount: number;
    textiles: CountAmount;
    distributors: CountAmount;
    collected: number;
    deliveries: number;
    total: number;
  };
  spent: { purchases: number; purchaseReceipts: number; expenses: number; expenseCount: number; batchCosts: number; batchCostCount: number; total: number };
  result: number;
  cashFlow: CashFlow;
  months: Array<{ month: string; moneyIn: number; moneyOut: number; net: number; received: number; collected: number; paid: number; expenses: number }>;
  expensesByCategory: Array<{ category: string; amount: number; count: number }>;
  position: PartyTotals & { inAccounts: number; accounts: number };
};

export const EXPENSE_CATEGORIES = ["Power", "Wages", "Transport", "Maintenance", "Machine spares", "Chemicals", "Packing", "Diesel / Generator", "Rent", "Office", "Other"];

/** A mode label for an expense; older expenses keep NEFT / RTGS / CARD as typed. */
export const expenseModeLabel = (mode: string) => (mode in MODE_LABEL ? MODE_LABEL[mode as PaymentMode] : mode);
export type MoneySummary = {
  accounts: MoneyAccount[];
  balances: { cash: number; bank: number; upi: number; total: number };
  cheques: {
    toDeposit: CountAmount;
    deposited: CountAmount;
    received: CountAmount;
    issued: CountAmount;
    clearedInMonth: CountAmount;
    clearedOutMonth: CountAmount;
    bouncedMonth: CountAmount;
  };
  month: CashFlow;
  parties: PartyTotals;
  unassignedPayments: number;
};

export const MODES: PaymentMode[] = ["CASH", "UPI", "BANK", "CHEQUE"];
export const MODE_LABEL: Record<PaymentMode, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank transfer", CHEQUE: "Cheque" };
export const MODE_HINT: Record<PaymentMode, string> = {
  CASH: "Cash in hand",
  UPI: "GPay / PhonePe / Paytm",
  BANK: "NEFT / RTGS / IMPS",
  CHEQUE: "Counts when cleared",
};
export const ACCOUNT_LABEL: Record<AccountType, string> = { CASH: "Cash", BANK: "Bank", UPI: "UPI" };
export const KIND_LABEL: Record<TxnKind, string> = { RECEIPT: "Received", PAYMENT: "Paid", TRANSFER: "Transfer" };
export const PARTY_TYPE_LABEL: Record<PartyType, string> = { DISTRIBUTOR: "Distributor", TEXTILE: "Textile", OTHER: "Other" };
export const CHEQUE_LABEL: Record<ChequeStatus, string> = { PENDING: "To deposit", DEPOSITED: "Deposited", CLEARED: "Cleared", BOUNCED: "Bounced" };

/** Which accounts each mode can go through (same rule as the server). */
export const ACCOUNT_TYPES_FOR: Record<PaymentMode, AccountType[]> = { CASH: ["CASH"], UPI: ["UPI", "BANK"], BANK: ["BANK"], CHEQUE: ["BANK"] };

export const chequeTone = (status: ChequeStatus | null): BadgeTone =>
  status === "CLEARED" ? "success" : status === "BOUNCED" ? "danger" : status === "DEPOSITED" ? "info" : "warning";

/** The cheque's status label; an issued cheque is "Issued" until it clears. */
export const chequeLabel = (t: Pick<MoneyTxn, "kind" | "chequeStatus">) =>
  t.chequeStatus === "PENDING" && t.kind === "PAYMENT" ? "Issued" : t.chequeStatus ? CHEQUE_LABEL[t.chequeStatus] : "";

export const isOpenCheque = (t: Pick<MoneyTxn, "mode" | "chequeStatus" | "cancelledAt">) =>
  !t.cancelledAt && t.mode === "CHEQUE" && (t.chequeStatus === "PENDING" || t.chequeStatus === "DEPOSITED");

/** "SBI Current · XXXX 1234" */
export const accountText = (a: Pick<MoneyAccount, "name" | "accountNoLast4" | "upiId" | "type">) =>
  [a.name, a.type === "BANK" && a.accountNoLast4 ? `…${a.accountNoLast4}` : a.type === "UPI" ? a.upiId : null].filter(Boolean).join(" · ");

/** Party balance from our side: "₹500 to collect" / "₹500 advance". */
export const receivableText = (value: number) => (Math.abs(value) < 0.005 ? "Settled" : value > 0 ? `${money(value)} to collect` : `${money(-value)} advance`);
export const payableText = (value: number) => (Math.abs(value) < 0.005 ? "Settled" : value > 0 ? `${money(value)} to pay` : `${money(-value)} advance paid`);

/** `YYYY-MM-DD` from a date input → ISO at local noon, so the day never shifts across time zones. */
export const dayIso = (day: string) => new Date(`${day}T12:00:00`).toISOString();

export const SALE_PAYMENT_LABEL = { PAID: "Paid", PART_PAID: "Part paid", UNPAID: "Unpaid", CHEQUE_PENDING: "Cheque to clear" } as const;
export type SalePaymentStatus = keyof typeof SALE_PAYMENT_LABEL;
export const salePaymentTone = (status: SalePaymentStatus): BadgeTone =>
  status === "PAID" ? "success" : status === "UNPAID" ? "danger" : status === "CHEQUE_PENDING" ? "info" : "warning";
