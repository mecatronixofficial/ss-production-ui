"use client";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

export type ConfirmRequest = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

type Listener = (request: ConfirmRequest | null) => void;

let current: ConfirmRequest | null = null;
let listeners: Listener[] = [];
let counter = 0;

const emit = () => listeners.forEach((listener) => listener(current));

export function subscribeConfirm(listener: Listener) {
  listeners.push(listener);
  listener(current);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function settleConfirm(ok: boolean) {
  const request = current;
  current = null;
  emit();
  request?.resolve(ok);
}

/** Accessible replacement for `window.confirm()`; resolves `true` when confirmed. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // Only one dialog at a time: a new request cancels the previous one.
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { ...options, id: ++counter, resolve };
    emit();
  });
}
