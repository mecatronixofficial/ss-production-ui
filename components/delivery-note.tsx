"use client";

import { formatDate } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import type { ChallanCompany, ItemSpec } from "@/components/challan-parts";
import { shortNo } from "@/components/yarn-received-note";
import "./yarn-received-note.css";

/** The process delivery challan as the note needs it (a subset of `/production/challans/:id`). */
export type DeliveryNoteDoc = {
  challanNo: string;
  process: string;
  date: string;
  material: string;
  fromName: string;
  toName: string;
  weightKg: number;
  packages: number | null;
  packageUnit: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  flow: { flowNo: string; yarnCount: string; fabricType: string | null; color: string | null };
  toDetails?: { address: string | null; city: string | null; gst: string | null; phone: string | null } | null;
  specs: ItemSpec[];
  yarnMill?: string | null;
  issuedBy: string | null;
  company: ChallanCompany;
};

/** As printed on the knitting division's delivery note book; used when Settings has none. */
const BOOK = {
  gst: "33EGQPP3465Q1ZF",
  address: ["No.1A, Puthuran Thottam, Samundipuram South,", "Tirupur - 641 603."],
  phone: "94437 60226, 99620 60226",
};

/** Ruled rows of the particulars, as in the book; the fabric's figures go on its row. */
const ROWS = ["Mill Name", "Count", "Fabric", "Colour"] as const;

/** 1009.24 → "1,009.240": kilo and grams written as one figure, as in the book's "Kilo grams" column. */
const kiloGrams = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * A process delivery challan in the layout of the knitting division's delivery note book (white paper, black ruling,
 * typed text): GSTIN and letterhead, the note's number and date, "To M/s" with the party's GSTIN, the particulars
 * (mill, count, fabric, colour) with G.G., GSM, dia, rolls and weight, the job-work total, delivered by, vehicle and
 * the signature for the company.
 */
export function DeliveryNote({ c }: { c: DeliveryNoteDoc }) {
  const co = c.company ?? {};
  const company = co.name || BRAND.name;
  const address = co.address ? [co.address, [co.city, co.state, co.pincode].filter(Boolean).join(" - ")].filter(Boolean) : BOOK.address;
  const spec = (label: string) => c.specs.find((s) => s.label === label)?.value ?? null;
  const to = c.toDetails;
  const toPlace = [to?.address, to?.city].filter(Boolean).join(", ");
  const values: Record<(typeof ROWS)[number], string | null> = {
    "Mill Name": c.yarnMill ?? null,
    Count: spec("Count") ?? c.flow.yarnCount,
    Fabric: spec("Fabric") ?? c.flow.fabricType ?? c.material,
    Colour: spec("Colour") ?? c.flow.color,
  };
  const rolls = c.packages ?? null;

  return (
    <article className={`yrn dln challan-doc${c.cancelledAt ? " is-cancelled" : ""}`} aria-label={`Delivery note ${c.challanNo}`}>
      <div className="yrn__frame">
        <p className="dln__gstin">GSTIN : {co.gst || BOOK.gst}</p>
        <p className="yrn__tab">Delivery Note{c.cancelledAt ? " · Cancelled" : ""}</p>

        <header className="yrn__head">
          <div className="yrn__company">
            <p className="yrn__name">{company}</p>
            {address.map((part) => <p key={part} className="yrn__address">{part}</p>)}
            <p className="yrn__cell">Cell : {co.phone || BOOK.phone}</p>
          </div>
          <div className="yrn__meta">
            <div className="yrn__meta-row">
              <span className="yrn__field"><small>No.</small><b>{shortNo(c.challanNo)}</b></span>
              <span className="yrn__field yrn__date"><small>Date</small><b>{formatDate(c.date)}</b></span>
            </div>
            <div className="yrn__field"><small>To. M/s.</small><b>{c.toName || "—"}</b></div>
            <div className="yrn__field"><small aria-hidden /><b>{toPlace || to?.phone || " "}</b></div>
            <div className="yrn__field"><small>GSTIN :</small><b>{to?.gst || " "}</b></div>
          </div>
        </header>

        <dl className="yrn__facts is-one-row" style={{ "--yrn-fact-cols": 3 } as React.CSSProperties}>
          <div><dt>From</dt><dd>{c.fromName}</dd></div>
          <div><dt>Process</dt><dd>{c.process}</dd></div>
          <div><dt>Batch</dt><dd>{c.flow.flowNo}</dd></div>
        </dl>

        <div className="yrn__table-wrap">
          <table className="yrn__table dln__table">
            <thead>
              <tr>
                <th className="dln__particulars-head">Particulars</th>
                <th>G.G.</th>
                <th>GSM</th>
                <th>Dia</th>
                <th>No.of<br />Roll / Bag</th>
                <th>Weight<br /><span className="dln__unit">Kilo&nbsp;&nbsp;grams</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const fabric = row === "Fabric";
                return (
                  <tr key={row}>
                    <td className="dln__particular"><span className="dln__label">{row}</span><span className="dln__colon">:</span><b>{values[row] || ""}</b></td>
                    <td className="yrn__num dln__center">{fabric ? spec("GG") ?? "" : ""}</td>
                    <td className="yrn__num dln__center">{fabric ? spec("GSM") ?? "" : ""}</td>
                    <td className="yrn__num dln__center">{fabric ? spec("Dia") ?? "" : ""}</td>
                    <td className="yrn__num dln__center">{fabric ? rolls ?? "—" : ""}</td>
                    <td className="yrn__num yrn__strong">{fabric ? kiloGrams(c.weightKg) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}><div className="yrn__job">Note For Sales Only Job Work<span>TOTAL</span></div></td>
                <td className="yrn__num dln__center">{rolls ?? "—"}</td>
                <td className="yrn__num">{kiloGrams(c.weightKg)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {c.notes && <p className="yrn__note"><b>Remarks:</b> {c.notes}</p>}
        {c.cancelledAt && <p className="yrn__note"><b>Cancelled</b> {formatDate(c.cancelledAt)}{c.cancelReason ? ` · ${c.cancelReason}` : ""}</p>}
        <p className="yrn__note yrn__note--muted">{c.process} of batch {c.flow.flowNo}.{c.issuedBy ? ` Issued by ${c.issuedBy}.` : ""} Computer-generated delivery note; not a tax invoice.</p>

        <footer className="yrn__foot dln__foot">
          <div className="yrn__field"><small>Delivered By :</small><b>{c.driverName || " "}</b></div>
          <div className="yrn__field"><small>Vehicle No.</small><b>{c.vehicleNo || " "}</b></div>
          <div className="yrn__sign">
            <div className="yrn__sign-line" />
            <p>For <span>{co.legalName || company}</span></p>
          </div>
        </footer>
      </div>
    </article>
  );
}
