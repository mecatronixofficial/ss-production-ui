"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/page-state";

export default function ErpError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <ErrorState
        title="Something went wrong on this page"
        message={error.message || "An unexpected error occurred."}
        onRetry={reset}
      />
      <p className="mt-4 text-center text-sm">
        <Link href="/" className="font-semibold text-primary hover:underline">
          Go to home
        </Link>
      </p>
    </div>
  );
}
