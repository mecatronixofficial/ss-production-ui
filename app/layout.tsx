import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND, SITE_URL, SOCIAL_IMAGE } from "@/lib/brand";
import { ToastViewport } from "@/components/toast-viewport";
import { ConfirmHost } from "@/components/ui/confirm-host";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: [
    BRAND.name,
    "textile ERP",
    "garment production",
    "yarn to fabric",
    "knitting",
    "dyeing",
    "compacting",
    "quality control",
    "production management",
  ],
  authors: [{ name: BRAND.name }],
  creator: BRAND.name,
  publisher: BRAND.name,
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "/",
    siteName: BRAND.name,
    title: BRAND.name,
    description: BRAND.description,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary",
    title: BRAND.name,
    description: BRAND.description,
    images: [SOCIAL_IMAGE],
  },
  // Internal ERP pages stay out of search engines; the public sign-in page opts back in.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {children}
        <ToastViewport />
        <ConfirmHost />
      </body>
    </html>
  );
}
