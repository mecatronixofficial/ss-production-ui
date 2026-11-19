"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Printer, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { errorMessage, formatDate, kg } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { companyName, type ChallanCompany, type ItemSpec } from "@/components/challan-parts";
import { appLink, challanSummary, ShareMenu } from "@/components/share-menu";
import { DeliveryNote } from "@/components/delivery-note";

/** `/production/challans/:id`: a delivery challan of a batch's fabric between processes, ready to print. */
export type ProcessChallanDoc = {
  id: string;
  challanNo: string;
  handOff: string;
  /** "Knitting", "Sent to dyeing", "Dyeing", "Sent to compacting" or "Delivery". */
  process: string;
  date: string;
  material: string;
  fromKind: string;
  fromName: string;
  toKind: string;
  toName: string;
  weightKg: number;
  packages: number | null;
  packageUnit: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  flow: { id: string; flowNo: string; yarnCount: string; fabricType: string | null; color: string | null };
  /** Who it is from and delivered to, in full, from the masters (null when not found there). */
  fromDetails?: PartyDetails | null;
  toDetails?: PartyDetails | null;
  specs: ItemSpec[];
  /** The spinning mill of the batch's yarn, for the delivery note. */
  yarnMill?: string | null;
  issuedBy: string | null;
  company: ChallanCompany;
};

type PartyDetails = { address: string | null; city: string | null; gst: string | null; phone: string | null };

const packagesText = (c: Pick<ProcessChallanDoc, "packages" | "packageUnit">) => (c.packages ? `${c.packages} ${c.packageUnit ?? ""}`.trim() : "—");

/**
 * A delivery challan of a batch's fabric moving on from a process (knitting, dyeing, compacting) or a warehouse:
 * from / to, the fabric with its details, packages and weight. The vehicle, driver and remarks are filled in here
 * when it leaves; print it or share it as a PDF.
 */
export function ProcessChallanDialog({ challanId, onClose }: { challanId: string; onClose: () => void }) {
  const { data: c, error, reload, setData } = useApiQuery<ProcessChallanDoc>(`/production/challans/${challanId}`);
  const [f, setF] = useState({ vehicleNo: "", driverName: "", notes: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c) setF({ vehicleNo: c.vehicleNo ?? "", driverName: c.driverName ?? "", notes: c.notes ?? "" });
  }, [c]);
  const changed = !!c && (f.vehicleNo.trim().toUpperCase() !== (c.vehicleNo ?? "") || f.driverName.trim() !== (c.driverName ?? "") || f.notes.trim() !== (c.notes ?? ""));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api<ProcessChallanDoc>(`/production/challans/${challanId}`, { method: "PATCH", body: JSON.stringify(f), silent: true });
      setData(saved);
      toast.success(`${saved.challanNo} saved.`);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the challan"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay print:hidden" />
        <Dialog.Content data-receipt-bill className="users-dialog sale-bill-dialog" aria-describedby={undefined}>
          <div className="users-dialog__head print:hidden">
            <Dialog.Title className="text-base font-bold text-[#1b3c55]">{c ? `Delivery challan ${c.challanNo}` : "Delivery challan"}</Dialog.Title>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <div className="users-dialog__body">
            {!c ? (
              error ? <ErrorState message={error} onRetry={() => void reload()} /> : <Loading />
            ) : (
              <>
                {!c.cancelledAt && (
                  <form className="grid gap-3 rounded-xl border border-dashed border-gray-300 p-3 sm:grid-cols-3 print:hidden" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                    <Field label="Vehicle no"><Input value={f.vehicleNo} maxLength={30} placeholder="TN 39 AB 1234" className="uppercase" onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} /></Field>
                    <Field label="Driver"><Input value={f.driverName} maxLength={80} onChange={(e) => setF({ ...f, driverName: e.target.value })} /></Field>
                    <Field label="Remarks" hint="Optional"><Input value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
                    {changed && <div className="sm:col-span-3 flex justify-end"><Button type="submit" size="sm" disabled={busy}><Save size={14} /> {busy ? "Saving…" : "Save on challan"}</Button></div>}
                  </form>
                )}
                <DeliveryNote c={c} />
              </>
            )}
            <div className="users-dialog__foot flex-wrap items-center print:hidden">
              <p className="mr-auto text-xs text-gray-500">Goes with the vehicle; the receiver signs it.</p>
              <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
              {c && (
                <ShareMenu
                  size="md"
                  onPrint={() => window.print()}
                  target={{
                    title: `Delivery challan ${c.challanNo}`,
                    pdfPath: `/production/challans/${c.id}/pdf`,
                    fileName: `${c.challanNo}.pdf`,
                    link: appLink(`/challans?tab=process&open=${c.id}`),
                    text: challanSummary({
                      title: `Delivery challan ${c.challanNo}`,
                      date: formatDate(c.date),
                      party: ["Deliver to", c.toName],
                      place: ["From", c.fromName],
                      vehicle: c.vehicleNo,
                      lines: [`${c.material} ${c.flow.flowNo}${c.flow.color ? ` · ${c.flow.color}` : ""} — ${kg(c.weightKg)}${c.packages ? ` · ${packagesText(c)}` : ""}`],
                      total: kg(c.weightKg),
                      company: companyName(c.company),
                    }),
                  }}
                />
              )}
              <Button disabled={!c} onClick={() => window.print()}><Printer size={16} /> Print</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
