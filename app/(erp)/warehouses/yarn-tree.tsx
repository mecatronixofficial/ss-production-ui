"use client";

import { Children, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, ChevronDown, Droplets, Factory, RotateCcw, Sparkles, Truck, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, formatDate, gsmText, kg } from "@/lib/utils";
import { CheckChip, type YarnStory } from "./yarn-story";

const EMPTY = 0.0005;
const batchHref = (code: string) => `/production?batch=${encodeURIComponent(code)}`;
const itemHref = (code: string) => `/warehouses/item?code=${encodeURIComponent(code)}`;

type Batch = YarnStory["batches"][number];
type Colour = Batch["colours"][number];
type Delivery = Colour["deliveries"][number];

/**
 * One node of the tree: a step (yarn, knitting, dyeing, compacting, delivery) with its code linked to the step, its
 * weights and the check against the step before. Nodes with children fold open and shut.
 */
function TreeNode({
  icon: Icon,
  tone,
  title,
  code,
  href,
  meta,
  weights,
  check,
  focus,
  children,
}: {
  icon: LucideIcon;
  tone: "yarn" | "knit" | "dye" | "compact" | "deliver" | "back" | "idle";
  title: ReactNode;
  code?: string;
  href?: string;
  meta?: ReactNode;
  weights?: ReactNode;
  check?: ReactNode;
  focus?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = Children.toArray(children).length > 0;
  return (
    <li className="ytree__item">
      <div className={cn("ytree__node", `is-${tone}`, focus && "is-focus")}>
        <span className="ytree__icon"><Icon size={14} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="ytree__title">
            {title}
            {code && (href ? <Link href={href} className="ytree__code">{code}</Link> : <span className="ytree__code">{code}</span>)}
          </p>
          {meta && <p className="ytree__meta">{meta}</p>}
          {weights && <p className="ytree__weights">{weights}</p>}
        </div>
        {check && <span className="shrink-0">{check}</span>}
        {hasChildren && (
          <button type="button" className="ytree__fold" aria-label={open ? "Fold" : "Open"} aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronDown size={14} className={cn("transition-transform", !open && "-rotate-90")} />
          </button>
        )}
      </div>
      {hasChildren && open && <ul className="ytree__children">{children}</ul>}
    </li>
  );
}

function Kg({ label, value }: { label: string; value: number | null }) {
  return (
    <span>
      {label} <b>{value === null ? "—" : kg(value)}</b>
    </span>
  );
}

function DeliveryLeaves({ deliveries }: { deliveries: Delivery[] }) {
  return (
    <>
      {deliveries.map((d, i) => (
        <TreeNode
          key={`${d.to}-${i}`}
          icon={d.toParty ? Truck : Warehouse}
          tone="deliver"
          title={<>{d.toParty ? "Delivered to" : "Stored in"} <b>{d.to}</b></>}
          meta={formatDate(d.date)}
          weights={<Kg label="KG" value={d.kg} />}
        />
      ))}
    </>
  );
}

/** A colour (dyeing lot): its dyeing, then compacting, then where it was delivered. */
function ColourNode({ c, focus }: { c: Colour; focus: string }) {
  const compacted = c.finishedKg !== null || c.stage === "COMPACTING";
  const leftToDeliver = c.finishedKg !== null ? Math.max(0, c.finishedKg - c.deliveredKg) : 0;
  const deliveries = <DeliveryLeaves deliveries={c.deliveries} />;
  return (
    <TreeNode
      icon={Droplets}
      tone="dye"
      title={<>Dyeing · <b>{c.color ?? "No colour yet"}</b></>}
      code={c.flowNo}
      href={batchHref(c.flowNo)}
      focus={c.flowNo === focus}
      meta={[c.dyeingMill, c.dyeingDate && formatDate(c.dyeingDate), c.stage === "NOT_DYED" ? "not dyed yet" : c.stage === "DYEING" ? "dyeing now" : null].filter(Boolean).join(" · ") || undefined}
      weights={<><Kg label="Grey in" value={c.greyKg} /> <ArrowRight size={11} className="inline text-gray-300" aria-hidden /> <Kg label="Dyed" value={c.dyedKg} /></>}
      check={c.dyeing ? <CheckChip check={c.dyeing} /> : undefined}
    >
      {(c.dyeingBalanceKg ?? 0) > EMPTY && (
        <TreeNode icon={RotateCcw} tone="back" title="Grey not dyed, back to the warehouse" weights={<Kg label="KG" value={c.dyeingBalanceKg ?? null} />} />
      )}
      {compacted ? (
        <TreeNode
          icon={Sparkles}
          tone="compact"
          title="Compacting"
          meta={[c.compactingMill, c.finishedKg === null ? "compacting now" : null].filter(Boolean).join(" · ") || undefined}
          weights={<><Kg label="Dyed in" value={c.dyedKg} /> <ArrowRight size={11} className="inline text-gray-300" aria-hidden /> <Kg label="Finished" value={c.finishedKg} /></>}
          check={c.compacting ? <CheckChip check={c.compacting} /> : undefined}
        >
          {(c.compactingBalanceKg ?? 0) > EMPTY && (
            <TreeNode icon={RotateCcw} tone="back" title="Dyed not compacted, back to the warehouse" weights={<Kg label="KG" value={c.compactingBalanceKg ?? null} />} />
          )}
          {c.deliveries.length > 0 && deliveries}
          {leftToDeliver > EMPTY && <TreeNode icon={Boxes} tone="idle" title="Finished fabric not delivered yet" weights={<Kg label="KG" value={Math.round(leftToDeliver * 1000) / 1000} />} />}
          {c.overall && (
            <TreeNode icon={Sparkles} tone="idle" title="Grey to finished" weights={<><Kg label="Grey" value={c.overall.inKg} /> → <Kg label="Finished" value={c.overall.outKg} /></>} check={<CheckChip check={c.overall} />} />
          )}
        </TreeNode>
      ) : (
        c.deliveries.length > 0 && deliveries
      )}
    </TreeNode>
  );
}

/** A knitting batch: the yarn it took, the grey fabric it made, and each colour it was dyed in. */
function BatchNode({ b, focus }: { b: Batch; focus: string }) {
  const fabric = [b.fabric.type, b.fabric.diameter && `${b.fabric.diameter} dia`, gsmText(b.fabric.gsm)].filter(Boolean).join(" · ") || "Fabric";
  return (
    <TreeNode
      icon={Factory}
      tone="knit"
      title={<>Knitting · <b>{fabric}</b></>}
      code={b.flowNo}
      href={batchHref(b.flowNo)}
      focus={b.flowNo === focus}
      meta={[b.mill ?? "Knitting", `${formatDate(b.startedAt)}${b.finishedAt ? ` → ${formatDate(b.finishedAt)}` : ""}`, b.knitting ? "knitting now" : null].filter(Boolean).join(" · ")}
      weights={
        <>
          <Kg label="Yarn given" value={b.yarnGivenKg} />
          {!b.knitting && <> · <Kg label="used" value={b.yarnUsedKg} /></>} <ArrowRight size={11} className="inline text-gray-300" aria-hidden /> <Kg label="Grey fabric" value={b.greyKg} />
        </>
      }
      check={b.knittingCheck ? <CheckChip check={b.knittingCheck} /> : undefined}
    >
      {b.yarnReturnedKg > EMPTY && <TreeNode icon={RotateCcw} tone="back" title="Yarn not used, back to the warehouse" weights={<Kg label="KG" value={b.yarnReturnedKg} />} />}
      {b.colours.map((c) => <ColourNode key={c.flowNo} c={c} focus={focus} />)}
      {b.soldAtKnitting && b.deliveries.length > 0 && <DeliveryLeaves deliveries={b.deliveries} />}
      {!b.soldAtKnitting && b.greyLeftKg !== null && b.greyLeftKg > EMPTY && (
        <TreeNode icon={Boxes} tone="idle" title="Grey fabric not dyed yet" weights={<Kg label="KG" value={b.greyLeftKg} />} />
      )}
    </TreeNode>
  );
}

/**
 * A yarn as a tree: the yarn received, each knitting batch it went to, each colour that batch was dyed in, its
 * compacting and where the fabric was delivered, with the weight checked at every step. Every code links to its
 * batch; what came back or is still waiting shows as its own leaf.
 */
export function YarnTree({ story }: { story: YarnStory }) {
  const { yarn } = story;
  const received = story.received[0];
  return (
    <ul className="ytree">
      <TreeNode
        icon={Boxes}
        tone="yarn"
        title={<>Yarn · <b>{yarn.name ?? "Yarn"}</b></>}
        code={yarn.code}
        href={itemHref(yarn.code)}
        focus={yarn.code === story.focus}
        meta={received ? `Received ${formatDate(received.date)} · DC ${received.dcNo || "—"} · ${received.mill}${story.received.length > 1 ? ` · +${story.received.length - 1} more` : ""}` : undefined}
        weights={
          <>
            <Kg label="Received" value={yarn.receivedKg} /> · <Kg label="to knitting" value={yarn.toKnittingKg} />
            {yarn.returnedKg > EMPTY && <> · <Kg label="came back" value={yarn.returnedKg} /></>}
          </>
        }
      >
        {story.batches.map((b) => <BatchNode key={b.flowNo} b={b} focus={story.focus} />)}
        {yarn.inStockKg > EMPTY && <TreeNode icon={Warehouse} tone="idle" title="Yarn still in stock" weights={<Kg label="KG" value={yarn.inStockKg} />} />}
        {yarn.otherOutKg > EMPTY && <TreeNode icon={Truck} tone="idle" title="Yarn out otherwise (sold or moved)" weights={<Kg label="KG" value={yarn.otherOutKg} />} />}
      </TreeNode>
    </ul>
  );
}
