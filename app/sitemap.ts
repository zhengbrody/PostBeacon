import type { MetadataRoute } from "next";

// Makes the reference in robots.ts real. /app is intentionally excluded (disallowed there).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://postbeacon.app";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/subprocessors`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
