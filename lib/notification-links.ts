/** What a notification refers to, as the API gives it. */
export type NotificationRef = { referenceType?: string | null; referenceId?: string | null };

/**
 * Where a notification leads: the PO or sale for admins (the Warehouses page, where they receive and dispatch, for
 * godown staff), a production batch, a knitting run. Used by the Notifications page, the dashboard and the pop-ups.
 */
export function notificationLink(n: NotificationRef, isAdmin: boolean): { href: string; label: string } | null {
  if (!n.referenceType) return null;
  switch (n.referenceType) {
    case "PurchaseOrder":
      return isAdmin && n.referenceId ? { href: `/purchases/${n.referenceId}`, label: "Open purchase order" } : { href: "/warehouses", label: "Open warehouse" };
    case "PurchaseReceipt":
      return isAdmin ? { href: "/purchases", label: "Open purchases" } : { href: "/warehouses", label: "Open warehouse" };
    case "Sale":
      return isAdmin && n.referenceId ? { href: `/sales/${n.referenceId}`, label: "Open sale" } : { href: "/warehouses", label: "Open warehouse" };
    // A process completed on a production batch (the reference is its code).
    case "ProductionBatch":
      return n.referenceId ? { href: `/production?batch=${encodeURIComponent(n.referenceId)}`, label: "Open batch" } : { href: "/production", label: "Open production" };
    // A knitting run finished on a machine (the reference is the run's code; same page as runHref on Machines).
    case "KnittingRun":
      return n.referenceId ? { href: `/masters/machines/run?code=${encodeURIComponent(n.referenceId)}`, label: "Open run" } : { href: "/masters/machines", label: "Open machines" };
    // Fabric sent from production to a warehouse, to receive there.
    case "FabricProductionFlow":
      return { href: "/warehouses", label: "Open warehouse" };
    default:
      return null;
  }
}
