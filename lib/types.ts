export type Role = "SUPERADMIN" | "ADMIN" | "MANAGER" | "STAFF";
export type User = { id: string; name: string; email: string; role: Role };

export type StockCategory =
  | "RAW_MATERIAL"
  | "YARN"
  | "GREY_FABRIC"
  | "DYED_FABRIC"
  | "CHEMICAL"
  | "FINISHED_FABRIC"
  | "PACKING";

export const STOCK_CATEGORIES: StockCategory[] = [
  "YARN",
  "RAW_MATERIAL",
  "GREY_FABRIC",
  "DYED_FABRIC",
  "CHEMICAL",
  "FINISHED_FABRIC",
  "PACKING",
];

export const MACHINE_STATUSES = ["RUNNING", "IDLE", "MAINTENANCE", "BREAKDOWN", "DISABLED"] as const;

export type Warehouse = { id: string; code: string; name: string; location?: string | null; active?: boolean };

/** Shape of `GET /dashboard` (`data`). Money fields are null for non-admins. */
export type DashboardData = {
  generatedAt: string;
  isAdmin: boolean;
  production: {
    stages: Array<{ key: "PURCHASED" | "KNITTING" | "DYEING" | "COMPACTING" | "AT_OFFICE"; count: number }>;
    active: number;
    readyKg: number;
    /** Finished fabric delivered to parties (not into own warehouses). */
    deliveredThisMonth: { count: number; kg: number; amount: number | null };
    batches: Array<{
      id: string;
      flowNo: string;
      status: string;
      fabric: string;
      color: string | null;
      startedKg: number;
      currentKg: number;
      lossPct: number;
      daysInStage: number;
      dueDate: string | null;
      place: string;
    }>;
    lastDeliveryAt: string | null;
  };
  machines: {
    total: number;
    byStatus: Record<string, number>;
    knitting: number;
    yarnOnMachinesKg: number;
    finishedToday: { count: number; kg: number };
    knittingTasks: number;
    running: Array<{ id: string; runNo: string; machineId: string; machine: string; startedAt: string; startShift: "DAY" | "NIGHT"; yarnKg: number }>;
  };
  trend: Array<{ date: string; yarnInKg: number; knittedKg: number; deliveredKg: number; soldKg: number }>;
  stockKg: Record<"YARN" | "GREY_FABRIC" | "DYED_FABRIC" | "FINISHED_FABRIC", number>;
  purchases: {
    open: number;
    overdue: number;
    toArriveValue: number | null;
    next: Array<{ id: string; poNo: string; supplier: string; expectedDate: string | null }>;
  };
  awaitingFabric: { count: number; kg: number };
  sales: {
    waiting: number;
    sentBack: number;
    /** Dispatched bills dated this month; `amount` (with GST) for admins only. */
    thisMonth: { count: number; kg: number; amount: number | null };
    /** Latest bills, admins only. */
    recent: Array<{
      id: string;
      saleNo: string;
      saleDate: string;
      party: string;
      status: "PENDING" | "REJECTED" | "DISPATCHED" | "CANCELLED";
      total: number;
      payment: "PAID" | "PART_PAID" | "UNPAID" | "CHEQUE_PENDING";
    }>;
  };
  money: {
    payable: number;
    distributorsOwed: number;
    /** Still to collect on bills, and how many parties owe. */
    receivable: number;
    partiesDue: number;
    advanceReceived: number;
    balances: { cash: number; bank: number; upi: number; total: number };
    /** Cheques not cleared yet: received from parties, and issued by us. */
    chequesIn: { count: number; amount: number };
    chequesOut: { count: number; amount: number };
    /** The same calculation as the Money and Finance pages. */
    month: { moneyIn: number; receivedTotal: number; collected: number; moneyOut: number; paidTotal: number; supplierPaid: number; otherPaid: number; expenses: number; net: number };
  } | null;
  attention: Array<{ tone: "danger" | "warning" | "info"; text: string; href: string }>;
  alerts: Array<{
    id: string;
    title: string;
    message: string;
    type: string;
    priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    createdAt: string;
  }>;
  unreadNotifications: number;
  /** The latest processes completed (knitting, dyeing, compacting, machine runs), read or not. */
  processUpdates: Array<{
    id: string;
    title: string;
    message: string;
    priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    isRead: boolean;
    createdAt: string;
    referenceType: string | null;
    referenceId: string | null;
  }>;
};

