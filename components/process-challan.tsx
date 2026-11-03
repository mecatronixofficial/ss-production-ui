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
import { ChallanLetterhead, companyName, ItemSpecs, OFFICE_COPY, type ChallanCompany, type ItemSpec } from "@/components/challan-parts";
import { appLink, challanSummary, ShareMenu } from "@/components/share-menu";

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
  issuedBy: string | null;
  company: ChallanCompany;
};

type PartyDetails = { address: string | null; city: string | null; gst: string | null; phone: string | null };

const KIND_LABEL: Record<string, string> = { PROCESS: "Mill", WAREHOUSE: "Warehouse", PARTY: "Party" };

/** A challan party's address, GSTIN and phone under its name. */
function PartyLines({ d }: { d?: PartyDetails | null }) {
  if (!d) return null;
  const place = [d.address, d.city].filter(Boolean).join(", ");
  return (
    <>
      {place && <p className="text-xs text-gray-600">{place}</p>}
      {(d.gst || d.phone) && <p className="text-xs text-gray-600">{[d.gst && `GSTIN ${d.gst}`, d.phone && `Ph ${d.phone}`].filter(Boolean).join(" · ")}</p>}
    </>
  );
}
const packagesText = (c: Pick<ProcessChallanDoc, "packages" | "packageUnit">) => (c.packages ? `${c.packages} ${c.packageUnit ?? ""}`.trim() : "—");

function ChallanDocument({ c }: { c: ProcessChallanDoc }) {
  return (
    <article className="sale-bill">
      <ChallanLetterhead company={c.company} title="Delivery Challan" number={c.challanNo} date={c.date} copyLabel={OFFICE_COPY} />
      {c.cancelledAt && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">Cancelled {formatDate(c.cancelledAt)}{c.cancelReason ? ` · ${c.cancelReason}` : ""}</p>}
      <div className="sale-bill__parties">
        <div>
          <p className="sale-bill__label">From · {KIND_LABEL[c.fromKind] ?? c.fromKind}</p>
          <p className="font-bold">{c.fromName}</p>
          <PartyLines d={c.fromDetails} />
          <p className="text-xs text-gray-600">{c.process} of batch <b>{c.flow.flowNo}</b></p>
        </div>
        <div>
          <p className="sale-bill__label">Deliver to · {KIND_LABEL[c.toKind] ?? c.toKind}</p>
          <p className="font-bold">{c.toName}</p>
          <PartyLines d={c.toDetails} />
        </div>
      </div>
      <dl className="challan-facts">
        <div><dt className="sale-bill__label">Batch</dt><dd>{c.flow.flowNo}</dd></div>
        <div><dt className="sale-bill__label">Process</dt><dd>{c.process}</dd></div>
        <div><dt className="sale-bill__label">Vehicle no</dt><dd>{c.vehicleNo || "—"}</dd></div>
        <div><dt className="sale-bill__label">Driver</dt><dd>{c.driverName || "—"}</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="sale-bill__table">
          <thead><tr><th>#</th><th>Fabric</th><th>Batch code</th><th className="text-right">Packages</th><th className="text-right">Weight</th></tr></thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><b>{c.material}</b><ItemSpecs specs={c.specs} itemCode={c.flow.flowNo} hide={["Batch"]} /></td>
              <td className="font-mono text-xs">{c.flow.flowNo}</td>
              <td className="text-right">{packagesText(c)}</td>
              <td className="text-right font-bold">{kg(c.weightKg)}</td>
            </tr>
          </tbody>
          <tfoot><tr className="sale-bill__total"><td colSpan={4} className="text-right">Total {c.material.toLowerCase()}</td><td className="text-right">{kg(c.weightKg)}</td></tr></tfoot>
        </table>
      </div>
      {c.notes && <p className="text-xs text-gray-700"><b>Remarks:</b> {c.notes}</p>}
      <p className="text-[11px] text-gray-500">{c.process} of batch {c.flow.flowNo}.{c.issuedBy ? ` Issued by ${c.issuedBy}.` : ""} Computer-generated delivery challan; not a tax invoice.</p>
      <footer className="sale-bill__foot challan-foot">
        <div className="text-center"><div className="sale-bill__sign" />Sent by</div>
        <div className="text-center"><div className="sale-bill__sign" />Driver{c.driverName ? ` (${c.driverName})` : ""}</div>
        <div className="text-center"><div className="sale-bill__sign" />Received by<br />For {companyName(c.company)}</div>
      </footer>
    </article>
  );
}

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
                <ChallanDocument c={c} />
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
