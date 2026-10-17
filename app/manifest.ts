import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} ERP`,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f7f8",
    theme_color: BRAND.themeColor,
    icons: [
      { src: "/icon.png", type: "image/png", sizes: "64x64" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    ],
  };
}
