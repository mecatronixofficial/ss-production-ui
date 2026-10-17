export const BRAND = {
  name: "SS Clothing Mills",
  tagline: "Premium Fabrics. Timeless Quality.",
  description:
    "SS Clothing Mills production ERP — yarn purchase from distributors, knitting, dyeing, compacting, stock and delivery in one place.",
  logo: "/logo.jpg",
  themeColor: "#1b3c55",
} as const;

/** Public origin of the app, used for canonical URLs, Open Graph and the sitemap. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

/** Shared social-card image. Next.js replaces (not merges) `openGraph`/`twitter` per route, so reuse it. */
export const SOCIAL_IMAGE = { url: BRAND.logo, width: 1254, height: 1254, alt: BRAND.name };
