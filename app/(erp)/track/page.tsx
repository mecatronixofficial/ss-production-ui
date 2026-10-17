import { redirect } from "next/navigation";

/** Track was renamed Production; this keeps old links and bookmarks (including `?code=` and `?new=1`) working. */
export default async function Track({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(query ? `/production?${query}` : "/production");
}
