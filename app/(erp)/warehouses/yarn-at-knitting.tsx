"use client";

import Link from "next/link";
import { Factory } from "lucide-react";
import { qs } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDate, kg } from "@/lib/utils";
import { itemHref } from "./item-details";

/** `GET /inventory/yarn-at-knitting`: yarn out at a knitting batch, not in stock. */
type AtKnitting = {
  flowNo: string;
  yarnItemCode: string | null;
  yarnName: string;
  lotNo: string | null;
  warehouse: { id: string; code: string } | null;
  fabric: string;
  own: boolean;
  mill: string;
  startedAt: string | null;
  givenKg: number;
  usedKg: number;
  knittedKg: number;
  leftKg: number;
  machines: Array<{ code: string; runNo: string; running: boolean }>;
};

/**
 * The yarn this warehouse gave to knitting that isn't back or used up yet. It isn't stock (not in the KG above), so
 * it shows where it is: each knitting batch, the mill or the machines knitting it, the yarn given, used so far (the
 * machines' day-end entries) and left there. The rest comes back into stock when the knitting finishes.
 */
export function YarnAtKnitting({ warehouseId }: { warehouseId?: string }) {
  const { data } = useApiQuery<AtKnitting[]>(`/inventory/yarn-at-knitting${qs({ warehouseId: warehouseId || undefined })}`);
  if (!data?.length) return null;
  const left = data.reduce((t, r) => t + r.leftKg, 0);
  return (
    <section className="wh-knitting">
      <div className="wh-knitting__head">
        <span className="wh-knitting__icon"><Factory size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#1b3c55]">Yarn at knitting · {data.length} batch{data.length === 1 ? "" : "es"}</p>
          <p className="text-xs text-gray-500">Out of stock while it is knitted, so not in the KG above. About {kg(left)} is still there; what isn&apos;t used comes back when knitting finishes.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="wh-knitting__table">
          <thead>
            <tr><th>Yarn code</th><th>Knitting batch</th><th>Where</th><th className="num">Given</th><th className="num">Used so far</th><th className="num">Left there</th><th className="num">Fabric so far</th></tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.flowNo}>
                <td>
                  {r.yarnItemCode ? <Link href={itemHref(r.yarnItemCode)} className="font-mono font-semibold text-[#1b3c55] hover:underline">{r.yarnItemCode}</Link> : "—"}
                  <span className="block text-[11px] text-gray-500">{r.yarnName}{r.lotNo ? ` · lot ${r.lotNo}` : ""}{!r.warehouse || r.warehouse.id === warehouseId ? "" : ` · from ${r.warehouse.code}`}</span>
                </td>
                <td>
                  <Link href={`/production?batch=${encodeURIComponent(r.flowNo)}`} className="font-mono font-semibold text-[#1b3c55] hover:underline">{r.flowNo}</Link>
                  <span className="block text-[11px] text-gray-500">{r.fabric}{r.startedAt ? ` · since ${formatDate(r.startedAt)}` : ""}</span>
                </td>
                <td>
                  {r.own && r.machines.length ? (
                    <span className="flex flex-wrap gap-1">
                      {r.machines.map((m) => (
                        <span key={m.runNo} className={cn("wh-knitting__machine", m.running && "is-running")} title={`${m.runNo}${m.running ? " · knitting now" : " · stopped"}`}>{m.code}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">{r.own ? "Own mill · no machine yet" : r.mill}</span>
                  )}
                </td>
                <td className="num">{kg(r.givenKg)}</td>
                <td className="num">{r.own ? kg(r.usedKg) : <span className="text-[11px] text-gray-400">at finish</span>}</td>
                <td className="num font-semibold">{r.own ? kg(r.leftKg) : kg(r.givenKg)}</td>
                <td className="num">{r.knittedKg > 0 ? kg(r.knittedKg) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
