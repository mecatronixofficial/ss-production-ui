"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApiAction } from "@/lib/use-api-action";
import { formatDate, humanize, kg, todayInput, toNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";

/** Fabric sent from production to a warehouse, not yet received there. */
export type IncomingFabric = {
  id: string;
  deliveredAt: string;
  weightKg: string;
  notes: string | null;
  processStage: "KNITTING" | "DYEING" | "FINAL";
  flow: { id: string; flowNo: string; yarnCount: string; color: string | null };
};

/** The stock a delivery becomes, by the process it left: knitting gives grey fabric, dyeing dyed, the final process finished. */
export const stageMaterial = (stage: IncomingFabric["processStage"]) =>
  stage === "KNITTING" ? "GREY_FABRIC" : stage === "DYEING" ? "DYED_FABRIC" : "FINISHED_FABRIC";

/** Weight may differ from what was sent by up to this much (the same tolerance as each production process). */
const TOLERANCE_KG = 100;

/** Receiving fabric from production: when it arrived and what it weighs here; it then becomes stock under its batch code. */
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
  const [receivedDate, setReceivedDate] = useState(todayInput());
  const [weight, setWeight] = useState(String(sent));
  const { message, run, reject, busy } = useApiAction();
  const received = Number(weight);
  const over = received > sent + TOLERANCE_KG + 0.0005;
  const material = stageMaterial(delivery.processStage);
  const materialText = humanize(material).toLowerCase();

  const save = async () => {
    if (!(received > 0)) return reject("Enter the weight that arrived.", "Check receipt");
    if (over) return reject(`At most ${TOLERANCE_KG} KG more than the ${kg(sent)} sent.`, "Check receipt");
    const ok = await run(
      () =>
        api(`/production/deliveries/${delivery.id}/receive`, {
          method: "POST",
          body: JSON.stringify({ receivedDate, receivedWeightKg: Math.round(received * 1000) / 1000 }),
        }),
      `${delivery.flow.flowNo} received into ${warehouseCode}: ${kg(received)} of ${materialText} in stock.`,
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
              <p id="receive-fabric-help" className="text-xs text-gray-500">
                {delivery.flow.yarnCount} fabric{delivery.flow.color ? ` · ${delivery.flow.color}` : ""} · {kg(sent)} sent from production on {formatDate(delivery.deliveredAt)}
              </p>
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
            {delivery.notes && <p className="users-note">Note from production: {delivery.notes}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Received on">
                <Input type="date" value={receivedDate} max={todayInput()} onChange={(e) => setReceivedDate(e.target.value || todayInput())} />
              </Field>
              <Field
                label="Weight received (KG)"
                hint={received > 0 && Math.abs(received - sent) > 0.0005 ? `Sent ${kg(sent)} · ${received > sent ? "+" : "−"}${kg(Math.abs(received - sent))}` : `Sent ${kg(sent)}`}
                error={over ? `At most ${TOLERANCE_KG} KG more than sent` : undefined}
              >
                <WeightInput value={weight} onValueChange={setWeight} autoFocus />
              </Field>
            </div>
            <p className="users-note">It becomes {materialText} stock here under the code {delivery.flow.flowNo}.</p>
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
