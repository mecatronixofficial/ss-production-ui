import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
  {
    variants: {
      tone: {
        default: "bg-gray-100 text-gray-700",
        success: "bg-emerald-100 text-emerald-700",
        warning: "bg-amber-100 text-amber-700",
        danger: "bg-red-100 text-red-700",
        info: "bg-blue-100 text-blue-700",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

const SUCCESS = /COMPLETE|CLOSED|DELIVERED|APPROVED|PAID|PASSED|RECEIVED|ACTIVE|RUNNING|CLEARED/;
const DANGER = /CANCEL|REJECT|RETURN|OVERDUE|BREAKDOWN|LOCKED|FAIL|UNPAID|BOUNCE/;
/** Checked before SUCCESS: these contain a success word ("PAID") but are not done yet. */
const PARTLY = /PART_PAID|CHEQUE_PENDING/;
const NEUTRAL = /DRAFT|WAITING|DISABLED|INACTIVE/;
const INFO = /CONFIRM|READY|ISSUED|DISPATCHED|TRANSIT|PARTIAL|QC|AT_OFFICE/;

/** Consistent badge colour for any backend status enum. */
export function statusTone(status?: string | null): BadgeTone {
  const value = (status ?? "").toUpperCase();
  if (DANGER.test(value)) return "danger";
  if (PARTLY.test(value)) return "warning";
  // Before SUCCESS, which would match the "ACTIVE" in INACTIVE.
  if (NEUTRAL.test(value)) return "default";
  if (SUCCESS.test(value)) return "success";
  if (INFO.test(value)) return "info";
  return "warning";
}
