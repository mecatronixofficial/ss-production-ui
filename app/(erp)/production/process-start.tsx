"use client";

import { useState } from "react";
import { Play, Timer, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { cn, kg } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WeightInput } from "@/components/ui/weight-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Field, SectionHeading } from "./fields";
import type { RunStage } from "./knitting-stage";
import { localDate, numeric, shortDate, weightCheck, WEIGHT_TOLERANCE_KG, type FabricFlow, type FlowDirectory } from "./types";

type Process = "dyeing" | "compacting";

const wording = {
  dyeing: { name: "Dyeing", input: "grey fabric", output: "dyed fabric", completes: "its output, colour, rolls and charges, then send it to compacting or a warehouse" },
  compacting: { name: "Compacting", input: "dyed fabric", output: "finished fabric", completes: "the compacted weight and charges, then deliver it to a party or a warehouse" },
} as const;

/**
 * Starting dyeing or compacting: the fabric has reached the party and mill doing it. The process is completed
 * later, when its fabric comes back, in the completion form.
 */
export function StartProcess({ flow, process, directory, saving, run }: { flow: FabricFlow; process: Process; directory: FlowDirectory; saving: boolean; run: RunStage }) {
  const dyeing = process === "dyeing";
  const words = wording[process];
  const sentKg = dyeing ? flow.dyeingDeliveryKg : flow.compactingDeliveryKg;
  // The previous process may already have named who does this one; not when its fabric went through a warehouse.
  const named = dyeing ? flow.knittingDestination !== "WAREHOUSE" : flow.dyeingDestination !== "WAREHOUSE";
  const [f, setF] = useState({
    startDate: localDate(),
    partyDetails: (named && (dyeing ? flow.dyeingPartyDetails : flow.compactingPartyDetails)) || "",
    millDetails: (named && (dyeing ? flow.dyeingMillDetails : flow.compactingMillDetails)) || "",
    receivedKg: sentKg !== null ? String(sentKg) : "",
    color: flow.color ?? "",
    inwardNo: "",
    notes: "",
  });
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const received = weightCheck(sentKg ?? 0, numeric(f.receivedKg));
  const ready = !!f.startDate && !!f.partyDetails.trim() && !!f.millDetails.trim() && numeric(f.receivedKg) > 0 && received.kind !== "over";

  const start = () =>
    run(
      () =>
        api<FabricFlow>(`/production/fabric-flows/${flow.id}/${process}/start`, {
          method: "POST",
          body: JSON.stringify({
            startDate: f.startDate,
            partyDetails: f.partyDetails.trim(),
            millDetails: f.millDetails.trim(),
            ...(dyeing
              ? { fabricReceivedKg: numeric(f.receivedKg), color: f.color.trim() || undefined }
              : { receivedKg: numeric(f.receivedKg), inwardNo: f.inwardNo.trim() || undefined }),
            notes: f.notes.trim() || undefined,
          }),
        }),
      process,
    );

  return (
    <div className="space-y-5">
      <div className="production-field-section">
        <SectionHeading icon={Play} title={`Start ${process}`} caption={`${sentKg !== null ? kg(sentKg) : "The"} ${words.input} of ${flow.flowNo} goes to ${process}. Complete it when the ${words.output} comes back.`} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Start date" required><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label={dyeing ? "Fabric received" : "Weight received"} required hint={sentKg !== null ? `Sent ${kg(sentKg)} · ±${WEIGHT_TOLERANCE_KG}` : `KG · ±${WEIGHT_TOLERANCE_KG}`} error={received.kind === "over" ? received.message : null} warning={received.kind === "bigLoss" ? received.message : null}>
            <WeightInput className={cn(received.kind === "over" && "border-red-400")} value={f.receivedKg} onValueChange={(receivedKg) => set({ receivedKg })} />
          </Field>
          {dyeing ? (
            <Field label="Colour" hint="Optional now"><Input placeholder="Fabric colour" value={f.color} onChange={(e) => set({ color: e.target.value })} /></Field>
          ) : (
            <Field label="Inward number" hint="Optional now"><Input placeholder="Gate pass / challan" value={f.inwardNo} onChange={(e) => set({ inwardNo: e.target.value })} /></Field>
          )}
        </div>
      </div>
      <div className="production-field-section">
        <SectionHeading icon={UserRound} title="Party & mill" caption={`Who ${dyeing ? "dyes" : "compacts"} it; search a registered name or add a new one`} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label={`${words.name} mill`} required className="md:col-span-2"><SearchableSelect placeholder={`Select ${process} mill`} options={process === "dyeing" ? directory.dyeingMills : directory.compactingMills} value={f.partyDetails} onChange={(value) => set({ partyDetails: value, millDetails: value })} /></Field>
          <Field label="Notes" hint="Optional" className="md:col-span-2 xl:col-span-3"><Input placeholder="Vehicle, challan, instructions…" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </div>
      <div className="production-dock">
        <p className="text-xs text-gray-500">After starting, the batch shows as {process} in progress. Complete it with {words.completes}.</p>
        <Button disabled={saving || !ready} onClick={() => void start()}><Play size={15} /> {saving ? "Starting…" : `Start ${process}`}</Button>
      </div>
    </div>
  );
}

/** Over a started process's completion form: where the fabric is and since when. */
export function InProgressNote({ flow, process }: { flow: FabricFlow; process: Process }) {
  const dyeing = process === "dyeing";
  const words = wording[process];
  const who = [dyeing ? flow.dyeingPartyDetails : flow.compactingPartyDetails, dyeing ? flow.dyeingMillDetails : flow.compactingMillDetails].filter(Boolean).join(" · ");
  const received = dyeing ? flow.fabricReceivedKg : flow.compactingReceivedKg;
  return (
    <div className="mb-5 flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      <Timer className="mt-0.5 shrink-0" size={17} />
      <div>
        <p className="font-bold">{words.name} in progress since {shortDate(dyeing ? flow.dyeingDate : flow.compactingDate)}</p>
        <p className="mt-1 text-xs">
          {received !== null ? `${kg(received)} ${words.input}` : `The ${words.input}`} is at {who || `the ${process} party`}. When the {words.output} comes back, complete {process} below: {words.completes}.
        </p>
      </div>
    </div>
  );
}
