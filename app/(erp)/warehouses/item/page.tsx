"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { qs } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/navigation";
import { useAuth } from "@/components/auth-provider";
import { Loading } from "@/components/loading";
import { Empty } from "@/components/empty";
import { ItemDetailsView } from "../item-details";

/** `/warehouses/item?code=01SS26&warehouse=<id>`: one item code's full details. */
function ItemPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const code = params.get("code")?.trim() ?? "";
  const warehouseId = params.get("warehouse") ?? "";
  const backHref = `/warehouses${qs({ warehouse: warehouseId })}`;

  // Back to wherever the code was opened from (a warehouse, a production batch…); a direct link goes to the warehouse.
  const goBack = (event: React.MouseEvent) => {
    if (window.history.length > 1) {
      event.preventDefault();
      router.back();
    }
  };

  return (
    <div className="inventory-list-page">
      <Link href={backHref} onClick={goBack} className="purchases-back-link">
        <ArrowLeft size={15} /> Back
      </Link>
      {code ? (
        <ItemDetailsView key={code} itemCode={code} currentWarehouseId={warehouseId || undefined} showPrices={!!user && ADMIN_ROLES.includes(user.role)} />
      ) : (
        <Empty title="No item code given" description="Open an item from a warehouse's stock or entries." />
      )}
    </div>
  );
}

export default function WarehouseItemPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ItemPage />
    </Suspense>
  );
}
