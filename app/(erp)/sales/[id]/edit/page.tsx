"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import type { Sale } from "@/lib/sales";
import { useApiQuery } from "@/lib/use-api-query";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";
import { SaleForm } from "../../sale-form";

/** `/sales/<id>/edit`: correct a sale the warehouse hasn't dispatched yet (or sent back); it goes to the warehouse again. */
export default function EditSalePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApiQuery<Sale>(`/sales/${id}`);
  const back = <Link href={`/sales/${id}`} className="purchases-back-link"><ArrowLeft size={15} /> Back to the sale</Link>;
  if (!data) return error ? <div className="inventory-list-page">{back}<ErrorState message={error} onRetry={() => void reload()} /></div> : <Loading />;
  const sale: Sale = data;
  const editable = sale.status === "PENDING" || sale.status === "REJECTED";
  return (
    <div className="inventory-list-page">
      {back}
      <div className="item-details-header">
        <span className="warehouses-page-icon"><Pencil size={18} /></span>
        <div>
          <h2 className="text-xl font-bold text-[#1b3c55]">Edit {sale.saleNo}</h2>
          <p className="text-sm text-gray-500">{sale.partyName} · from {sale.warehouse.code}</p>
        </div>
      </div>
      {editable ? <SaleForm sale={sale} /> : <p className="warehouses-inactive-note">{sale.saleNo} is {sale.status.toLowerCase()} and can no longer be changed.</p>}
    </div>
  );
}
