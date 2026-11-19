import { todayInput } from "./utils";

const key = () => {
  try { return `erp:entry-date:${JSON.parse(localStorage.getItem("erp:user") || "null")?.id || "local"}`; }
  catch { return "erp:entry-date:local"; }
};

/** The working date for this user's entries in this tab; changing a planned date does not change it. */
export function rememberEntryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayInput()) return;
  try { sessionStorage.setItem(key(), value); } catch { /* Storage can be unavailable. */ }
}

/** An explicit saved record wins; new entries carry the selected date forward, within process chronology. */
export function entryDate(notBefore?: string | null, fallback = todayInput()) {
  let value = fallback;
  try {
    const saved = sessionStorage.getItem(key());
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved <= todayInput()) value = saved;
  } catch { /* Render today's date when storage is unavailable. */ }
  return notBefore && notBefore.slice(0, 10) > value ? notBefore.slice(0, 10) : value;
}
