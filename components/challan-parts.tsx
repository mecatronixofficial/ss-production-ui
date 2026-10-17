"use client";

import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { qty } from "@/lib/purchases";
import { formatDate } from "@/lib/utils";

/** The company profile from Settings, as the challan endpoints return it. */
export type ChallanCompany = Record<string, string | undefined>;

export const companyName = (c: ChallanCompany) => c.legalName || c.name || BRAND.name;

/** One fact about an item, from the API: e.g. { label: "GSM", value: "180" }. */
export type ItemSpec = { label: string; value: string };

/**
 * The item's full details under its name on a challan or bill: for fabric its type, dia, GSM, GG, LL, colour, count,
 * rolls and batch; for knitted fabric its run and machine; for purchased material its distributor and PO. What the
 * line's own cells already show (lot, material, the code itself) is left out.
 */
export function ItemSpecs({ specs, itemCode, hide = ["Lot", "Material"] }: { specs?: ItemSpec[] | null; itemCode?: string | null; hide?: string[] }) {
  const shown = (specs ?? []).filter((s) => !hide.includes(s.label) && s.value !== itemCode);
  if (!shown.length) return null;
  return (
    <span className="item-specs">
      {shown.map((s) => (
        <span key={s.label} className="item-specs__chip">
          <span className="item-specs__label">{s.label}</span> {s.value}
        </span>
      ))}
    </span>
  );
}

/** Challans are office documents: only admins open and print them, as one office copy. */
export const OFFICE_COPY = "Office copy";

/** Per unit, since KG and cones can't be added together: "120.000 KG · 40.000 CONE". */
export function unitTotals<T extends { unit: string }>(lines: T[], pick: (line: T) => number) {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.unit, (totals.get(line.unit) ?? 0) + pick(line));
  return [...totals].map(([unit, value]) => qty(value, unit)).join(" · ");
}

/** Letterhead of a printed challan: logo, company and its address / GSTIN, and the document's title, number, date and copy. */
export function ChallanLetterhead({ company: c, title, number, date, copyLabel }: { company: ChallanCompany; title: string; number: string; date: string | null; copyLabel: string }) {
  const place = [c.address, c.city, [c.state, c.pincode].filter(Boolean).join(" – ")].filter(Boolean).join(", ");
  return (
    <header className="sale-bill__head">
      <span className="sale-bill__logo"><Image src={BRAND.logo} alt="" width={56} height={56} className="h-full w-full object-cover" /></span>
      <div className="min-w-0 flex-1">
        <p className="sale-bill__company">{c.name || BRAND.name}</p>
        {c.legalName && c.legalName !== c.name && <p className="text-xs font-semibold text-gray-600">{c.legalName}</p>}
        {place && <p className="text-xs text-gray-600">{place}</p>}
        <p className="text-xs text-gray-600">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
        <p className="text-xs font-semibold text-gray-700">{[c.gst && `GSTIN ${c.gst}`, c.pan && `PAN ${c.pan}`].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="text-right">
        <p className="sale-bill__title">{title}</p>
        <p className="text-sm font-bold">{number}</p>
        <p className="text-xs text-gray-600">Date {formatDate(date)}</p>
        <span className="challan-copy__tag">{copyLabel}</span>
      </div>
    </header>
  );
}
