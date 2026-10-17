"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Query flag the quick-create menu uses to open a page's "new" form (e.g. `/masters/machines?new=1`). */
export const NEW_PARAM = "new";
/** Query flag that opens a record page straight in edit mode (e.g. `/orders/abc?edit=1`). */
export const EDIT_PARAM = "edit";

export const newHref = (path: string) => `${path}?${NEW_PARAM}=1`;
export const editHref = (path: string) => `${path}?${EDIT_PARAM}=1`;

/**
 * Runs `onSet` when the URL carries `?<name>=1`, then strips the flag so a reload or back
 * navigation doesn't repeat it. Needs a <Suspense> ancestor (the ERP shell provides one).
 */
export function useQueryFlag(name: string, onSet: () => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;
  const requested = params.get(name) === "1";

  useEffect(() => {
    if (!requested) return;
    onSetRef.current();
    const rest = new URLSearchParams(params.toString());
    rest.delete(name);
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [requested, name, params, pathname, router]);
}

export const useNewParam = (onNew: () => void) => useQueryFlag(NEW_PARAM, onNew);
