"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/utils";

type QueryState<T> = { data: T | undefined; error: string; loading: boolean };

/**
 * Loads one or more API paths in parallel and tracks loading / error state.
 *
 * - Pass `null` to skip loading (e.g. until the user is known).
 * - Stale responses are ignored when the path changes or the component unmounts.
 * - `reload()` refetches without clearing the current data (no loading flash).
 */
export function useApiQuery<T>(path: string | null, options: { silent?: boolean } = {}) {
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: "", loading: path !== null });
  const controllerRef = useRef<AbortController | null>(null);
  const silent = options.silent ?? true;

  const run = useCallback(async () => {
    if (path === null) return undefined;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await api<T>(path, { signal: controller.signal, silent });
      if (!controller.signal.aborted) setState({ data, error: "", loading: false });
      return data;
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      setState((current) => ({ ...current, error: errorMessage(error, "Could not load data"), loading: false }));
      return undefined;
    }
  }, [path, silent]);

  useEffect(() => {
    void run();
    return () => controllerRef.current?.abort();
  }, [run]);

  const setData = useCallback((updater: T | ((current: T | undefined) => T)) => {
    setState((current) => ({
      ...current,
      data: typeof updater === "function" ? (updater as (c: T | undefined) => T)(current.data) : updater,
    }));
  }, []);

  return { ...state, reload: run, setData };
}
