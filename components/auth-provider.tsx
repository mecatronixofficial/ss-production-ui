"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, SESSION_EXPIRED_EVENT } from "@/lib/api";
import { toast } from "@/lib/toast-store";
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
      setUser(r.data);
    } catch {
      setUser(null);
      router.replace(loginUrl(pathRef.current));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => {
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
      setUser(null);
      toast.info("You have been signed out.", "Signed out");
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo(() => ({ user, refresh, logout }), [user, refresh, logout]);

  if (loading) return <Loading fullScreen />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
