export type ToastKind = "success" | "error" | "info" | "warning";
export type ToastItem = {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  duration: number;
  /** A link the toast offers, e.g. "Open batch" for a notification. */
  action?: { label: string; href: string };
};

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let listeners: Listener[] = [];
let counter = 0;

function emit() {
  listeners.forEach((listener) => listener(toasts));
}

export function subscribeToasts(listener: Listener) {
  listeners.push(listener);
  listener(toasts);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function pushToast(kind: ToastKind, message: string, title?: string, duration = 5000, action?: ToastItem["action"]) {
  const duplicate = toasts.find(
    (item) => item.kind === kind && item.message === message && item.title === title,
  );
  if (duplicate) return duplicate.id;

  const id = ++counter;
  toasts = [...toasts, { id, kind, message, title, duration, action }].slice(-5);
  emit();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export const toast = {
  success: (message: string, title = "Success") => pushToast("success", message, title, 4500),
  error: (message: string, title = "Something went wrong") => pushToast("error", message, title, 7000),
  info: (message: string, title?: string) => pushToast("info", message, title, 5000),
  warning: (message: string, title?: string) => pushToast("warning", message, title, 6000),
  /** A notification as it arrives: shown a little longer, with a link to what it is about. */
  notification: (kind: ToastKind, title: string, message: string, action?: ToastItem["action"]) => pushToast(kind, message, title, 9000, action),
};
