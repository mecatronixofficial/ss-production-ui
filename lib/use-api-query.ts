"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/utils";

type QueryState<T> = { data: T | undefined; error: string; loading: boolean };

/** Responses kept in memory for instant revisits; the least recently used go first. */
const CACHE_LIMIT = 100;
const cache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();
/** The newest request per path, so an older response that lands late never replaces a newer one. */
const latest = new Map<string, number>();
const listeners = new Map<string, Set<(data: unknown) => void>>();
let sequence = 0;

function remember(path: string, data: unknown) {
  cache.delete(path);
  cache.set(path, data);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  listeners.get(path)?.forEach((listener) => listener(data));
}

/** One request per path at a time: components asking for the same path together share it. `fresh` always asks again. */
function load<T>(path: string, silent: boolean, fresh: boolean): Promise<T> {
  const pending = fresh ? undefined : inFlight.get(path);
  if (pending) return pending as Promise<T>;
  const id = ++sequence;
  latest.set(path, id);
  const request = api<T>(path, { silent })
    .then((data) => {
      if (latest.get(path) === id) remember(path, data);
      return data;
    })
    .finally(() => {
      if (inFlight.get(path) === request) inFlight.delete(path);
    });
  inFlight.set(path, request);
  return request;
}

/**
 * A response saved for this browser tab, so a page opened again (even after a reload) shows its last figures at once
 * while it loads the new ones. Saved per user; forgotten on sign-out.
 */
const SNAPSHOT_PREFIX = "erp:snapshot:";

export function readSnapshot<T>(key: string, owner: string | undefined): T | undefined {
  if (!owner) return undefined;
  try {
    const saved = JSON.parse(sessionStorage.getItem(SNAPSHOT_PREFIX + key) ?? "null") as { owner: string; data: T } | null;
    return saved?.owner === owner ? saved.data : undefined;
  } catch {
    return undefined;
  }
}

/** Larger responses are not saved: they would crowd out the tab's storage (about 5 MB). */
const SNAPSHOT_MAX_CHARS = 1_500_000;

export function saveSnapshot(key: string, owner: string | undefined, data: unknown) {
  if (!owner) return;
  try {
    const text = JSON.stringify({ owner, data });
    if (text.length > SNAPSHOT_MAX_CHARS) sessionStorage.removeItem(SNAPSHOT_PREFIX + key);
    else sessionStorage.setItem(SNAPSHOT_PREFIX + key, text);
  } catch {
    // Storage full or blocked: the page simply loads as usual next time.
  }
}

/**
 * Starts loading a path before it is shown (e.g. on hovering its link), so opening it is instant. Does nothing when it
 * is already loaded or loading; the page still refreshes it when it opens.
 */
export function prefetchApi(path: string) {
  if (cache.has(path) || inFlight.has(path)) return;
  load(path, true, false).catch(() => undefined);
}

/** Forgets every remembered response — on sign-out, so the next user never sees the last one's data. */
export function clearApiCache() {
  cache.clear();
  inFlight.clear();
  latest.clear();
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(SNAPSHOT_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

/**
 * Loads one API path and tracks loading / error state.
 *
 * - Pass `null` to skip loading (e.g. until the user is known).
 * - A path loaded before shows its last data at once and refreshes in the background (no spinner).
 * - Components showing the same path share requests and all update when any of them reloads it.
 * - Stale responses are ignored when the path changes or the component unmounts.
 * - `reload()` refetches without clearing the current data (no loading flash).
 * - `persist` (the signed-in user's id) also keeps the last response for the browser tab, so a reload shows it at once.
 */
export function useApiQuery<T>(path: string | null, options: { silent?: boolean; persist?: string } = {}) {
  const silent = options.silent ?? true;
  const { persist } = options;
  const [state, setState] = useState<QueryState<T>>(() => {
    if (path !== null && persist && !cache.has(path)) {
      const saved = readSnapshot<T>(path, persist);
      if (saved !== undefined) cache.set(path, saved);
    }
    return {
      data: path === null ? undefined : (cache.get(path) as T | undefined),
      error: "",
      loading: path !== null && !cache.has(path),
    };
  });
  // Bumped on every request and on unmount; a response only lands if it belongs to the newest one.
  const current = useRef(0);

  const fetchPath = useCallback(
    async (fresh: boolean) => {
      if (path === null) return undefined;
      const id = ++current.current;
      const cached = !fresh && cache.has(path);
      setState((state) =>
        cached ? { data: cache.get(path) as T, error: "", loading: false } : { ...state, loading: true, error: "" },
      );
      try {
        const data = await load<T>(path, silent, fresh);
        if (persist) saveSnapshot(path, persist, data);
        if (id === current.current) setState({ data, error: "", loading: false });
        return data;
      } catch (error) {
        if (id !== current.current) return undefined;
        setState((state) => ({ ...state, error: errorMessage(error, "Could not load data"), loading: false }));
        return undefined;
      }
    },
    [path, silent, persist],
  );

  useEffect(() => {
    void fetchPath(false);
    const requests = current;
    return () => {
      requests.current++;
    };
  }, [fetchPath]);

  // Another component reloaded the same path: show what it got.
  useEffect(() => {
    if (path === null) return;
    const listener = (data: unknown) => setState({ data: data as T, error: "", loading: false });
    let set = listeners.get(path);
    if (!set) listeners.set(path, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(path);
    };
  }, [path]);

  const reload = useCallback(() => fetchPath(true), [fetchPath]);

  const setData = useCallback((updater: T | ((current: T | undefined) => T)) => {
    setState((current) => ({
      ...current,
      data: typeof updater === "function" ? (updater as (c: T | undefined) => T)(current.data) : updater,
    }));
  }, []);

  return { ...state, reload, setData };
}
