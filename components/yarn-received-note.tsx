"use client";

import type { ReactNode } from "react";
import { formatDate, formatDateTime, humanize, money, unitQty } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { qty, STATUS_LABEL, type ReceivedChallan } from "@/lib/purchases";
import { ItemSpecs, unitTotals } from "@/components/challan-parts";
import type { StockBill } from "@/components/stock-bill";
import "./yarn-received-note.css";

/** An extra figure column of the table (ordered, balance, rate…), with its total. */
type NoteColumn = { key: string; label: string; total?: ReactNode };

/** One entry on the note: the item, its bags, its weight (KG split into kilo and grams) and the extra figures. */
export type NoteRow = {
  id: string;
  particulars: string;
  /** Under the item: its material and full details (count, mill, lot…). */
  sub?: ReactNode;
  code: ReactNode;
  bags: number | null;
  quantity: number;
  unit: string;
  cells?: Record<string, ReactNode>;
};

type NoteProps = {
  title: string;
  number: string;
  date: string | null;
  company: Record<string, string | undefined>;
  to: string | null;
  /** Under the party's name: code, contact, address, GSTIN… */
  toLines?: Array<string | null | undefined | false>;
  /** The reference box: PO, challan, vehicle, warehouse… */
  facts: Array<{ label: string; value: ReactNode }>;
  /** Header of the weight column pair: "Weight" or "Received now". */
  weightLabel?: string;
  before?: NoteColumn[];
  after?: NoteColumn[];
  rows: NoteRow[];
  cancelled?: boolean;
  notes?: string | null;
  /** Small print under the table. */
  footnotes?: Array<string | null | undefined | false>;
  signs?: [string, string];
};

const isKg = (unit: string) => unit.trim().toUpperCase() === "KG";

/** "30+9 = 39" or "22" → 39 / 22; null when no bags are written. */
function bagCount(value: string | null | undefined) {
  if (!value) return null;
  const total = value.includes("=") ? value.split("=").pop() : value;
  const n = Number(String(total).trim());
  return Number.isFinite(n) ? n : null;
}

/** 1320.6 KG → ["1,320", "600"]: kilo and grams, as the note's two weight columns. */
function kiloGrams(kg: number): [string, string] {
  const grams = Math.round(kg * 1000);
  return [Math.trunc(grams / 1000).toLocaleString("en-IN"), String(Math.abs(grams) % 1000).padStart(3, "0")];
}

/** Ruled empty rows under the entries, so the note keeps its height like the printed book. */
const MIN_ROWS = 4;

/**
 * A received challan in the layout of the knitting division's printed book (white paper, black ruling, typed text):
 * letterhead with the note's number, date and "To M/s", the reference box, one row per item with its bags and weight
 * in kilo and grams, the total, "Not for sales, only job work", and signatures for the company.
 */
