import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

// Everything else sits behind sign-in, so the sign-in page is the only public URL.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 1 }];
}
