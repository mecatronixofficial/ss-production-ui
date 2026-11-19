"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, humanize, kg, money } from "@/lib/utils";
import { qs } from "@/lib/api";
import type { PiDetails, PiResponse } from "./pi-types";
import "./pi-details.css";

const material = (key: string) => ({ YARN: "Yarn", GREY_FABRIC: "Grey fabric", DYED_FABRIC: "Dyed fabric", FINISHED_FABRIC: "Finished fabric" })[key] ?? humanize(key);
export const when = (value: string | null) => value ? formatDate(value) : "—";
const weight = (value: number | null) => value === null ? "—" : kg(value);
export const productionHref = (code: string) => `/production?batch=${encodeURIComponent(code)}`;
export const piHref = (id: string) => `/pi-details/${encodeURIComponent(id)}`;
export const piDone = (row: PiDetails) => row.stages.length > 0 && row.stages.every(stage => stage.state === "Completed");
/** Stages in progress ("Knitting / Dyeing"), all done, or not started. */
export const piStatus = (row: PiDetails) =>
  row.stages.filter(stage => stage.state === "In progress").map(stage => stage.stage).join(" / ") || (piDone(row) ? "Recorded processes completed" : "To process");

/** The six headline figures of one production code. */
export function PiSummary({ row }: { row: PiDetails }) {
  return <dl className="pi-figures pi-record-figures"><Figure label="Yarn given" value={kg(row.yarn.givenKg)} /><Figure label="Finished fabric" value={kg(row.summary.finishedKg)} /><Figure label="Production loss" value={kg(row.summary.productionLossKg)} note={row.summary.productionGainKg > 0 ? `${kg(row.summary.productionGainKg)} net gain` : "Completed stages only"} loss={row.summary.productionLossKg > 0} /><Figure label="Delivered to parties" value={kg(row.summary.deliveredKg)} note="Includes warehouse sales" /><Figure label="Remaining material" value={kg(row.summary.remainingKg)} /><Figure label="Total cost" value={money(row.summary.totalCost)} note={`${money(row.summary.totalExpense)} process & other expenses`} /></dl>;
}

function Figure({ label, value, note, loss }: { label: string; value: string; note?: string; loss?: boolean }) {
  return <div className={cn("pi-figure", loss && "is-loss")}><dt>{label}</dt><dd>{value}</dd>{note && <p>{note}</p>}</div>;
}