export function ReceivedNote(props: NoteProps) {
  const { title, number, date, company: c, to, toLines = [], facts, weightLabel = "Weight", before = [], after = [], rows, cancelled, notes, footnotes = [], signs = ["Delivered by", "Received by (godown)"] } = props;
  const company = c.name || BRAND.name;
  const address = [c.address, [c.city, c.state, c.pincode].filter(Boolean).join(" - ")].filter(Boolean);
  const kgRows = rows.filter((row) => isKg(row.unit));
  const otherRows = rows.filter((row) => !isKg(row.unit));
  const totalBags = rows.some((row) => row.bags !== null) ? rows.reduce((sum, row) => sum + (row.bags ?? 0), 0) : null;
  const [totalKilo, totalGrams] = kiloGrams(kgRows.reduce((sum, row) => sum + row.quantity, 0));
  const fillers = Math.max(0, MIN_ROWS - rows.length);
  const span = 6 + before.length + after.length;
  const extra = (column: NoteColumn, row: NoteRow) => <td key={column.key} className="yrn__num">{row.cells?.[column.key] ?? "—"}</td>;

  return (
    <article className={`yrn challan-doc${cancelled ? " is-cancelled" : ""}`} aria-label={`${title} ${number}`}>
      <div className="yrn__frame">
        <p className="yrn__tab">{title}{cancelled ? " · Cancelled" : ""}</p>

        <header className="yrn__head">
          <div className="yrn__company">
            <p className="yrn__name">{company}</p>
            <p className="yrn__division">(Knitting Division)</p>
            {address.map((part) => <p key={part} className="yrn__address">{part}</p>)}
            {c.phone && <p className="yrn__cell">Cell : {c.phone}</p>}
            {c.gst && <p className="yrn__address">GSTIN {c.gst}</p>}
          </div>
          <div className="yrn__meta">
            <div className="yrn__meta-row">
              <span className="yrn__field"><small>No.</small><b>{number}</b></span>
              <span className="yrn__field yrn__date"><small>Date</small><b>{formatDate(date)}</b></span>
            </div>
            <div className="yrn__field"><small>To. M/s.</small><b>{to || "—"}</b></div>
            {toLines.filter(Boolean).map((line) => <p key={String(line)} className="yrn__to-line">{line}</p>)}
          </div>
        </header>

        <dl className="yrn__facts">
          {facts.map((fact) => (
            <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
          ))}
        </dl>

        <div className="yrn__table-wrap">
          <table className="yrn__table">
            <thead>
              <tr>
                <th rowSpan={2} className="yrn__col-no">#</th>
                <th rowSpan={2}>Particulars</th>
                <th rowSpan={2}>Code</th>
                <th rowSpan={2}>No. of<br />Roll/ Bag</th>
                {before.map((column) => <th key={column.key} rowSpan={2}>{column.label}</th>)}
                <th colSpan={2}>{weightLabel}</th>
                {after.map((column) => <th key={column.key} rowSpan={2}>{column.label}</th>)}
              </tr>
              <tr><th>Kilo</th><th>Grms</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const [kilo, grams] = isKg(row.unit) ? kiloGrams(row.quantity) : [unitQty(row.quantity, row.unit), ""];
                return (
                  <tr key={row.id}>
                    <td className="yrn__col-no">{index + 1}</td>
                    <td className="yrn__particulars"><b>{row.particulars}</b>{row.sub}</td>
                    <td className="yrn__code">{row.code}</td>
                    <td className="yrn__num">{row.bags ?? "—"}</td>
                    {before.map((column) => extra(column, row))}
                    <td className="yrn__num yrn__strong">{kilo}</td>
                    <td className="yrn__num yrn__strong">{grams}</td>
                    {after.map((column) => extra(column, row))}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={span} className="yrn__empty">No lines: the challan was cancelled and its movements released.</td></tr>
              )}
              {Array.from({ length: fillers }, (_, index) => (
                <tr key={`blank-${index}`} className="yrn__blank" aria-hidden>{Array.from({ length: span }, (_, cell) => <td key={cell} />)}</tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><div className="yrn__job">Not For Sales only Job Work<span>TOTAL</span></div></td>
                <td className="yrn__num">{totalBags ?? "—"}</td>
                {before.map((column) => <td key={column.key} className="yrn__num">{column.total ?? ""}</td>)}
                <td className="yrn__num">{totalKilo}</td>
                <td className="yrn__num">{totalGrams}</td>
                {after.map((column) => <td key={column.key} className="yrn__num">{column.total ?? ""}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
        {otherRows.length > 0 && <p className="yrn__note">Also received, not in the kilo total: {unitTotals(otherRows, (row) => row.quantity)}.</p>}
        {notes && <p className="yrn__note"><b>Remarks:</b> {notes}</p>}
        {footnotes.filter(Boolean).map((line) => <p key={String(line)} className="yrn__note yrn__note--muted">{line}</p>)}

        <footer className="yrn__foot">
          <div className="yrn__sign-box"><div className="yrn__sign-line" />{signs[0]}</div>
          <div className="yrn__sign-box"><div className="yrn__sign-line" />{signs[1]}</div>
          <div className="yrn__sign">
            <p>For <span>{c.legalName || company}</span></p>
            <p className="yrn__sign-division">(Knitting Division)</p>
            <div className="yrn__sign-line" />
            <p className="yrn__sign-caption">Authorised signature</p>
          </div>
        </footer>
      </div>
    </article>
  );
}

/** A warehouse received challan from the Yarn Received register, with everything the previous challan showed. */
export function YarnReceivedNote({ bill }: { bill: StockBill }) {
  const priced = bill.value !== null && bill.value !== undefined;
  const s = bill.source;
  return (
    <ReceivedNote
      title="Yarn Received Note"
      number={bill.billNo}
      date={bill.createdAt}
      company={bill.company ?? {}}
      to={bill.partyName}
      toLines={[s.partyAddress, [s.partyGst && `GSTIN ${s.partyGst}`, s.partyPhone && `Phone ${s.partyPhone}`].filter(Boolean).join(" · "), s.label]}
      facts={[
        { label: "Received into", value: `${bill.warehouse.code} · ${bill.warehouse.name}${bill.warehouse.location ? `, ${bill.warehouse.location}` : ""}` },
        { label: "Vehicle no", value: bill.vehicleNo || "—" },
        ...(s.transporter ? [{ label: "Transporter", value: s.transporter }] : []),
        ...(s.driverName ? [{ label: "Driver", value: s.driverName }] : []),
        ...(s.lrNo ? [{ label: "LR no", value: s.lrNo }] : []),
        ...(s.references ?? []).map((r) => ({ label: r.label, value: r.value })),
        { label: "Issued", value: `${formatDateTime(bill.createdAt)}${bill.createdBy ? ` · ${bill.createdBy}` : ""}` },
      ]}
      after={[
        { key: "material", label: "Material" },
        ...(priced ? [{ key: "rate", label: "Rate" }, { key: "value", label: "Value", total: money(bill.value ?? 0) }] : []),
      ]}
      rows={bill.lines.map((line) => ({
        id: line.id,
        particulars: line.itemName,
        sub: <ItemSpecs specs={line.specs} itemCode={line.itemCode} />,
        code: <>{line.itemCode}{line.lotNo && <span className="block">Lot {line.lotNo}</span>}</>,
        bags: bagCount(line.specs?.find((x) => x.label === "Bags")?.value),
        quantity: line.quantity,
        unit: line.unit,
        cells: {
          material: humanize(line.category),
          rate: line.rate === null || line.rate === undefined ? "—" : money(line.rate),
          value: line.amount === null || line.amount === undefined ? "—" : money(line.amount),
        },
      }))}
      cancelled={!!bill.cancelledAt}
      notes={bill.notes}
      footnotes={[`Computer-generated challan · ${bill.lines.length} line${bill.lines.length === 1 ? "" : "s"}.`]}
    />
  );
}

/** A purchase order's goods receipt (GRN), with everything the previous challan showed. */
export function GrnReceivedNote({ challan }: { challan: ReceivedChallan }) {
  const s = challan.supplier;
  const po = challan.purchaseOrder;
  const withPrices = challan.pricesShown;
  const yarnOnly = challan.lines.length > 0 && challan.lines.every((line) => line.category === "YARN");
  return (
    <ReceivedNote
      title={yarnOnly ? "Yarn Received Note" : "Material Received Note"}
      number={challan.receiptNo}
      date={challan.receivedAt}
      company={challan.company}
      to={s.name}
      toLines={[
        s.company && s.company !== s.name ? s.company : null,
        `${s.partyType === "MILL" ? "Mill" : "Distributor"} ${s.code}${s.contactPerson ? ` · ${s.contactPerson}` : ""}${s.mobile ? ` · ${s.mobile}` : ""}`,
        s.address,
        s.gst && `GSTIN ${s.gst}`,
      ]}
      facts={[
        { label: "Purchase order", value: po.poNo },
        { label: "PO date", value: formatDate(po.orderDate) },
        { label: "Supplier challan / invoice", value: challan.challanNo || "—" },
        { label: "Vehicle no", value: challan.vehicleNo || "—" },
        { label: "Supplier lot", value: challan.lotNo || "—" },
        { label: "Received at", value: formatDateTime(challan.receivedAt) },
        { label: "Received by", value: challan.receivedBy || "—" },
        { label: "PO status now", value: STATUS_LABEL[po.status] },
        {
          label: "Received into",
          value: `${challan.warehouse.code} · ${challan.warehouse.name}${po.warehouse && po.warehouse.id !== challan.warehouse.id ? ` (ordered for ${po.warehouse.code})` : ""}`,
        },
      ]}
      weightLabel="Received now"
      before={[
        { key: "ordered", label: "Ordered", total: unitTotals(challan.lines, (line) => line.ordered) },
        { key: "earlier", label: "Earlier received", total: unitTotals(challan.lines, (line) => line.receivedBefore) },
      ]}
      after={[
        { key: "balance", label: "Balance to come", total: unitTotals(challan.lines, (line) => line.balance) },
        ...(withPrices ? [{ key: "rate", label: "Rate" }, { key: "amount", label: "Amount", total: money(challan.total ?? 0) }] : []),
      ]}
      rows={challan.lines.map((line) => ({
        id: line.id,
        particulars: line.itemName,
        sub: <><span className="yrn__material">{humanize(line.category)}</span><ItemSpecs specs={line.specs} itemCode={line.itemCode} hide={["Material", "PO"]} /></>,
        code: line.itemCode ?? "—",
        bags: line.packageCount ?? bagCount(line.packages),
        quantity: line.quantity,
        unit: line.unit,
        cells: {
          ordered: qty(line.ordered, line.unit),
          earlier: qty(line.receivedBefore, line.unit),
          balance: line.balance > 1e-9 ? qty(line.balance, line.unit) : "Complete",
          rate: money(line.rate ?? 0),
          amount: money(line.amount ?? 0),
        },
      }))}
      notes={challan.notes}
      footnotes={[
        withPrices && "Value at purchase-order rates, before tax.",
        `Material checked and taken into stock. Posted ${formatDateTime(challan.receivedAt)}${challan.receivedBy ? ` by ${challan.receivedBy}` : ""}.`,
      ]}
      signs={["Delivered by (driver)", "Received by (godown)"]}
    />
  );
}
