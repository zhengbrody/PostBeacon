import type { MetadataRoute } from "next";

// Makes the reference in robots.ts real. /app is intentionally excluded (disallowed there).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://postbeacon.app";
  return [{ url: `${base}/`, changeFrequency: "weekly", priority: 1 }];
}
