import { redirect } from "next/navigation";

/** The Textiles list lives on the Distributors page (its Textiles tab); `?new=1` and `?edit=<id>` carry over. */
export default async function Textiles({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams({ tab: "textiles" });
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string" && key !== "tab") params.set(key, value);
  redirect(`/masters/distributors?${params.toString()}`);
}
