"use client";
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";

// Shared unread-notification count so the topbar badge updates immediately
// when notifications are read elsewhere in the app.
let count = 0;

/** Fired when new notifications have just popped up, so pages that list them (the dashboard) can reload. */
export const NOTIFICATIONS_ARRIVED_EVENT = "erp:notifications-arrived";
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function setUnreadCount(next: number) {
  if (next === count) return;
  count = Math.max(0, next);
  emit();
}

export async function refreshUnreadCount() {
  try {
    const result = await api<{ count: number }>("/notifications/unread-count", { silent: true });
    setUnreadCount(result.count);
  } catch {
    // Badge is best-effort; errors are ignored.
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useUnreadCount() {
  return useSyncExternalStore(subscribe, () => count, () => 0);
}
