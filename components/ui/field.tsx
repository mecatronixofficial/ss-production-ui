import { cn } from "@/lib/utils";

/** Label + control wrapper. Wrapping in `<label>` links the text to the input for screen readers. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="erp-label flex items-center justify-between gap-2">
        {label}
        {hint && <span className="font-medium normal-case tracking-normal text-gray-400">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
