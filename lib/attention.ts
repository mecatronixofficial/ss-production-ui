import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CheckCircle2,
  Droplets,
  Factory,
  FlaskConical,
  ReceiptIndianRupee,
  ShoppingCart,
  Sparkles,
  Truck,
  Wallet,
  Warehouse,
  Wrench,
} from "lucide-react";

/**
 * What an alert, a "needs attention" item or a notification is about, so every list shows it with the same icon and
 * colour: machines, the warehouses, purchases, sales, money, production, deliveries or quality.
 */
export type AttentionKind = "machines" | "warehouse" | "purchases" | "sales" | "money" | "production" | "delivery" | "quality" | "system";

export const ATTENTION_KINDS: Record<AttentionKind, { label: string; icon: LucideIcon }> = {
  machines: { label: "Machines", icon: Wrench },
  warehouse: { label: "Warehouse", icon: Warehouse },
  purchases: { label: "Purchases", icon: ShoppingCart },
  sales: { label: "Sales", icon: ReceiptIndianRupee },
  money: { label: "Money", icon: Wallet },
  production: { label: "Production", icon: Factory },
  delivery: { label: "Delivery", icon: Truck },
  quality: { label: "Quality", icon: FlaskConical },
  system: { label: "Notice", icon: Bell },
};

/** The kind from where the item's link goes, for items that don't say (e.g. figures saved by an older build). */
export function kindOfHref(href: string): AttentionKind {
  if (href.startsWith("/masters/machines")) return "machines";
  if (href.startsWith("/warehouses") || href.startsWith("/godown")) return "warehouse";
  if (href.startsWith("/purchases")) return "purchases";
  if (href.startsWith("/sales")) return "sales";
  if (href.startsWith("/money") || href.startsWith("/finance")) return "money";
  if (href.startsWith("/production")) return "production";
  if (href.startsWith("/challans")) return "delivery";
  return "system";
}

type NotificationLike = { type: string; title: string; message?: string; referenceType?: string | null };

/** A notification's kind: by its type first, then by what it refers to. */
export function notificationKind(n: NotificationLike): AttentionKind {
  switch (n.type) {
    case "MACHINE_BREAKDOWN":
    case "MAINTENANCE_DUE":
      return "machines";
    case "LOW_STOCK":
    case "STOCK_DIFFERENCE":
      return "warehouse";
    case "DELIVERY_DUE":
    case "DELIVERY_DELAYED":
      return "delivery";
    case "PAYMENT_DUE":
      return "money";
    case "ORDER_DUE":
    case "ORDER_READY":
    case "ORDER_COMPLETED":
      return "sales";
    case "QC_FAILED":
    case "QC_PASSED":
    case "HIGH_WASTAGE":
      return "quality";
    case "JOB_ASSIGNED":
    case "JOB_STARTED":
    case "JOB_COMPLETED":
      return n.referenceType === "KnittingRun" ? "machines" : "production";
  }
  switch (n.referenceType) {
    case "KnittingRun":
    case "Machine":
      return "machines";
    case "ProductionBatch":
    case "FabricProductionFlow":
      return "production";
    case "Sale":
      return "sales";
    case "PurchaseOrder":
    case "PurchaseReceipt":
      return "purchases";
    case "MoneyTransaction":
      return "money";
  }
  return "system";
}

/** A notification's icon: the process itself for production (dyeing, compacting, knitting), else its kind's. */
export function notificationIcon(n: NotificationLike): LucideIcon {
  const kind = notificationKind(n);
  if (kind === "production") {
    const text = `${n.title} ${n.message ?? ""}`.toLowerCase();
    if (text.includes("dye")) return Droplets;
    if (text.includes("compact")) return Sparkles;
    if (text.includes("knit")) return Factory;
    if (n.type === "JOB_COMPLETED") return CheckCircle2;
  }
  return ATTENTION_KINDS[kind].icon;
}
