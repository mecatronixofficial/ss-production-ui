"use client";
import { entryDate } from "@/lib/entry-date";
import { EntryDateInput } from "@/components/ui/entry-date-input";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, FileText, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApiAction } from "@/lib/use-api-action";
import { formatDate, gsmText, humanize, kg, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { ReceiveCheck } from "@/components/ui/receive-check";
import { WeightInput } from "@/components/ui/weight-input";

/** Fabric sent from production to a warehouse, not yet received there, with what it is checked against. */
export type IncomingFabric = {
  id: string;
  deliveredAt: string;
  weightKg: string;
  notes: string | null;
  processStage: "KNITTING" | "DYEING" | "FINAL";
  flow: {
    id: string;
    flowNo: string;
    yarnCount: string;
    yarnItemCode?: string | null;
    color: string | null;
    fabricType?: string | null;
    fabricDiameter?: string | null;
    fabricGsm?: string | null;
    knittingGg?: string | null;
    knittingLl?: string | null;
  };
  /** The delivery challan it came on, who sent it, and the rolls / bags written on it. */
  challanNo?: string | null;
  from?: string | null;
  sentPackages?: number | null;
  packageUnit?: string | null;
};

/** The stock a delivery becomes, by the process it left: knitting gives grey fabric, dyeing dyed, the final process finished. */
export const stageMaterial = (stage: IncomingFabric["processStage"]) =>
  stage === "KNITTING" ? "GREY_FABRIC" : stage === "DYEING" ? "DYED_FABRIC" : "FINISHED_FABRIC";

/** The fabric in words: type, dia, GSM, GG, LL and colour. */
export const fabricOf = (flow: IncomingFabric["flow"]) =>
  [flow.fabricType, flow.fabricDiameter && `${flow.fabricDiameter} dia`, gsmText(flow.fabricGsm), flow.knittingGg && `${flow.knittingGg} GG`, flow.knittingLl && `LL ${flow.knittingLl}`, flow.color].filter(Boolean).join(" · ");

/** Weight may differ from what was sent by up to this much (the same tolerance as each production process). */
const TOLERANCE_KG = 100;

/**
 * Receiving fabric from production: what was sent (the fabric, its code, the challan, its weight and rolls / bags)
 * beside what is found here (weight, rolls / bags counted, anything wrong), each checked as matches, short or excess.
 * It then becomes stock under its batch code.
 */
export function ReceiveFabricDialog({
  delivery,
  warehouseCode,
  onClose,
  onReceived,
}: {
  delivery: IncomingFabric;
  warehouseCode: string;
  onClose: () => void;
  onReceived: (category: "GREY_FABRIC" | "DYED_FABRIC" | "FINISHED_FABRIC") => void;
}) {
  const sent = toNumber(delivery.weightKg);
  const unit = delivery.packageUnit ?? "rolls";
  const [receivedDate, setReceivedDate] = useState(() => entryDate(delivery.deliveredAt));
  const [weight, setWeight] = useState(String(sent));
  const [packages, setPackages] = useState("");
  const [notes, setNotes] = useState("");
  const { message, run, reject, busy } = useApiAction();
  const received = Number(weight);
  const counted = packages.trim() === "" ? null : Number(packages);
  const over = received > sent + TOLERANCE_KG + 0.0005;
  const material = stageMaterial(delivery.processStage);
  const materialText = humanize(material).toLowerCase();
  const fabric = fabricOf(delivery.flow);

  const save = async () => {
    if (!receivedDate || receivedDate < delivery.deliveredAt.slice(0, 10) || receivedDate > todayInput()) return reject("Choose a receipt date on or after dispatch and no later than today.", "Check receipt date");
    if (!(received > 0)) return reject("Enter the weight that arrived.", "Check receipt");
    if (over) return reject(`At most ${TOLERANCE_KG} KG more than the ${kg(sent)} sent.`, "Check receipt");
    if (counted !== null && !(Number.isInteger(counted) && counted >= 0)) return reject(`Enter the ${unit} counted as a whole number.`, "Check receipt");
    const ok = await run(
      () =>
        api(`/production/deliveries/${delivery.id}/receive`, {
          method: "POST",
          body: JSON.stringify({ receivedDate, receivedWeightKg: Math.round(received * 1000) / 1000, receivedPackages: counted ?? undefined, notes: notes.trim() || undefined }),
        }),
      `${delivery.flow.flowNo} received into ${warehouseCode}: ${kg(received)} of ${materialText}${counted !== null ? `, ${counted} ${unit}` : ""} in stock.`,
    );
    if (ok) onReceived(material);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className="users-dialog" aria-describedby="receive-fabric-help">
          <div className="users-dialog__head">
            <div>
              <Dialog.Title className="text-base font-bold text-[#1b3c55]">Receive {delivery.flow.flowNo} into {warehouseCode}</Dialog.Title>
              <p id="receive-fabric-help" className="text-xs text-gray-500">Check it against what was sent: weigh it, count the {unit}, note anything wrong.</p>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
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

            <section className="receive-sent">
              <p className="receive-sent__label">Sent from production · {formatDate(delivery.deliveredAt)}{delivery.from ? ` · ${delivery.from}` : ""}</p>
              <dl className="receive-sent__grid">
                <div><dt>Code</dt><dd className="font-mono">{delivery.flow.flowNo}</dd></div>
                <div><dt>Material</dt><dd>{humanize(material)}</dd></div>
                <div className="sm:col-span-2"><dt>Fabric</dt><dd>{fabric || "—"}</dd></div>
                <div><dt>Yarn</dt><dd>{[delivery.flow.yarnItemCode, delivery.flow.yarnCount].filter(Boolean).join(" · ")}</dd></div>
                <div><dt>Challan</dt><dd className="inline-flex items-center gap-1">{delivery.challanNo ? <><FileText size={12} aria-hidden /> <span className="font-mono">{delivery.challanNo}</span></> : "—"}</dd></div>
                <div><dt>Weight sent</dt><dd className="text-base font-black">{kg(sent)}</dd></div>
                <div><dt>{unit[0].toUpperCase() + unit.slice(1)} sent</dt><dd className="text-base font-black">{delivery.sentPackages ?? "—"}</dd></div>
              </dl>
              {delivery.notes && <p className="mt-2 text-xs text-gray-600">Note from production: {delivery.notes}</p>}
            </section>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Received on">
                <EntryDateInput value={receivedDate} min={delivery.deliveredAt.slice(0, 10)} max={todayInput()} onChange={(e) => setReceivedDate(e.target.value)} />
              </Field>
              <Field label="Weight here (KG)" error={over ? `At most ${TOLERANCE_KG} KG more than sent` : undefined}>
                <WeightInput value={weight} onValueChange={setWeight} autoFocus />
                <span className="mt-1 block"><ReceiveCheck sent={sent} received={received > 0 ? received : null} unit="KG" /></span>
              </Field>
              <Field label={`${unit[0].toUpperCase() + unit.slice(1)} counted`} hint="Optional">
                <Input inputMode="numeric" placeholder={delivery.sentPackages ? `sent ${delivery.sentPackages}` : "count"} value={packages} onChange={(e) => setPackages(e.target.value.replace(/\D/g, ""))} />
                <span className="mt-1 block"><ReceiveCheck sent={delivery.sentPackages} received={counted} unit={unit} /></span>
              </Field>
            </div>
            <Field label="Remarks" hint="Optional">
              <Input maxLength={500} placeholder="Damp rolls, torn bags, colour patch…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <p className="users-note">It becomes {materialText} stock here under the code {delivery.flow.flowNo}, at the weight found here.</p>
            <div className="users-dialog__foot">
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}><ClipboardCheck size={15} />{busy ? "Receiving…" : "Receive into stock"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
