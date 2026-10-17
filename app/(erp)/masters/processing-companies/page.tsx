import { redirect } from "next/navigation";

/** Processing Companies became Mill Details; this keeps old links and bookmarks working. */
export default async function ProcessingCompanies({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(query ? `/masters/mills?${query}` : "/masters/mills");
}
