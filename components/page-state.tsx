import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

/** Full-page error with a retry action, used when a page's initial data fails to load. */
export function ErrorState({
  title = "Could not load this page",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="mx-auto mt-12 max-w-lg p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertTriangle size={22} />
      </div>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      {message && <p className="mt-1 text-sm text-gray-500">{message}</p>}
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          <RefreshCw size={15} /> Retry
        </Button>
      )}
    </Card>
  );
}

/** Page heading used by list/master pages. */
export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-bold md:text-xl">{title}</h2>
          {description && <p className="text-xs text-gray-500 md:text-sm">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
