import { redirect } from "next/navigation";

/** Suppliers are called Distributors now; this keeps old links and bookmarks (and `?new=1`) working. */
export default async function Suppliers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(query ? `/masters/distributors?${query}` : "/masters/distributors");
}
