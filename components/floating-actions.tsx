"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, Building2, Factory, PackageCheck, Plus, ReceiptIndianRupee, ShoppingCart, Warehouse, Wrench, type LucideIcon } from "lucide-react";
import { ADMIN_ROLES, canAccess, GODOWN_EDIT_ROLES } from "@/lib/navigation";
import type { Role } from "@/lib/types";
import { newHref } from "@/lib/use-new-param";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth-provider";

/** `roles` narrows an action further than page access (e.g. managers can view the godown but not add entries). */
type QuickAction = { href: string; label: string; caption: string; icon: LucideIcon; roles?: Role[] };

const QUICK_ACTIONS: QuickAction[] = [
  { href: newHref("/production"), label: "Yarn Batch", caption: "New SS code from purchase or stock", icon: Factory },
  { href: "/sales/new", label: "Sale", caption: "Bill a distributor or textile", icon: ReceiptIndianRupee, roles: ADMIN_ROLES },
  { href: newHref("/purchases"), label: "Purchase Order", caption: "Order yarn or material from a distributor or mill", icon: ShoppingCart },
  { href: newHref("/masters/machines"), label: "Machine", caption: "Register a machine", icon: Wrench },
  { href: newHref("/masters/distributors"), label: "Distributor", caption: "Add a distributor", icon: PackageCheck },
  { href: newHref("/warehouses"), label: "Stock Entry", caption: "Yarn or fabric in / out", icon: Warehouse, roles: GODOWN_EDIT_ROLES },
  { href: "/warehouses?warehouse=all&new=1", label: "Warehouse", caption: "Add a warehouse", icon: Building2, roles: ADMIN_ROLES },
];

const SHOW_TOP_AFTER = 400;

/** Bottom-right floating controls: scroll-to-top and the global "+" quick-create menu. */
export function FloatingActions() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SHOW_TOP_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const actions = user
    ? QUICK_ACTIONS.filter((a) => canAccess(a.href.split("?")[0], user.role) && (!a.roles || a.roles.includes(user.role)))
    : [];

  const scrollToTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // The button hides once at the top, so hand keyboard focus back to the page.
    document.getElementById("main-content")?.focus({ preventScroll: true });
  };

  return (
    <div className="app-fab-stack">
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Scroll to top"
        title="Scroll to top"
        tabIndex={scrolled ? 0 : -1}
        aria-hidden={!scrolled}
        className={cn("app-fab-top", scrolled && "is-visible")}
      >
        <ArrowUp size={18} />
      </button>
      {actions.length > 0 && (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="app-fab" aria-label="Quick create" title="Quick create">
              <Plus size={24} strokeWidth={2.4} className="app-fab-icon" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="top" align="end" sideOffset={12} className="app-fab-menu">
              <DropdownMenu.Label className="app-fab-menu__label">Create new</DropdownMenu.Label>
              {actions.map(({ href, label, caption, icon: Icon }) => (
                <DropdownMenu.Item key={href} asChild>
                  <Link href={href} className="app-fab-menu__item">
                    <span className="app-fab-menu__icon">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="block truncate text-[11px] text-gray-500">{caption}</span>
                    </span>
                  </Link>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}