export function PiRecordDetails({ row }: { row: PiDetails }) {
  const purchase = row.purchase;
  const costs = [
    ["Yarn used / input cost", row.costs.yarnAmount], ["Purchase expenses", row.costs.purchaseOther],
    ["Knitting", row.costs.knitting], ["Dyeing", row.costs.dyeing], ["Compacting", row.costs.compacting],
    ["Delivery / transport", row.costs.delivery], ["Additional expenses", row.costs.additional],
  ] as const;
  return <div className="pi-detail-body">
    <div className="pi-two-columns">
      <section className="pi-panel" aria-label={`Yarn purchase for ${row.code}`}>
        <h4>Yarn purchase & usage</h4>
        {purchase ? <><p className="pi-panel-caption">{purchase.receiptNo} · {purchase.mill} · DC {purchase.dcNo} · {when(purchase.receivedAt)}</p><dl className="pi-figures pi-figures--three"><Figure label="Purchased yarn" value={kg(purchase.weightKg)} /><Figure label="Purchase rate / kg" value={purchase.ratePerKg === null ? "Not recorded" : money(purchase.ratePerKg)} /><Figure label="Purchase amount" value={purchase.amount === null ? "Not recorded" : money(purchase.amount)} /></dl></> : <p className="pi-panel-caption">No linked yarn receipt. The production allocation and rate are shown below.</p>}
        <dl className="pi-figures pi-figures--three">
          <Figure label="Yarn given" value={kg(row.yarn.givenKg)} />
          <Figure label="Yarn used" value={weight(row.yarn.usedKg)} note={row.yarn.usedKg === null ? "Confirmed when knitting finishes" : undefined} />
          <Figure label="Unused yarn returned" value={kg(row.yarn.returnedKg)} />
          <Figure label="Yarn still at mill" value={kg(row.yarn.atMillKg)} note="Given less recorded day usage" />
          <Figure label="Yarn / knitting loss" value={weight(row.yarn.lossKg)} note="Confirmed when knitting finishes" loss={!!row.yarn.lossKg} />
          <Figure label="Batch rate / kg" value={money(row.yarn.ratePerKg)} />
          <Figure label="Batch yarn cost" value={money(row.yarn.amount)} />
          <Figure label="Yarn stock now" value={kg(row.yarn.stockKg)} note="Source yarn code, across batches" />
        </dl>
      </section>
      <section className="pi-panel" aria-label={`Costs for ${row.code}`}>
        <h4>Amount at every stage</h4>
        <dl className="pi-costs">{costs.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}<div className="pi-costs-total"><dt>Total production cost</dt><dd>{money(row.summary.totalCost)}</dd></div></dl>
        <p className="pi-panel-caption">Colour lots share the original yarn cost. That cost is counted once in this total.</p>
      </section>
    </div>
    <section aria-label={`Stage details for ${row.code}`}>
      <h4 className="pi-subtitle">Start to finish · process details</h4>
      <p className="pi-help">Loss is calculated only for completed stages. Unused material returned to stock is deducted before calculating loss.</p>
      <div className="pi-table-wrap"><table className="pi-table"><thead><tr><th>Stage / code</th><th>Mill & dates</th><th>Input</th><th>Unused returned</th><th>Output</th><th>Loss / gain</th><th>Expense</th><th>Not sent on</th></tr></thead><tbody>
        {row.stages.map(stage => <tr key={`${stage.batchCode}-${stage.stage}`}>
          <td><b>{stage.stage}</b><Link href={productionHref(stage.batchCode)}>{stage.batchCode}</Link>{stage.color && <small>{stage.color}</small>}<span className={cn("pi-status", stage.state === "Completed" && "is-done")}>{stage.state}</span></td>
          <td>{stage.mill || "—"}<small>{when(stage.startedAt)} → {when(stage.finishedAt)}</small></td>
          <td>{kg(stage.inputKg)}</td><td>{kg(stage.returnedKg)}</td><td>{weight(stage.outputKg)}</td>
          <td className={cn(!!stage.lossKg && "pi-loss")}>{stage.lossKg === null ? "Pending" : stage.gainKg ? `${kg(stage.gainKg)} gain` : `${kg(stage.lossKg)} loss`}</td>
          <td>{money(stage.expense)}</td><td>{weight(stage.balanceKg)}</td>
        </tr>)}
      </tbody></table></div>
      <p className="pi-help">“Not sent on” excludes material sent to another process, a party, or a warehouse. Live stock in a warehouse is listed below.</p>
    </section>
    <div className="pi-two-columns">
      <section className="pi-panel" aria-label={`Material balance for ${row.code}`}>
        <h4>Remaining material · all locations</h4>
        <dl className="pi-costs">{row.balances.length ? row.balances.map(balance => <div key={balance.material}><dt>{material(balance.material)}</dt><dd>{kg(balance.kg)}</dd></div>) : <p className="pi-help">No production material remaining.</p>}</dl>
        <p className="pi-help">Includes material at mills, in warehouses, and awaiting receipt. Customer deliveries and warehouse sales are deducted.</p>
        {row.summary.pendingReceiptKg > 0 && <p className="pi-help"><b>{kg(row.summary.pendingReceiptKg)}</b> awaiting warehouse receipt</p>}
        {row.summary.receiptDifferenceKg !== 0 && <p className="pi-help">Warehouse receipt difference: <b>{kg(Math.abs(row.summary.receiptDifferenceKg))} {row.summary.receiptDifferenceKg > 0 ? "short" : "extra"}</b>. Shown separately from production loss.</p>}
      </section>
      <section className="pi-panel" aria-label={`Warehouse balances for ${row.code}`}>
        <h4>Live warehouse stock</h4>
        {row.warehouseStock.length ? <ul className="pi-stock-list">{row.warehouseStock.map((stock,index) => <li key={`${stock.code}-${stock.warehouse}-${index}`}><div><b>{material(stock.material)}</b><small>{stock.code} · {stock.warehouse}{stock.lotNo ? ` · lot ${stock.lotNo}` : ""}</small>{stock.sourceYarn && <small>Source yarn balance across batches</small>}</div><strong className={cn(stock.kg < 0 && "pi-loss")}>{kg(stock.kg)}</strong></li>)}</ul> : <p className="pi-help">No stock currently held under these codes.</p>}
        <p className="pi-help">Warehouse fabric is part of the remaining material above. Source yarn stock is shown separately.</p>
      </section>
    </div>
    <section aria-label={`Deliveries for ${row.code}`}>
      <h4 className="pi-subtitle">Delivery & warehouse history</h4>
      {row.deliveries.length ? <div className="pi-table-wrap"><table className="pi-table"><thead><tr><th>Date / code</th><th>Material</th><th>Sent to</th><th>Sent</th><th>Received</th><th>Status</th><th>Amount</th><th>Delivery expense</th></tr></thead><tbody>{row.deliveries.map(delivery => <tr key={delivery.id}><td>{when(delivery.date)}<small>{delivery.batchCode}</small></td><td>{material(delivery.material)}</td><td>{delivery.to}</td><td>{kg(delivery.sentKg)}</td><td>{weight(delivery.receivedKg)}</td><td>{delivery.destination === "CUSTOMER" ? "Delivered to party" : delivery.receivedAt ? `Received ${when(delivery.receivedAt)}` : "Awaiting warehouse receipt"}</td><td>{money(delivery.amount)}</td><td>{money(delivery.expense)}</td></tr>)}</tbody></table></div> : <p className="pi-help">No delivery recorded yet.</p>}
    </section>
    {row.sales.length > 0 && <section><h4 className="pi-subtitle">Dispatched warehouse sales</h4><div className="pi-table-wrap"><table className="pi-table"><thead><tr><th>Date / bill</th><th>Material / code</th><th>Party</th><th>Warehouse</th><th>Dispatched</th><th>Rate / kg</th><th>Line amount before GST</th></tr></thead><tbody>{row.sales.map(sale => <tr key={sale.id}><td>{when(sale.date)}<small>{sale.billNo}</small></td><td>{material(sale.material)}<small>{sale.code}</small></td><td>{sale.party}</td><td>{sale.warehouse}</td><td>{kg(sale.kg)}</td><td>{money(sale.rate)}</td><td>{money(sale.amount)}</td></tr>)}</tbody></table></div></section>}
    {row.expenses.length > 0 && <section><h4 className="pi-subtitle">Additional expense entries</h4><div className="pi-table-wrap"><table className="pi-table"><thead><tr><th>Date</th><th>Batch code</th><th>Category</th><th>Details</th><th>Amount</th></tr></thead><tbody>{row.expenses.map(expense => <tr key={expense.id}><td>{when(expense.date)}</td><td>{expense.batchCode}</td><td>{expense.category}</td><td>{expense.description || "—"}</td><td>{money(expense.amount)}</td></tr>)}</tbody></table></div></section>}
    <Link className="pi-open-production pi-no-print" href={productionHref(row.code)}>Open full production record <ArrowRight size={14} /></Link>
  </div>;
}

