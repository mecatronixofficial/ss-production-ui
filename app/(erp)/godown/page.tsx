import { redirect } from "next/navigation";

/** The Godown page became Warehouses; this keeps old links and bookmarks (including their filters) working. */
export default async function Godown({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(query ? `/warehouses?${query}` : "/warehouses");
}
