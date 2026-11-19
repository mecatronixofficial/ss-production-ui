"use client";
import { entryDate } from "@/lib/entry-date";
import { EntryDateInput } from "@/components/ui/entry-date-input";

import { useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Building2, Droplets, Factory, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { Warehouse } from "@/lib/types";
import { toast } from "@/lib/toast-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, errorMessage, kg } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { keepDialogForOpenDropdown, SearchableSelect } from "@/components/ui/searchable-select";
import { Field, SectionHeading } from "./fields";
import { StockPicker } from "./stock-picker";
import { DyeingLotsInput, firstLines, lotsPayload, lotsProblem } from "./dyeing-lots";
import { dyesInLots, localDate, type FabricFlow, type FlowDirectory } from "./types";
import { currentShift, shiftIndex, type KnitBoard, type Shift } from "../masters/machines/types";
import { MachinePicker, machineAvailable, type MachinePick } from "./machine-picker";

type Process = "knitting" | "dyeing" | "compacting";
type Stock = { category: string; itemCode: string; itemName: string; lotNo?: string | null; warehouseId: string; unit: string; balanceKg: number };

const PROCESSES: Array<{ key: Process; label: string; material: string; icon: typeof Factory; text: string }> = [
  { key: "knitting", label: "Knitting", material: "yarn", icon: Factory, text: "Yarn into grey fabric" },
  { key: "dyeing", label: "Dyeing", material: "grey fabric", icon: Droplets, text: "Grey fabric from stock" },
  { key: "compacting", label: "Compacting", material: "dyed fabric", icon: Sparkles, text: "Dyed fabric from stock" },
];
const EMPTY = 0.0005;
const keyOf = (row: Stock) => [row.itemCode, row.warehouseId, row.lotNo ?? "", row.category].join("|");

/** One fabric type to knit from the yarn (Type 1, Type 2…): each becomes a knitting batch of its own; they share the yarn. */
type FabricType = { fabricType: string; fabricDiameter: string; fabricGsm: string; gg: string; ll: string; machines: MachinePick[] };
const newType = (): FabricType => ({ fabricType: "", fabricDiameter: "", fabricGsm: "", gg: "", ll: "", machines: [] });

/**
 * Starting a process, on one page: knitting, dyeing or compacting, the material from stock and who does it. No
 * weight is typed for knitting or compacting: all of the chosen stock goes, and what was used and what it cost are
 * entered when the process is completed (knitting puts unused yarn back into stock then). Dyeing takes the colours:
 * each becomes a dyeing lot with its own code, and one colour alone takes all of the grey fabric.
 */
export function StartDialog({ directory, flows, onClose, onStarted }: { directory: FlowDirectory; flows: FabricFlow[]; onClose: () => void; onStarted: (flow: FabricFlow) => void }) {
  const [process, setProcess] = useState<Process>("knitting");
  const [picked, setPicked] = useState("");
  const [millType, setMillType] = useState<"OWN" | "OTHER">("OWN");
  const [f, setF] = useState(() => ({ mill: "", startDate: entryDate(undefined, currentShift().date), expectedFinishDate: "", inwardNo: "", notes: "" }));
  const [startShift, setStartShift] = useState<Shift>(() => currentShift().shift);
  const [types, setTypes] = useState<FabricType[]>(() => [newType()]);
  const setType = (index: number, changes: Partial<FabricType>) => setTypes((current) => current.map((t, i) => (i === index ? { ...t, ...changes } : t)));
  const set = (changes: Partial<typeof f>) => setF((current) => ({ ...current, ...changes }));
  const [lines, setLines] = useState(firstLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLFormElement>(null);
  /** An error shows at the top of the window, so scroll up to it. */
  const fail = (text: string) => {
    setError(text);
    bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const yarn = useApiQuery<Stock[]>(`/inventory/balances${qs({ category: "YARN" })}`);
  const grey = useApiQuery<Stock[]>(`/inventory/balances${qs({ category: "GREY_FABRIC" })}`);
  const dyed = useApiQuery<Stock[]>(`/inventory/balances${qs({ category: "DYED_FABRIC" })}`);
  const machineBoard = useApiQuery<KnitBoard>(process === "knitting" && millType === "OWN" ? "/knitting/board" : null);
  const { data: warehouses = [] } = useApiQuery<Warehouse[]>("/masters/warehouses");
  const warehouseOf = new Map(warehouses.map((w) => [w.id, w]));
  const flowByCode = new Map(flows.map((flow) => [flow.flowNo, flow]));
  // Own-mill grey fabric is in stock under its machine runs' codes (…-KT01-R1).
  const flowOf = (code: string) => flowByCode.get(code) ?? flowByCode.get(code.replace(/-R\d+$/, ""));
  const usable = (row: Stock) => row.unit === "KG" && row.balanceKg > EMPTY && warehouseOf.get(row.warehouseId)?.active !== false;
  // Grey / dyed fabric can start the next process only when its batch has finished the one before and not started this one.
  const stock: Record<Process, Stock[]> = {
    knitting: (yarn.data ?? []).filter(usable),
    dyeing: (grey.data ?? []).filter((row) => {
      const flow = flowOf(row.itemCode);
      return usable(row) && !!flow && flow.knittingFinishedAt !== null && dyesInLots(flow);
    }),
    compacting: (dyed.data ?? []).filter((row) => {
      const flow = flowByCode.get(row.itemCode);
      return usable(row) && !!flow && flow.dyeingOutputWeightKg !== null && !flow.compactingIssueTxnId && flow.compactingDate === null;
    }),
  };
  const loaded: Record<Process, boolean> = { knitting: !!yarn.data, dyeing: !!grey.data, compacting: !!dyed.data };
  const meta = PROCESSES.find((p) => p.key === process)!;
  const chosen = stock[process].find((row) => keyOf(row) === picked);
  const knitting = process === "knitting";
  const needsMill = !knitting || millType === "OTHER";
  const ownKnitting = knitting && millType === "OWN";
  const machines = machineBoard.data?.machines ?? [];
  const allPicks = types.flatMap((type) => type.machines);
  const freeMachines = machines.filter((machine) => machineBoard.data && machineAvailable(machine, machineBoard.data));
  const workingMachines = machines.filter((machine) => machine.status === "RUNNING" || machineBoard.data?.busyMachineIds.includes(machine.id));
  const now = currentShift();
  const machineProblem = !ownKnitting ? "" :
    machineBoard.loading ? "Loading machine details…" :
    machineBoard.error ? "Could not load machine details. Refresh machines in section 3." :
    !machineBoard.data ? "Loading machine details…" :
    types.some((type) => !type.machines.length) ? "Choose at least one free machine for every fabric type in section 3." :
    new Set(allPicks.map((pick) => pick.machineId)).size !== allPicks.length ? "Choose each machine for only one fabric type." :
    allPicks.some((pick) => !machines.some((machine) => machine.id === pick.machineId && machineAvailable(machine, machineBoard.data!))) ? "A selected machine is no longer free. Choose another machine in section 3." :
    allPicks.some((pick) => !/^\d+(\.\d{1,2})?$/.test(pick.ratePerKg) || !Number.isFinite(Number(pick.ratePerKg))) ? "Enter a valid machine charge with up to two decimal places." :
    shiftIndex(f.startDate, startShift) > shiftIndex(now.date, now.shift) ? "Choose a start shift that has already started." : "";
  /** The code a type will get: the yarn's next knitting batches (KT01, KT02…). */
  const flowCodeHint = (yarnCode: string, index: number) => {
    const taken = flows.filter((fl) => fl.flowNo.startsWith(`${yarnCode}-KT`) && /^\d+$/.test(fl.flowNo.slice(yarnCode.length + 3))).map((fl) => Number(fl.flowNo.slice(yarnCode.length + 3)));
    return `${yarnCode}-KT${String(Math.max(0, ...taken) + index + 1).padStart(2, "0")}`;
  };
  /** "01SS26-KT01 Single jersey (400 KG) and 01SS26-KT02 Rib (1,000 KG) started." */
  const startedText = (flow: FabricFlow & { started?: Array<{ flowNo: string; fabricType: string | null; yarnKg: number }> }) => {
    const started = flow.started ?? [{ flowNo: flow.flowNo, fabricType: flow.fabricType, yarnKg: flow.purchasedWeightKg }];
    return `${started.map((b) => `${b.flowNo} ${b.fabricType ?? ""} (${kg(b.yarnKg)} yarn)`).join(", ")} started.`;
  };

  // What this yarn has made so far: its knitting batches by fabric, and the fabric finished in their colours.
  const yarnHistory = useMemo(() => {
    if (!knitting || !chosen) return null;
    const mine = flows.filter((fl) => fl.yarnItemCode === chosen.itemCode);
    const batches = mine.filter((fl) => !fl.parentId);
    if (!batches.length) return null;
    const byFabric = new Map<string, { yarn: number; grey: number; batches: number }>();
    for (const fl of batches) {
      const name = [fl.fabricType, fl.fabricDiameter && `${fl.fabricDiameter} dia`, fl.fabricGsm && `${fl.fabricGsm} GSM`].filter(Boolean).join(" · ") || "Fabric";
      const row = byFabric.get(name) ?? { yarn: 0, grey: 0, batches: 0 };
      byFabric.set(name, { yarn: row.yarn + fl.purchasedWeightKg, grey: row.grey + (fl.knittingDeliveryKg ?? 0), batches: row.batches + 1 });
    }
    const finished = mine.reduce((t, fl) => t + (fl.officeDeliveryKg ?? 0), 0);
    return { used: batches.reduce((t, fl) => t + fl.purchasedWeightKg, 0), byFabric: [...byFabric], finished };
  }, [knitting, chosen, flows]);

  const problem =
    !chosen ? `Choose the ${meta.material}.` :
    knitting && types.some((t) => !t.fabricType.trim() || !t.fabricDiameter.trim()) ? (types.length > 1 ? "Enter the fabric type and diameter of every type." : "Enter the fabric type and diameter.") :
    needsMill && !f.mill.trim() ? `Choose the ${process} mill.` :
    !f.startDate ? "Enter the start date." :
    machineProblem ? machineProblem :
    process === "dyeing" ? lotsProblem(lines, chosen.balanceKg) :
    "";

  const start = async () => {
    setError("");
    if (problem || !chosen) return fail(problem);
    setBusy(true);
    try {
      const flow = knitting
        ? await api<FabricFlow & { started?: Array<{ flowNo: string; fabricType: string | null; yarnKg: number }> }>("/production/fabric-flows/start-knitting", {
            method: "POST",
            silent: true,
            body: JSON.stringify({
              millType,
              // Each fabric type is its own knitting batch; one type alone takes all of the yarn.
              fabrics: types.map((t) => ({
                fabricType: t.fabricType.trim(),
                fabricDiameter: t.fabricDiameter.trim(),
                fabricGsm: t.fabricGsm.trim() || undefined,
                gg: t.gg.trim() || undefined,
                ll: t.ll.trim() || undefined,
                machines: ownKnitting ? t.machines.map((pick) => ({ machineId: pick.machineId, operatorId: pick.operatorId || undefined, ratePerKg: Number(pick.ratePerKg) })) : undefined,
              })),
              yarnItemCode: chosen.itemCode,
              warehouseId: chosen.warehouseId,
              yarnLotNo: chosen.lotNo ?? undefined,
              yarnCategory: chosen.category,
              startDate: f.startDate,
              startShift: ownKnitting ? startShift : undefined,
              expectedFinishDate: f.expectedFinishDate || undefined,
              partyDetails: millType === "OWN" ? "Own mill" : undefined,
              millDetails: millType === "OWN" ? "Own mill" : f.mill.trim(),
            }),
          })
        : await api<FabricFlow>("/production/fabric-flows/start-stock-process", {
            method: "POST",
            silent: true,
            body: JSON.stringify({
              process,
              itemCode: chosen.itemCode,
              warehouseId: chosen.warehouseId,
              startDate: f.startDate,
              partyDetails: f.mill.trim(),
              millDetails: f.mill.trim(),
              lots: process === "dyeing" ? lotsPayload(lines) : undefined,
              inwardNo: process === "compacting" ? f.inwardNo.trim() || undefined : undefined,
              notes: f.notes.trim() || undefined,
            }),
          });
      toast.success(
        knitting
          ? `${startedText(flow)} ${millType === "OWN" ? "The selected machines are knitting now" : `Sent to ${f.mill.trim()}`}; when each finishes, record the fabric made and the yarn used.`
          : process === "dyeing"
            ? `${lines.length === 1 ? `Dyeing lot ${flow.flowNo}` : `${lines.length} dyeing lots from ${flow.flowNo}`} started at ${f.mill.trim()}.`
            : `${flow.flowNo}: ${process} started at ${f.mill.trim()} with ${kg(chosen.balanceKg)}.`,
        "Process started",
      );
      onStarted(flow);
    } catch (e) {
      fail(errorMessage(e, `Could not start ${process}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="users-dialog__overlay" />
        <Dialog.Content className={cn("users-dialog production-page production-modal start-dialog", `is-${process}`)} aria-describedby="start-dialog-caption" onEscapeKeyDown={keepDialogForOpenDropdown}>
          <div className="users-dialog__head">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-[#123f35]">Start a process</Dialog.Title>
              <Dialog.Description id="start-dialog-caption" className="text-xs text-gray-500">Choose the process, the material and who does it. How much was used and what it cost are entered when the process is completed.</Dialog.Description>
            </div>
            <Dialog.Close className="users-dialog__close" aria-label="Close" disabled={busy}><X size={16} /></Dialog.Close>
          </div>
          <form ref={bodyRef} className="users-dialog__body" onSubmit={(e) => { e.preventDefault(); void start(); }}>
            {error && <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle size={17} />{error}</div>}

            <div className="start-dialog__processes" role="radiogroup" aria-label="Process">
              {PROCESSES.map(({ key, label, icon: Icon, text }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={process === key}
                  className={cn("start-dialog__process", `is-${key}`)}
                  onClick={() => {
                    if (key === process) return;
                    setProcess(key);
                    setPicked("");
                    set({ mill: "" });
                  }}
                >
                  <span className="start-dialog__icon"><Icon size={18} /></span>
                  <span className="min-w-0">
                    <strong>{label}</strong>
                    <small>{text}</small>
                    <em>{!loaded[key] ? "Loading…" : stock[key].length ? `${stock[key].length} in stock` : "None in stock"}</em>
                  </span>
                </button>
              ))}
            </div>

            <section className="production-field-section">
              <SectionHeading icon={meta.icon} title={`1 · ${meta.material[0].toUpperCase()}${meta.material.slice(1)} from stock`} caption={chosen ? (process === "dyeing" ? `${kg(chosen.balanceKg)} of ${chosen.itemCode} to dye in one colour or several` : knitting ? `${kg(chosen.balanceKg)} of ${chosen.itemCode} goes to knitting` : `All ${kg(chosen.balanceKg)} of ${chosen.itemCode} goes to ${process}`) : `Pick the ${meta.material} to ${process}`} />
              <StockPicker rows={stock[process]} warehouses={warehouses} material={meta.material} loading={!loaded[process]} selectedKey={picked} keyOf={keyOf} onSelect={(row) => setPicked(row ? keyOf(row) : "")} />
              {knitting && chosen && (
                <div className="knit-plan">
                  <p className="text-xs text-gray-700">
                    No weight now. When knitting finishes, enter the <b>fabric made</b> and the <b>yarn used</b>: the yarn not used goes back into {chosen.itemCode} in the warehouse.
                  </p>
                  {yarnHistory && (
                    <div className="knit-plan__history">
                      <p className="font-semibold text-gray-700">{chosen.itemCode} so far: {kg(yarnHistory.used)} yarn knitted{yarnHistory.finished > 0 ? ` · ${kg(yarnHistory.finished)} finished fabric` : ""}</p>
                      <ul>
                        {yarnHistory.byFabric.map(([name, row]) => (
                          <li key={name}><span>{name}</span><span>{row.batches} batch{row.batches === 1 ? "" : "es"} · {kg(row.yarn)} yarn → {kg(row.grey)} fabric</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="production-field-section">
              <SectionHeading icon={Building2} title={`2 · ${meta.label} details`} caption={knitting ? "Where it is knitted and the fabric to make" : `Who ${process === "dyeing" ? "dyes" : "compacts"} it and when`} />
              {knitting && (
                <div className="mb-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Knitting mill">
                  {([
                    ["OWN", "Own mill", "Choose free machines below and start knitting", Factory],
                    ["OTHER", "Other mill", "Yarn sent to an outside knitting mill", Building2],
                  ] as const).map(([value, title, text, Icon]) => (
                    <button key={value} type="button" role="radio" aria-checked={millType === value} className={cn("start-dialog__mill", millType === value && "is-active")} onClick={() => { setMillType(value); set({ mill: "" }); }}>
                      <Icon size={16} aria-hidden />
                      <span><strong>{title}</strong><small>{text}</small></span>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-3">
                {needsMill && (
                  <Field label={`${meta.label} mill`} required className="md:col-span-2">
                    <SearchableSelect
                      placeholder={`Search ${process} mill or add new`}
                      options={knitting ? directory.knittingMills : process === "dyeing" ? directory.dyeingMills : directory.compactingMills}
                      value={f.mill}
                      onChange={(mill) => set({ mill })}
                    />
                  </Field>
                )}
                <Field label="Start / entry date" required hint="Earlier dates allowed"><EntryDateInput max={localDate()} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
                {knitting && <Field label="Expected finish" hint="Optional"><Input type="date" min={f.startDate} value={f.expectedFinishDate} onChange={(e) => set({ expectedFinishDate: e.target.value })} /></Field>}
                {knitting && (
                  <div className="knit-types md:col-span-3">
                    {types.map((t, index) => {
                      return (
                        <div key={index} className="knit-type">
                          <div className="knit-type__head">
                            <span className="knit-type__badge">Type {index + 1}</span>
                            <span className="text-[11px] text-gray-500">{chosen ? `${flowCodeHint(chosen.itemCode, index)}` : "its own knitting batch"}</span>
                            {types.length > 1 && (
                              <button type="button" className="pform__icon-btn ml-auto" aria-label={`Remove type ${index + 1}`} onClick={() => setTypes((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
                            )}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Fabric type" required><Input placeholder="Single jersey, Rib…" maxLength={120} value={t.fabricType} onChange={(e) => setType(index, { fabricType: e.target.value })} /></Field>
                            <Field label="Diameter" required><Input placeholder="e.g. 30 DIA" maxLength={40} value={t.fabricDiameter} onChange={(e) => setType(index, { fabricDiameter: e.target.value })} /></Field>
                            <Field label="GSM" hint="Optional"><Input inputMode="decimal" maxLength={20} placeholder="e.g. 180" value={t.fabricGsm} onChange={(e) => setType(index, { fabricGsm: e.target.value })} /></Field>
                            <Field label="Gauge (GG)" hint="Optional"><Input maxLength={40} placeholder="e.g. 24G" value={t.gg} onChange={(e) => setType(index, { gg: e.target.value })} /></Field>
                            <Field label="Loop length (LL)" hint="Optional"><Input maxLength={40} placeholder="e.g. 2.8 mm" value={t.ll} onChange={(e) => setType(index, { ll: e.target.value })} /></Field>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {types.length < 10 && (
                        <button type="button" className="plots-input__add" onClick={() => setTypes((current) => [...current, newType()])}><Plus size={14} /> Add another fabric type</button>
                      )}
                      <span className="text-xs text-gray-500">
                        {types.length === 1
                          ? "One fabric type: all of the yarn goes to it."
                          : `${chosen ? `${kg(chosen.balanceKg)} of yarn` : "The yarn"} is shared by the ${types.length} types. Each records the fabric made and yarn used when it finishes; what none used goes back after the last one.`}
                      </span>
                    </div>
                  </div>
                )}
                {process === "dyeing" && (
                  <Field label="Colours" required hint="Each colour is a dyeing lot with its own code" className="md:col-span-3">
                    <DyeingLotsInput lines={lines} onChange={setLines} available={chosen?.balanceKg ?? null} batchCode={chosen ? flowOf(chosen.itemCode)?.flowNo ?? chosen.itemCode : "KT01"} lotsSoFar={chosen ? flowOf(chosen.itemCode)?.lots.length ?? 0 : 0} />
                  </Field>
                )}
                {process === "compacting" && <Field label="Inward number" hint="Optional"><Input maxLength={80} placeholder="Gate pass / challan" value={f.inwardNo} onChange={(e) => set({ inwardNo: e.target.value })} /></Field>}
                {!knitting && <Field label="Notes" hint="Optional" className="md:col-span-3"><Input maxLength={1000} placeholder="Vehicle, instructions…" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>}
              </div>
            </section>

            {ownKnitting && (
              <section className="production-field-section">
                <SectionHeading icon={Factory} title="3 · Choose machines" caption="See which machines are free or working. Choose free machines for each fabric type; open More details to inspect their status and production." />
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">{freeMachines.length} free</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{workingMachines.length} working</span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">{machines.length - freeMachines.length - workingMachines.length} unavailable</span>
                  <span className="rounded-full bg-[#e8f0f7] px-3 py-1 text-xs font-bold text-[#1b3c55]">{allPicks.length} selected</span>
                  <Button variant="outline" className="ml-auto" disabled={busy || machineBoard.loading} onClick={() => void machineBoard.reload()}>{machineBoard.loading ? "Loading machines…" : "Refresh machines"}</Button>
                </div>
                <Field label="Machine start shift" required className="mb-4 max-w-sm"><select className="erp-input" disabled={busy} value={startShift} onChange={(event) => setStartShift(event.target.value as Shift)}><option value="DAY">Day · 9 AM – 9 PM</option><option value="NIGHT">Night · 9 PM – 9 AM</option></select></Field>
                {machineBoard.error && <p role="alert" className="mb-3 text-xs text-rose-700">{machineBoard.error}</p>}
                {!machineBoard.data && !machineBoard.error && <p role="status" className="text-sm text-gray-500">Loading machines and their work details…</p>}
                {machineBoard.data && (
                  <div className="grid gap-4">
                    {types.map((type, index) => (
                      <div key={index} className="rounded-2xl border border-gray-200 bg-white/70 p-3">
                        <h3 className="mb-1 text-sm font-bold text-[#123f35]">Type {index + 1}{type.fabricType.trim() ? ` · ${type.fabricType.trim()}` : ""}{type.fabricDiameter.trim() ? ` · ${type.fabricDiameter.trim()}` : ""}</h3>
                        <p className="mb-3 text-xs text-gray-500">{type.machines.length ? `${type.machines.length} machine${type.machines.length === 1 ? "" : "s"} selected` : "Choose one or more free machines for this fabric."}</p>
                        <MachinePicker
                          context={machineBoard.data!}
                          runs={machineBoard.data!.runs}
                          picks={type.machines}
                          reservedIds={types.filter((_, other) => other !== index).flatMap((other) => other.machines.map((pick) => pick.machineId))}
                          disabled={busy}
                          onChange={(selected) => setType(index, { machines: selected })}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className="users-dialog__foot items-center">
              <p className={cn("mr-auto text-xs", problem ? "font-semibold text-amber-700" : "text-gray-500")}>
                {problem || (chosen && (process === "dyeing"
                  ? <>{lines.length === 1 ? "One dyeing lot" : `${lines.length} dyeing lots`} from <span className="font-mono">{chosen.itemCode}</span>, each with its delivery challan.</>
                  : knitting
                    ? <><span className="font-mono">{chosen.itemCode}</span> to knitting. Fabric made and yarn used are entered when it finishes.</>
                    : <>All <b>{kg(chosen.balanceKg)}</b> of <span className="font-mono">{chosen.itemCode}</span> goes to {process} with a delivery challan.</>))}
              </p>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !!problem}><Play size={15} /> {busy ? "Starting…" : `Start ${process}`}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
