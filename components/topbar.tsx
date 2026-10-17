"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, ChevronDown, LogOut, Menu, ShieldCheck, UserRound } from "lucide-react";
import { api, DATA_CHANGED_EVENT } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/navigation";
import { notificationLink } from "@/lib/notification-links";
import { toast } from "@/lib/toast-store";
import { BRAND } from "@/lib/brand";
import { matchRoute } from "@/lib/navigation";
import { cn, humanize } from "@/lib/utils";
import { NOTIFICATIONS_ARRIVED_EVENT, refreshUnreadCount, useUnreadCount } from "@/lib/unread-store";
import { useAuth } from "./auth-provider";
import { GlobalSearch } from "./global-search";

const POLL_MS = 30_000;
/** While notifications are unread, the bell nudges this often as a reminder. */
const NUDGE_MS = 20_000;

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const unread = useUnreadCount();
  const route = matchRoute(usePathname());

  // The bell rings when a new notification arrives (and once on load if any are unread), and nudges while some are unread.
  const [bell, setBell] = useState<"ring" | "nudge" | null>(null);
  const shake = useCallback((kind: "ring" | "nudge") => {
    setBell(null);
    // Next frame, so the same animation can play again.
    requestAnimationFrame(() => setBell(kind));
  }, []);
  const previous = useRef<number | null>(null);
  // Newest notification already known (server time); only ones made after it pop up as a message.
  const seen = useRef<string | null>(null);
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  useEffect(() => {
    if (!user) return;
    // On load, remember the newest one without showing it: old notifications don't pop up again.
    void api<Array<{ createdAt: string }>>("/notifications/latest", { silent: true })
      .then((rows) => {
        seen.current = rows[0]?.createdAt ?? new Date().toISOString();
      })
      .catch(() => undefined);
  }, [user]);
  const popUpNew = useCallback(async () => {
    if (!seen.current) return;
    try {
      type Row = { id: string; title: string; message: string; type: string; priority: string; createdAt: string; referenceType: string | null; referenceId: string | null };
      const rows = await api<Row[]>(`/notifications/latest?since=${encodeURIComponent(seen.current)}`, { silent: true });
      if (!rows.length) return;
      seen.current = rows[0].createdAt;
      // Oldest first, so they stack in the order they happened.
      for (const n of [...rows].reverse()) {
        const kind = n.priority === "CRITICAL" ? "error" : n.priority === "HIGH" ? "warning" : n.type === "JOB_COMPLETED" ? "success" : "info";
        const link = notificationLink(n, isAdmin);
        toast.notification(kind, n.title, n.message, link ? { label: link.label, href: link.href } : undefined);
      }
      window.dispatchEvent(new Event(NOTIFICATIONS_ARRIVED_EVENT));
    } catch {
      // The bell still shows the count; the message is a bonus.
    }
  }, [isAdmin]);
  useEffect(() => {
    if (previous.current === null ? unread > 0 : unread > previous.current) shake("ring");
    if (previous.current !== null && unread > previous.current) void popUpNew();
    previous.current = unread;
  }, [unread, shake, popUpNew]);
  const hasUnread = unread > 0;
  useEffect(() => {
    if (!hasUnread) return;
    const timer = setInterval(() => document.visibilityState === "visible" && shake("nudge"), NUDGE_MS);
    return () => clearInterval(timer);
  }, [hasUnread, shake]);

  // Poll the lightweight count endpoint, and only while the tab is visible.
  useEffect(() => {
    if (!user) return;
    void refreshUnreadCount();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refreshUnreadCount();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refreshUnreadCount();
    document.addEventListener("visibilitychange", onVisible);
    // Saving a process, a receipt, a dispatch… may notify straight away: look a moment after any change.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void refreshUnreadCount(), 400);
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChanged);
    return () => {
      clearInterval(interval);
      clearTimeout(pending);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(DATA_CHANGED_EVENT, onChanged);
    };
  }, [user]);

  const initials =
    user?.name
      ?.split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "U";

  return (
    <header className="app-topbar sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-gray-200/70 bg-white/90 px-4 backdrop-blur-md md:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="app-topbar-burger grid h-10 w-10 place-items-center rounded-xl border border-gray-200 lg:hidden"
      >
        <Menu size={20} />
      </button>
      <div className="app-topbar-brand flex min-w-0 items-center gap-2.5">
        <span className="app-topbar-icon overflow-hidden lg:hidden">
          <Image src={BRAND.logo} alt="" width={37} height={37} className="h-full w-full object-cover" />
        </span>
        {/* Current page title and summary (falls back to the brand on unlisted routes). */}
        <div className="app-topbar-title min-w-0">
          <p className="truncate text-sm font-bold leading-tight text-[#13201b] md:text-[15px] lg:text-base">
            {route?.label ?? BRAND.name}
          </p>
          <p className="hidden truncate text-[11px] text-gray-500 sm:block lg:text-xs">
            {route?.description ?? BRAND.tagline}
          </p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {user && <GlobalSearch role={user.role} />}
        <Link
          href="/notifications"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
          className={cn("app-topbar-action app-topbar-bell relative grid h-10 w-10 place-items-center rounded-xl", bell && `is-${bell}`, hasUnread && "has-unread")}
          // The badge pop ends first; only the bell's own swing ending clears it.
          onAnimationEnd={(e) => (e.animationName === "bell-ring" || e.animationName === "bell-nudge") && setBell(null)}
        >
          <Bell size={18} />
          {unread > 0 && <span className="app-topbar-bell-badge">{unread > 9 ? "9+" : unread}</span>}
        </Link>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="app-topbar-user flex items-center gap-2.5 outline-none" aria-label="Account menu">
              <span className="app-topbar-avatar">{initials}</span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block text-sm font-semibold">{user?.name}</span>
                <span className="block text-[11px] text-gray-500">{humanize(user?.role)}</span>
              </span>
              <ChevronDown size={14} className="hidden text-gray-400 md:block" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 min-w-56 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl"
            >
              <div className="px-3 py-2">
                <p className="truncate text-sm font-bold">{user?.name}</p>
                <p className="truncate text-xs text-gray-500">{user?.email}</p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <ShieldCheck size={11} /> {humanize(user?.role)}
                </p>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
              <DropdownMenu.Item asChild>
                <Link
                  href="/profile"
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-gray-50"
                >
                  <UserRound size={15} /> My profile
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <Link
                  href="/notifications"
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-gray-50"
                >
                  <Bell size={15} /> Notifications
                  {unread > 0 && <span className="ml-auto text-xs font-bold text-rose-600">{unread}</span>}
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => void logout()}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none data-[highlighted]:bg-red-50"
              >
                <LogOut size={15} /> Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
