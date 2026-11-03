"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, BellRing, ChevronRight, Factory, FileText, PartyPopper, ReceiptIndianRupee, ShoppingCart, X, type LucideIcon } from "lucide-react";
import { dueText, isOverdue, remainingText, type PurchaseOrder } from "@/lib/purchases";
import { PARTY_LABEL, type Sale } from "@/lib/sales";
import { cn, formatDate, kg } from "@/lib/utils";
import { quantity } from "@/lib/warehouses";
import { Button } from "@/components/ui/button";
import { fabricOf, stageMaterial, type IncomingFabric } from "./receive-fabric-dialog";

type Negative = { itemCode: string; itemName: string; lotNo: string | null; unit: string; balanceKg: number };

/**
 * One kind of pending work: a compact coloured tile with its icon, count and one-line summary. Clicking it opens every
 * item in a window (scrolling inside), so a long list doesn't push the page down. Any action in the list closes it.
 */
function ActionCard({ tone, icon: Icon, title, count, summary, children }: { tone: string; icon: LucideIcon; title: string; count: number; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={cn("wh-note", `is-${tone}`)}>
          <span className="wh-note__icon"><Icon size={17} /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="wh-note__title">{title}</span>
            <span className="wh-note__summary">{summary}</span>
          </span>
          <span className="wh-note__count">{count}</span>
          <ChevronRight size={16} className="wh-note__go" aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className={cn("wh-note-dialog", `is-${tone}`)} aria-describedby={undefined}>
          <header className="wh-note-dialog__head">
            <span className="wh-note__icon"><Icon size={18} /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="wh-note-dialog__title">
                {title} <span className="wh-note__count">{count}</span>
              </Dialog.Title>
              <p className="wh-note__summary">{summary}</p>
            </div>
            <Dialog.Close className="wh-note-dialog__close" aria-label="Close"><X size={17} /></Dialog.Close>
          </header>
          <ul
            className="wh-note-dialog__list"
            onClick={(e) => {
              // An action (dispatch, receive, show…) takes over: this window gets out of the way.
              if ((e.target as HTMLElement).closest("button, a")) setOpen(false);
            }}
          >
            {children}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Everything waiting at a warehouse, each kind in its own card: sales to dispatch, purchase orders and production fabric
 * to receive, movements without a bill and stock below zero. A card shows only while something is pending, so finished
 * work disappears. With callbacks the buttons act here; otherwise they open the warehouse's stock page (`actionsHref`).
 */
export function ActionCenter({
  sales,
  purchaseOrders,
  fabric,
  unbilled,
  negatives,
  canEdit,
  canBill,
  inactive = false,
  onDispatch,
  onReceivePo,
  onReceiveFabric,
  onShowUnbilled,
  onShowNegatives,
  onClearUnbilled,
  onIssueAll,
  actionsHref,
}: {
  sales: Sale[];
  purchaseOrders: PurchaseOrder[];
  fabric: IncomingFabric[];
  unbilled: number | null;
  negatives: Negative[];
  canEdit: boolean;
  canBill: boolean;
  inactive?: boolean;
  onDispatch?: (sale: Sale) => void;
  onReceivePo?: (id: string) => void;
  onReceiveFabric?: (delivery: IncomingFabric) => void;
  onShowUnbilled?: () => void;
  onShowNegatives?: () => void;
  /** Admins: clear old movements without a challan as needing none. */
  onClearUnbilled?: () => void;
  /** Admins: issue a challan for every movement still waiting for one. */
  onIssueAll?: () => void;
  actionsHref?: string;
}) {
  const overdue = purchaseOrders.filter(isOverdue);
  const pending = sales.length + purchaseOrders.length + fabric.length + (unbilled ?? 0) + negatives.length;
  // An action: a button when this page can do it, a link to the warehouse page otherwise.
  const act = (label: string, onClick?: () => void) =>
    !canEdit ? null : onClick ? (
      <Button size="sm" disabled={inactive} onClick={onClick}>{label}</Button>
    ) : actionsHref ? (
      <Button size="sm" variant="outline" asChild><Link href={actionsHref}>{label}</Link></Button>
    ) : null;

  if (pending === 0) {
    return (
      <p className="wh-action-clear"><PartyPopper size={16} /> All clear: nothing to dispatch, receive or bill here.</p>
    );
  }

  return (
    <div className="wh-notes" aria-label="Waiting at this warehouse">
      <p className="wh-notes__label"><BellRing size={13} /> Waiting here <b>{pending}</b> <span>· click a card to see the list</span></p>
      {sales.length > 0 && (
        <ActionCard tone="sale" icon={ReceiptIndianRupee} title="Sales to dispatch" count={sales.length} summary={`Next: ${sales[0].saleNo} for ${sales[0].partyName}${sales[0].vehicleNo ? ` · ${sales[0].vehicleNo}` : ""}`}>
          {sales.map((sale) => (
            <li key={sale.id} className="wh-action__row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{sale.saleNo} · {sale.partyName} <span className="wh-action__tag">{PARTY_LABEL[sale.partyType]}</span></p>
                <p className="truncate text-xs text-gray-600">{sale.items.map((i) => `${i.itemCode} ${quantity(Number(i.quantity), i.unit)}`).join(" · ")}</p>
              </div>
              <span className="shrink-0 text-xs text-gray-500">{sale.vehicleNo ? `Vehicle ${sale.vehicleNo}` : "No vehicle yet"} · {formatDate(sale.createdAt)}</span>
              {act("Verify & dispatch", onDispatch && (() => onDispatch(sale)))}
            </li>
          ))}
        </ActionCard>
      )}

      {purchaseOrders.length > 0 && (
        <ActionCard
          tone={overdue.length ? "late" : "po"}
          icon={ShoppingCart}
          title="Purchase orders to receive"
          count={purchaseOrders.length}
          summary={overdue.length ? `${overdue.length} past the expected date · ${overdue[0].poNo}` : `Next: ${purchaseOrders[0].poNo} from ${purchaseOrders[0].supplier.name}`}
        >
          {purchaseOrders.map((po) => (
            <li key={po.id} className="wh-action__row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{po.poNo} · {po.supplier.name}</p>
                <p className="truncate text-xs text-gray-600" title={remainingText(po)}>{remainingText(po)} to come</p>
              </div>
              <span className={cn("shrink-0 text-xs", isOverdue(po) ? "font-semibold text-red-600" : "text-gray-500")}>
                {po.expectedDate ? `${formatDate(po.expectedDate)} · ${dueText(po).toLowerCase()}` : "No date given"}
              </span>
              {act("Receive", onReceivePo && (() => onReceivePo(po.id)))}
            </li>
          ))}
        </ActionCard>
      )}

      {fabric.length > 0 && (
        <ActionCard tone="fabric" icon={Factory} title="Fabric from production" count={fabric.length} summary={`${kg(fabric.reduce((sum, d) => sum + Number(d.weightKg), 0))} on its way`}>
          {fabric.map((d) => (
            <li key={d.id} className="wh-action__row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{d.flow.flowNo} · {stageMaterial(d.processStage).replaceAll("_", " ").toLowerCase()}</p>
                <p className="truncate text-xs text-gray-600">{kg(d.weightKg)}{d.sentPackages ? ` · ${d.sentPackages} ${d.packageUnit ?? "rolls"}` : ""} · {fabricOf(d.flow) || d.flow.yarnCount}{d.challanNo ? ` · ${d.challanNo}` : ""}{d.notes ? ` · ${d.notes}` : ""}</p>
              </div>
              <span className="shrink-0 text-xs text-gray-500">Sent {formatDate(d.deliveredAt)}</span>
              {act("Receive", onReceiveFabric && (() => onReceiveFabric(d)))}
            </li>
          ))}
        </ActionCard>
      )}

      {!!unbilled && unbilled > 0 && (
        <ActionCard tone="bill" icon={FileText} title="Movements without a challan" count={unbilled} summary={canBill ? "Issue their received / export challans in one go" : "An admin issues these challans"}>
          <li className="wh-action__row">
            <p className="min-w-0 flex-1 text-sm text-gray-700">
              {unbilled} stock movement{unbilled === 1 ? " has" : "s have"} no challan yet. New movements get theirs automatically; these are from before that, or were freed when a challan was cancelled.
            </p>
            {canBill && onIssueAll && <Button size="sm" onClick={onIssueAll}>Issue all challans</Button>}
            {canBill && (onShowUnbilled ? <Button size="sm" variant="outline" onClick={onShowUnbilled}>Show them</Button> : actionsHref ? <Button size="sm" variant="outline" asChild><Link href={`${actionsHref}&view=history`}>Show them</Link></Button> : null)}
          </li>
          {canBill && onClearUnbilled && (
            <li className="wh-action__row">
              <p className="min-w-0 flex-1 text-sm text-gray-700">
                <b>Old movements that need no challan?</b> Clear them: they are marked &ldquo;No challan needed&rdquo; and leave this list. Stock doesn&apos;t change, and they can still get one later.
              </p>
              <Button size="sm" variant="outline" onClick={onClearUnbilled}>Clear old movements</Button>
            </li>
          )}
        </ActionCard>
      )}

      {negatives.length > 0 && (
        <ActionCard tone="late" icon={AlertTriangle} title="Stock below zero" count={negatives.length} summary="More issued than received: check the entries">
          {negatives.map((n) => (
            <li key={`${n.itemCode}|${n.lotNo}|${n.unit}`} className="wh-action__row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{n.itemCode} · {n.itemName}</p>
                <p className="text-xs text-gray-600">{n.lotNo ? `Lot ${n.lotNo} · ` : ""}<span className="font-semibold text-red-600">{quantity(n.balanceKg, n.unit)}</span></p>
              </div>
              {onShowNegatives && <Button size="sm" variant="outline" onClick={onShowNegatives}>Show in stock</Button>}
            </li>
          ))}
        </ActionCard>
      )}
    </div>
  );
}
