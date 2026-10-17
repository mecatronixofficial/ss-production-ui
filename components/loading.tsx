import { cn } from "@/lib/utils";

export function Loading({ fullScreen = false, label = "Loading" }: { fullScreen?: boolean; label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("grid place-items-center", fullScreen ? "min-h-screen" : "min-h-[300px]")}
    >
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
