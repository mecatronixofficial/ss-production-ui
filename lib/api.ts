import { toast } from "@/lib/toast-store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

export type ApiInit = RequestInit & { silent?: boolean };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fired when the session cannot be refreshed; the auth provider sends the user to /login. */
export const SESSION_EXPIRED_EVENT = "erp:session-expired";
/** Fired after any change is saved, so the bell can look for notifications it made at once. */
export const DATA_CHANGED_EVENT = "erp:data-changed";

const isAuthPath = (path: string) =>
  ["/auth/refresh", "/auth/login", "/auth/logout", "/auth/forgot-password"].some((p) => path.startsWith(p));

// The backend rotates refresh tokens, so parallel 401s must share a single
// refresh request — a second refresh with the already-rotated token would fail
// and sign the user out.
let refreshing: Promise<boolean> | null = null;
function refreshSession() {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const request = () =>
    fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });

  let res = await request();
  if (res.status === 401 && !isAuthPath(path)) {
    if (await refreshSession()) {
      res = await request();
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  return res;
}

async function readError(res: Response) {
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    message = Array.isArray(body.message) ? body.message.join(", ") : body.message || message;
  } catch {
    // Non-JSON error body — keep the status message.
  }
  return new ApiError(message, res.status);
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

async function execute(path: string, init: ApiInit) {
  const { silent, ...requestInit } = init;
  let res: Response;
  try {
    res = await send(path, requestInit);
  } catch (error) {
    if (isAbort(error)) throw error;
    const message =
      error instanceof Error && error.message !== "Failed to fetch"
        ? error.message
        : "Unable to reach the server. Check your connection and try again.";
    if (!silent) toast.error(message, "Connection error");
    throw new ApiError(message, 0);
  }
  if (!res.ok) {
    const error = await readError(res);
    if (!silent && res.status !== 401) toast.error(error.message);
    throw error;
  }
  const method = (requestInit.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && typeof window !== "undefined") window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  return res;
}

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await execute(path, init);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) return res.json() as Promise<T>;
  return res as unknown as T;
}

/** A file from the API (e.g. a PDF), with the signed-in session, as a Blob to share or save. */
export async function apiBlob(path: string, init: ApiInit = {}) {
  const res = await execute(path, init);
  return res.blob();
}

/** Downloads a file endpoint (Excel/PDF exports) through the same auth + refresh flow. */
export async function apiDownload(path: string, fileName: string, init: ApiInit = {}) {
  const blob = await apiBlob(path, init);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** JSON body helper: `api("/x", post(body))`. Drops `undefined` values. */
export const post = (body?: unknown, method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST"): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};
