"use client";
import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { isActive, navFor } from "@/lib/navigation";
import { useAuth } from "./auth-provider";

// The icon-only rail is a desktop layout; below `lg` the sidebar is a slide-out drawer.
const DESKTOP = "(min-width: 1024px)";

export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const path = usePathname();
  const { user } = useAuth();
  const sections = user ? navFor(user.role) : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onLogoClick = () => {
    if (window.matchMedia(DESKTOP).matches) onToggleCollapsed();
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={cn("fixed inset-0 z-40 bg-black/35 lg:hidden", open ? "block" : "hidden")}
      />
      <aside
        aria-label="Main navigation"
        className={cn(
          "app-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col text-white transition-[transform,width] duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed && "app-sidebar--collapsed",
        )}
      >
        <div className="app-sidebar-brand flex h-16 items-center gap-2.5 px-4">
          <button
            type="button"
            onClick={onLogoClick}
            className="app-sidebar-logo"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Image src={BRAND.logo} alt="" width={40} height={40} priority />
          </button>
          <div className="app-sidebar-brand-text min-w-0">
            <p className="truncate text-[13px] font-bold leading-tight">{BRAND.name}</p>
            <p className="truncate text-[10px] text-white/50">{BRAND.tagline}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto lg:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="app-sidebar-nav flex-1 overflow-y-auto overflow-x-hidden p-2.5">
          {sections.map((section) => (
            <div key={section.title} className="mb-2">
              <p className="app-sidebar-section-title px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[.18em] text-white/35">
                {section.title}
              </p>
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(path, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? label : undefined}
                    className={cn("app-sidebar-link", active && "app-sidebar-link--active")}
                  >
                    <span className="app-sidebar-link-icon">
                      <Icon size={16} />
                    </span>
                    <span className="app-sidebar-link-label truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="app-sidebar-footer">Input → Output → Waste → Balance</div>
      </aside>
    </>
  );
}