export function PiDetailsSection() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const report = useApiQuery<PiResponse>(`/dashboard/pi-details${qs({ q: query, page })}`);
  const { reload } = report;
  const data = report.data?.data;
  return <section className="pi-section" aria-label="PI details" id="pi-details">
    <div className="pi-section-head"><div><p className="pi-eyebrow">Yarn to delivery</p><h3>PI details</h3><p>Follow each production code, its colour lots, stage expenses, loss and remaining stock.</p></div><Button variant="outline" onClick={() => void reload()} disabled={report.loading}><RefreshCw size={14} className={cn(report.loading && "animate-spin")} /> Refresh</Button></div>
    <form className="pi-search" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}><Search size={16} aria-hidden /><Input aria-label="Search PI details" placeholder="Yarn code, production code, PI number or yarn count" value={search} onChange={e => setSearch(e.target.value)} maxLength={100} /><Button type="submit" disabled={report.loading}>Search</Button>{query && <Button type="button" variant="outline" onClick={() => { setSearch(""); setQuery(""); setPage(1); }}>Clear</Button>}</form>
    {report.error && <div className="pi-error" role="alert">PI details could not load: {report.error}<button onClick={() => void reload()}>Retry</button></div>}
    {report.loading && !data && <p className="pi-help" role="status">Loading PI details…</p>}
    {data && !report.error && <div aria-busy={report.loading} className={cn("pi-list", report.loading && "opacity-60")}>
      {!data.rows.length ? <p className="pi-empty">{query ? "No production codes match this search." : "Start a production batch to see its yarn, process costs and balances here."}</p> : <div className="pi-table-wrap"><table className="pi-table pi-list-table">
        <thead><tr><th>Production code</th><th>Yarn / PI</th><th>Started</th><th>Status</th><th className="is-num">Yarn given</th><th className="is-num">Finished fabric</th><th className="is-num">Loss</th><th className="is-num">Delivered</th><th className="is-num">Remaining</th><th className="is-num">Total cost</th><th aria-label="Actions" /></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.id}>
          <td><Link className="pi-code" href={piHref(row.id)}>{row.code}</Link>{row.fabric && <small>{row.fabric}</small>}</td>
          <td>{row.yarnCode || "Yarn allocation"}<small>{row.yarnCount}{row.piNo ? ` · PI ${row.piNo}` : ""}</small></td>
          <td>{when(row.startedAt)}</td>
          <td><span className={cn("pi-status", piDone(row) && "is-done")}>{piStatus(row)}</span></td>
          <td className="is-num">{kg(row.yarn.givenKg)}</td>
          <td className="is-num">{kg(row.summary.finishedKg)}</td>
          <td className={cn("is-num", row.summary.productionLossKg > 0 && "pi-loss")}>{kg(row.summary.productionLossKg)}{row.summary.productionGainKg > 0 && <small>{kg(row.summary.productionGainKg)} gain</small>}</td>
          <td className="is-num">{kg(row.summary.deliveredKg)}</td>
          <td className="is-num">{kg(row.summary.remainingKg)}</td>
          <td className="is-num"><b>{money(row.summary.totalCost)}</b></td>
          <td><Link className="pi-more" href={piHref(row.id)} aria-label={`More details for ${row.code}`}>More details <ArrowRight size={13} /></Link></td>
        </tr>)}</tbody>
      </table></div>}
      {data.total > 0 && <div className="pi-pagination"><p>{(data.page-1)*data.pageSize+1}–{Math.min(data.page*data.pageSize,data.total)} of {data.total} production batches</p><div><Button variant="outline" disabled={page <= 1 || report.loading} onClick={() => setPage(p => p-1)}>Previous</Button><Button variant="outline" disabled={page*data.pageSize >= data.total || report.loading} onClick={() => setPage(p => p+1)}>Next</Button></div></div>}
    </div>}
  </section>;
}
