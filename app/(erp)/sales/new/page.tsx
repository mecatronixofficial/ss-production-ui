"use client";

import Link from "next/link";
import { ArrowLeft, ReceiptIndianRupee } from "lucide-react";
import { SaleForm } from "../sale-form";

/** `/sales/new`: a sale to a distributor or textile, sent to its warehouse to verify and dispatch. */
export default function NewSalePage() {
  return (
    <div className="inventory-list-page">
      <Link href="/sales" className="purchases-back-link"><ArrowLeft size={15} /> Sales</Link>
      <div className="item-details-header">
        <span className="warehouses-page-icon"><ReceiptIndianRupee size={18} /></span>
        <div>
          <h2 className="text-xl font-bold text-[#1b3c55]">New sale</h2>
          <p className="text-sm text-gray-500">Who it is to, what leaves which warehouse, and the vehicle. Saving gives the bill number and asks the warehouse to verify and dispatch it.</p>
        </div>
      </div>
      <SaleForm />
    </div>
  );
}
