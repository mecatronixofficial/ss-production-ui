"use client";
import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast-store";
import { errorMessage } from "@/lib/utils";

export type ActionMessage = { text: string; error: boolean } | null;

/**
 * Runs a mutation with busy / message state and toasts.
 * API failures are already toasted by `api()`, so only non-API errors are toasted here.
 */
export function useApiAction() {
  const [message, setMessage] = useState<ActionMessage>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<unknown>, successMessage?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (successMessage) {
        setMessage({ text: successMessage, error: false });
        toast.success(successMessage);
      }
      return true;
    } catch (error) {
      const text = errorMessage(error, "Action failed");
      setMessage({ text, error: true });
      if (!(error instanceof ApiError)) toast.error(text);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Shows a client-side validation problem without calling the API. */
  const reject = useCallback((text: string, title = "Check the form") => {
    setMessage({ text, error: true });
    toast.warning(text, title);
    return false;
  }, []);

  return { message, setMessage, busy, run, reject };
}
