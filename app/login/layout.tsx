import type { Metadata } from "next";
import { BRAND, SOCIAL_IMAGE } from "@/lib/brand";

const description = `Sign in to the ${BRAND.name} production ERP. ${BRAND.tagline}`;

export const metadata: Metadata = {
  title: "Sign in",
  description,
  alternates: { canonical: "/login" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "/login",
    siteName: BRAND.name,
    title: `Sign in · ${BRAND.name}`,
    description,
    images: [SOCIAL_IMAGE],
  },
  twitter: { card: "summary", title: `Sign in · ${BRAND.name}`, description, images: [SOCIAL_IMAGE] },
  // The only public page — let search engines index it so the brand name finds the portal.
  robots: { index: true, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
