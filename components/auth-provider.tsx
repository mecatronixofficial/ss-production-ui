"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, SESSION_EXPIRED_EVENT } from "@/lib/api";
import { toast } from "@/lib/toast-store";
import { clearApiCache } from "@/lib/use-api-query";
import type { User } from "@/lib/types";
import { Loading } from "./loading";

type Ctx = {
  user: User | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Ctx>({
  user: null,
  refresh: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * The signed-in user from the last visit. The app opens with it straight away (pages start loading at once) while
 * `/auth/me` confirms the session in the background; the API checks every request, so it grants nothing by itself.
 */
const USER_KEY = "erp:user";

function rememberedUser(): User | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) ?? "null") as User | null;
    return user && typeof user.id === "string" && typeof user.role === "string" ? user : null;
  } catch {
    return null;
  }
}

export function rememberUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data) — the app then waits for /auth/me.
  }
}

/** Signed out: forget the user and every response loaded for them. */
function forgetSession() {
  rememberUser(null);
  clearApiCache();
}

const loginUrl = (path: string | null) =>
  path && path !== "/" && path !== "/login" ? `/login?next=${encodeURIComponent(path)}` : "/login";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const path = usePathname();
  // Read the latest path inside callbacks without re-creating them on every navigation.
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ data: User }>("/auth/me", { silent: true });
      rememberUser(r.data);
      setUser(r.data);
    } catch {
      forgetSession();
      setUser(null);
      router.replace(loginUrl(pathRef.current));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Read after mount: the server render has no storage, and the first client render must match it.
    const known = rememberedUser();
    if (known) {
      setUser(known);
      setLoading(false);
    }
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => {
      forgetSession();
      setUser((current) => {
        if (current) toast.warning("Your session has expired. Please sign in again.", "Session expired");
        return null;
      });
      router.replace(loginUrl(pathRef.current));
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", silent: true });
    } catch {
      // Clear the local session even if the server call fails.
    } finally {
      forgetSession();
      setUser(null);
      toast.info("You have been signed out.", "Signed out");
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo(() => ({ user, refresh, logout }), [user, refresh, logout]);

  if (loading) return <Loading fullScreen />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
