"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bell, CheckCheck, CheckCircle2, Inbox, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { ADMIN_ROLES } from "@/lib/navigation";
import { notificationLink } from "@/lib/notification-links";
import { toast } from "@/lib/toast-store";
import { setUnreadCount } from "@/lib/unread-store";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/loading";
import { ErrorState } from "@/components/page-state";

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  type: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  isRead: boolean;
  createdAt: string;
  referenceType?: string | null;
  referenceId?: string | null;
};

/** The type as people say it; "JOB_COMPLETED" is a process (knitting, dyeing, compacting) or a machine run finishing. */
const typeLabel = (type: string) => (type === "JOB_COMPLETED" ? "Process completed" : humanize(type));

const priorityTone = (priority: NotificationRow["priority"]) =>
  priority === "CRITICAL" ? "danger" : priority === "HIGH" ? "warning" : "default";

export default function Notifications() {
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const { data: rows, error, reload, setData } = useApiQuery<NotificationRow[]>("/notifications");
  const [view, setView] = useState<"all" | "unread">("all");
  const [clearing, setClearing] = useState(false);

  const unreadCount = useMemo(() => (rows ?? []).filter((r) => !r.isRead).length, [rows]);
  const criticalCount = useMemo(
    () => (rows ?? []).filter((r) => !r.isRead && (r.priority === "CRITICAL" || r.priority === "HIGH")).length,
    [rows],
  );
  const visible = useMemo(() => (rows ?? []).filter((r) => view === "all" || !r.isRead), [rows, view]);

  // Keep the topbar badge in sync with what this page shows.
  useEffect(() => {
    if (rows) setUnreadCount(unreadCount);
  }, [rows, unreadCount]);

  // Optimistic updates: flip the read flag immediately, roll back by reloading on failure.
  const markAll = async () => {
    setData((current) => (current ?? []).map((r) => ({ ...r, isRead: true })));
    try {
      await api("/notifications/read-all", { method: "PATCH", silent: true });
    } catch {
      void reload();
    }
  };
  const markRead = async (row: NotificationRow) => {
    if (row.isRead) return;
    setData((current) => (current ?? []).map((r) => (r.id === row.id ? { ...r, isRead: true } : r)));
    try {
      await api(`/notifications/${row.id}/read`, { method: "PATCH", silent: true });
    } catch {
      void reload();
    }
  };

  // Deletes are optimistic too; `api()` toasts a failure and the reload restores the list.
  const remove = async (row: NotificationRow) => {
    setData((current) => (current ?? []).filter((r) => r.id !== row.id));
    try {
      await api(`/notifications/${row.id}`, { method: "DELETE" });
    } catch {
      void reload();
    }
  };
  const removeAll = async () => {
    const ok = await confirmDialog({
      title: "Delete all notifications?",
      description: "Every notification in your inbox, read and unread, will be removed. This cannot be undone.",
      confirmLabel: "Delete all",
      tone: "danger",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await api("/notifications", { method: "DELETE" });
      setData([]);
      toast.success("All notifications deleted.");
    } catch {
      void reload();
    } finally {
      setClearing(false);
    }
  };

  if (!rows && error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!rows) return <Loading />;

  return (
    <div className="notifications-page">
      <div className="notifications-list-header flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="notifications-page-icon">
            <Bell size={18} />
          </span>
          <div>
            <h2 className="text-lg font-bold md:text-xl">Notifications</h2>
            <p className="text-xs text-gray-500">Production, QC, stock, machine and delivery alerts.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 bg-white p-1" role="tablist" aria-label="Filter notifications">
            {(["all", "unread"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize",
                  view === value ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-50",
                )}
              >
                {value}
                {value === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            className="notifications-action-btn notifications-action-btn--outline"
            onClick={() => void markAll()}
            disabled={unreadCount === 0}
          >
            <CheckCheck size={16} />
            Mark all read
          </Button>
          <Button
            variant="outline"
            className="notifications-action-btn notifications-action-btn--danger"
            onClick={() => void removeAll()}
            disabled={rows.length === 0 || clearing}
          >
            <Trash2 size={16} />
            {clearing ? "Deleting..." : "Delete all"}
          </Button>
        </div>
      </div>

      <div className="notifications-stats grid gap-2.5 sm:grid-cols-3">
        <div className="notifications-stat-tile notifications-stat-tile--total">
          <div className="notifications-stat-icon">
            <Inbox size={15} />
          </div>
          <div>
            <p className="notifications-stat-label">Total</p>
            <p className="notifications-stat-value">{rows.length}</p>
          </div>
        </div>
        <div className="notifications-stat-tile notifications-stat-tile--unread">
          <div className="notifications-stat-icon">
            <Bell size={15} />
          </div>
          <div>
            <p className="notifications-stat-label">Unread</p>
            <p className="notifications-stat-value">{unreadCount}</p>
          </div>
        </div>
        <div className="notifications-stat-tile notifications-stat-tile--critical">
          <div className="notifications-stat-icon">
            <AlertTriangle size={15} />
          </div>
          <div>
            <p className="notifications-stat-label">High / Critical</p>
            <p className="notifications-stat-value">{criticalCount}</p>
          </div>
        </div>
      </div>

      <div className="notifications-list">
        {visible.map((n) => {
          const link = notificationLink(n, isAdmin);
          return (
          <div
            key={n.id}
            className={`notifications-row notifications-row--${n.priority.toLowerCase()} ${n.isRead ? "" : "notifications-row--unread"}`}
          >
            <button
              type="button"
              onClick={() => void markRead(n)}
              aria-label={n.isRead ? n.title : `${n.title} (unread — mark as read)`}
              className="notifications-row-main"
            >
              <span className={cn("notifications-row-icon", n.type === "JOB_COMPLETED" && "is-done")}>
                {n.type === "JOB_COMPLETED" ? <CheckCircle2 size={15} /> : <Bell size={15} />}
              </span>
              <div className="notifications-row-body">
                <div className="notifications-row-heading">
                  <p className="notifications-row-title">{n.title}</p>
                  <Badge tone={n.type === "JOB_COMPLETED" ? "success" : "info"}>{typeLabel(n.type)}</Badge>
                  <Badge tone={priorityTone(n.priority)}>{n.priority}</Badge>
                  {!n.isRead && <span className="notifications-row-dot" />}
                </div>
                <p className="notifications-row-message">{n.message}</p>
                <p className="notifications-row-time">{formatDateTime(n.createdAt)}</p>
              </div>
            </button>
            {link && (
              <Button size="sm" variant="outline" asChild className="shrink-0 self-center">
                <Link href={link.href} onClick={() => void markRead(n)}>
                  {link.label} <ArrowRight size={14} />
                </Link>
              </Button>
            )}
            <button
              type="button"
              onClick={() => void remove(n)}
              aria-label={`Delete notification: ${n.title}`}
              title="Delete"
              className="notifications-row-delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
          );
        })}
        {visible.length === 0 && (
          <div className="notifications-empty">
            <Inbox size={28} />
            <p>{view === "unread" ? "You're all caught up." : "No notifications."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
