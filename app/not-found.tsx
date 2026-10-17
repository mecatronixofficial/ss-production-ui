import Link from "next/link";
import { Compass } from "lucide-react";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Compass size={26} />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[.25em] text-[#a77a24]">Error 404</p>
        <h1 className="mt-2 text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          The page you are looking for doesn’t exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-[#12283a]"
        >
          Back to {BRAND.name}
        </Link>
      </div>
    </main>
  );
}
