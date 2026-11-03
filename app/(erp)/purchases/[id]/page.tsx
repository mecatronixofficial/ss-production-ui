"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, ClipboardCheck, PackageCheck, PackageX, Printer, Receipt, Truck, X } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import {
  codeLabel,
  dueText,
  isOpen,
  isOverdue,
  orderValue,
  qty,
  receiptValue,
  receivedQuantity,
  remainingQuantity,
  STATUS_LABEL,
  statusTone,
  type PurchaseOrder,
  type PurchaseSupplier,
  type PurchaseWarehouse,
} from "@/lib/purchases";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, humanize, money } from "@/lib/utils";
import { type WarehouseSummary } from "@/lib/warehouses";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { ClosePurchaseOrderDialog } from "@/components/close-purchase-order-dialog";
import { ReceiveDialog, receiptSummary } from "@/components/receive-dialog";
import { ReceivedChallanDialog } from "@/components/received-challan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** One purchase order: its lines with received / remaining, every goods receipt, and what can be done next. */
export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: po, error, reload } = useApiQuery<PurchaseOrder>(`/procurement/purchase-orders/${id}`);
  const { data: context } = useApiQuery<{ suppliers: PurchaseSupplier[]; warehouses: PurchaseWarehouse[] }>("/procurement/context");
  const { data: warehouseSummary, reload: reloadWarehouseSummary } = useApiQuery<WarehouseSummary[]>("/masters/warehouses/summary");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [challanId, setChallanId] = useState<string | null>(null);

  if (!po && error) {
    return (
      <div className="purchases-page">
        <Link href="/purchases" className="purchases-back-link"><ArrowLeft size={15} /> Purchases</Link>
        <ErrorState message={error} onRetry={() => void reload()} />
      </div>
    );
  }
  if (!po) return <Loading />;

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage({ text: success, error: false });
      toast.success(success);
      return true;
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Action failed", error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const ok = await confirmDialog({
      title: `Cancel ${po.poNo}?`,
      description: `The purchase order to ${po.supplier.name} (${money(orderValue(po))}) will be cancelled. This cannot be undone.`,
      confirmLabel: "Cancel PO",
      cancelLabel: "Keep PO",
      tone: "danger",
    });
    if (ok) await runAction(() => api(`/procurement/purchase-orders/${po.id}/cancel`, { method: "POST" }), `${po.poNo} cancelled.`);
  };

  const closeShort = async (reason: string) => {
    const ok = await runAction(
      () => api(`/procurement/purchase-orders/${po.id}/close`, { method: "POST", body: JSON.stringify({ reason: reason || undefined }) }),
      `${po.poNo} closed short.`,
    );
    if (ok) setClosing(false);
  };

  const total = orderValue(po);
  const receivedValue = po.items.reduce((sum, item) => sum + receivedQuantity(item) * Number(item.rate ?? 0), 0);
  const receivedPct = total > 0 ? Math.min(100, Math.round((receivedValue / total) * 100)) : 0;
  const due = dueText(po);
  const itemById = new Map(po.items.map((item) => [item.id, item]));
  const warehouses = context?.warehouses ?? [];

  return (
    <div className="purchases-page">
      <Link href="/purchases" className="purchases-back-link"><ArrowLeft size={15} /> Purchases</Link>

      <div className="purchases-page-header">
        <span className="purchases-page-icon">
          <Truck size={18} />
        </span>
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold md:text-xl">
            {po.poNo} <Badge tone={statusTone(po.status)}>{STATUS_LABEL[po.status]}</Badge>
          </h2>
          <p className="text-xs text-gray-500">
            {po.supplier.name} · ordered {formatDate(po.orderDate)}
          </p>
        </div>
        <span className="purchases-header-badge flex flex-wrap items-center gap-2">
          {po.status === "ORDERED" && po.receipts.length === 0 && (
            <Button variant="outline" className="text-red-600" disabled={busy} onClick={() => void cancel()}><Ban size={15} /> Cancel PO</Button>
          )}
          {po.status === "PARTIALLY_RECEIVED" && (
            <Button variant="outline" disabled={busy} onClick={() => setClosing(true)}><PackageX size={15} /> Close short</Button>
          )}
          {isOpen(po) && (
            <Button className="purchases-action-btn" disabled={busy || warehouses.length === 0} onClick={() => { setMessage(null); setReceiving(true); }}>
              <ClipboardCheck size={16} /> Receive material
            </Button>
          )}
        </span>
      </div>

      {message && (
        <div className={`purchases-message ${message.error ? "purchases-message--error" : "purchases-message--success"}`} role={message.error ? "alert" : "status"}>
          {message.error ? <AlertTriangle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0" />}
          <span className="flex-1">{message.text}</span>
          <button type="button" className="purchases-message__close" aria-label="Dismiss" onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}

      <Card className="purchases-card purchases-card--po">
        <CardContent className="space-y-4">
          <dl className="purchases-po-facts">
            <div><dt className="erp-label">Distributor</dt><dd className="font-semibold">{po.supplier.code} · {po.supplier.name}</dd></div>
            <div><dt className="erp-label">Deliver to</dt><dd className="font-semibold">{po.warehouse ? `${po.warehouse.code} · ${po.warehouse.name}` : "—"}</dd></div>
            <div><dt className="erp-label">Ordered on</dt><dd>{formatDate(po.orderDate)}</dd></div>
            <div>
              <dt className="erp-label">Expected</dt>
              <dd className={cn(isOverdue(po) && "font-semibold text-red-600")}>
                {formatDate(po.expectedDate)}
                {due && <span className={cn("block text-[11px]", !isOverdue(po) && "text-gray-400")}>{due}</span>}
              </dd>
            </div>
          </dl>
          <div className="purchases-po-values">
            <div><span>Ordered</span><strong>{money(total)}</strong></div>
            <div><span>Received</span><strong className="text-blue-700">{money(receivedValue)}</strong></div>
            <div><span>{po.status === "CLOSED" ? "Not delivered" : "Still to come"}</span><strong>{money(Math.max(0, total - receivedValue))}</strong></div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-gray-500"><span>Received by value</span><span className="font-semibold text-gray-700">{receivedPct}%</span></div>
            <div className={cn("purchases-progress purchases-progress--lg", receivedPct >= 100 && "is-complete")} aria-hidden><span style={{ width: `${receivedPct}%` }} /></div>
          </div>
        </CardContent>
      </Card>

      <Card className="purchases-card purchases-card--register">
        <CardHeader>
          <div className="purchases-card-heading">
            <span className="purchases-step-badge purchases-step-badge--1"><PackageCheck size={14} /></span>
            <div><h3 className="font-bold">Items ({po.items.length})</h3><p className="text-xs text-gray-500">Ordered, received so far and what is left on each line.</p></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="purchases-line-table overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Ordered</th>
                  <th className="px-3 py-2.5 text-right">Received</th>
                  <th className="px-3 py-2.5 text-right">{po.status === "CLOSED" ? "Not delivered" : "Remaining"}</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((item) => {
                  const ordered = Number(item.quantity);
                  const pct = ordered > 0 ? Math.min(100, (receivedQuantity(item) / ordered) * 100) : 0;
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <p className="font-semibold">{item.itemName}</p>
                        <p className="text-xs text-gray-400">{codeLabel(item)}{item.category ? ` · ${humanize(item.category)}` : ""}</p>
                        {item.specs && item.specs.length > 0 && (
                          <span className="purchases-item-specs">{item.specs.map((s) => <span key={s.label}>{s.label} {s.value}</span>)}</span>
                        )}
                        <div className={cn("purchases-progress max-w-48", pct >= 100 && "is-complete")} aria-hidden><span style={{ width: `${pct}%` }} /></div>
                      </td>
                      <td className="px-3 py-2 text-right">{qty(ordered, item.unit)}</td>
                      <td className="px-3 py-2 text-right text-blue-700">{qty(receivedQuantity(item), item.unit)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{remainingQuantity(item) > 0 ? qty(remainingQuantity(item), item.unit) : <span className="text-emerald-700">Complete</span>}</td>
                      <td className="px-3 py-2 text-right">{money(item.rate ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{money(ordered * Number(item.rate ?? 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} className="px-3 py-2.5 text-right font-bold">Order total</td><td className="px-3 py-2.5 text-right font-black">{money(total)}</td></tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="purchases-card purchases-card--receive">
        <CardHeader>
          <div className="purchases-card-heading">
            <span className="purchases-step-badge purchases-step-badge--2"><Receipt size={14} /></span>
            <div><h3 className="font-bold">Goods receipts & challans ({po.receipts.length})</h3><p className="text-xs text-gray-500">Every delivery posted to stock against this PO, newest first. Print its received challan for the office file.</p></div>
          </div>
        </CardHeader>
        <CardContent>
          {po.receipts.length === 0 ? (
            <div className="purchases-empty">Nothing received yet.</div>
          ) : (
            <ul className="space-y-2">
              {po.receipts.map((receipt) => {
                const value = receiptValue(po, receipt);
                return (
                  <li key={receipt.id} className="rounded-xl border bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p>
                        <span className="font-semibold">{receipt.receiptNo}</span>
                        <span className="ml-2 text-xs text-gray-500">
                          {formatDate(receipt.receivedAt)} · {receipt.warehouse.code} · {humanize(receipt.category)}{receipt.lotNo ? ` · lot ${receipt.lotNo}` : ""}
                        </span>
                        <span className="block text-xs text-gray-500">
                          Challan <b className="text-gray-700">{receipt.challanNo || "—"}</b> · Vehicle <b className="text-gray-700">{receipt.vehicleNo || "—"}</b>
                          {receipt.receivedBy ? ` · received by ${receipt.receivedBy}` : ""}
                        </span>
                      </p>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{money(value)}</span>
                        <Button size="sm" variant="outline" onClick={() => setChallanId(receipt.id)}>
                          <Printer size={14} /> Print challan
                        </Button>
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-gray-600">
                      {receipt.items.map((line) => {
                        const item = itemById.get(line.purchaseOrderItemId);
                        return (
                          <li key={line.purchaseOrderItemId} className="flex justify-between gap-2">
                            <span className="truncate">{item ? `${codeLabel(item)} · ${item.itemName}` : "Item"}</span>
                            <span className="shrink-0 font-semibold">{qty(Number(line.quantity), item?.unit ?? "")}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {receipt.notes && <p className="mt-1.5 text-xs text-gray-600"><b>Remarks:</b> {receipt.notes}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {receiving && (
        <ReceiveDialog
          purchaseOrders={[po]}
          initialPurchaseOrderId={po.id}
          warehouses={warehouses}
          warehouseSummary={warehouseSummary}
          onClose={() => setReceiving(false)}
          onReceived={(result) => {
            setReceiving(false);
            setChallanId(result.receiptId);
            const text = `${result.receiptNo} posted to stock. ${po.poNo} is ${result.status === "RECEIVED" ? "fully received" : "partly received"}.${receiptSummary(result)}`;
            setMessage({ text, error: false });
            toast.success(text);
            void reload();
            void reloadWarehouseSummary();
          }}
        />
      )}

      {challanId && <ReceivedChallanDialog receiptId={challanId} onClose={() => setChallanId(null)} />}

      {closing && <ClosePurchaseOrderDialog po={po} busy={busy} onClose={() => setClosing(false)} onConfirm={(reason) => void closeShort(reason)} />}
    </div>
  );
}
