import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

// Internal ERP: only the public sign-in page may be crawled.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/login", disallow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
