"use client";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { canAccess, homeFor, matchRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { AuthProvider, useAuth } from "./auth-provider";
import { FloatingActions } from "./floating-actions";
import { Loading } from "./loading";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const COLLAPSED_KEY = "erp:sidebar-collapsed";

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const allowed = user ? canAccess(path, user.role) : false;

  // Role guard: keep users out of pages their role can't use (the API would 403 anyway).
  useEffect(() => {
    if (user && !allowed) router.replace(homeFor(user.role));
  }, [allowed, router, user]);

  // Page titles — pages are client components, so they can't export `metadata`.
  useEffect(() => {
    const route = matchRoute(path);
    document.title = route ? `${route.label} · ${BRAND.name}` : BRAND.name;
    document.querySelector('meta[name="description"]')?.setAttribute("content", route?.description ?? BRAND.description);
  }, [path]);

  // Remember the icon-only sidebar per browser. Read after mount: the shell renders nothing until the
  // user has loaded, so this lands before the sidebar first paints.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage can be unavailable (private mode, blocked site data) — keep the default.
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        // Not persisted; the toggle still works for this visit.
      }
      return !value;
    });

  // Close the mobile menu on navigation and lock background scroll while it's open.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[4.5rem]" : "lg:pl-64")}>
        <Topbar onMenu={() => setOpen(true)} />
        <main id="main-content" tabIndex={-1} className="p-4 pb-24 outline-none md:p-6 md:pb-24">
          {/* Pages read search params (e.g. the quick-create `?new=1` flag), which needs a Suspense boundary. */}
          {allowed ? <Suspense fallback={<Loading />}>{children}</Suspense> : <Loading />}
        </main>
      </div>
      <FloatingActions />
    </div>
  );
}

export function ErpShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
