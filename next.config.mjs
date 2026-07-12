const dev = process.env.NODE_ENV === "development";

// Supabase is the only cross-origin service the browser talks to (auth + saves).
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : "";
  } catch {
    return "";
  }
})();
const connectSrc = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  // Self-hosted / non-*.supabase.co Supabase deployments:
  ...(supabaseOrigin && !supabaseOrigin.endsWith(".supabase.co")
    ? [supabaseOrigin, supabaseOrigin.replace(/^http/, "ws")]
    : []),
].join(" ");

// Next.js injects inline bootstrap scripts (hence 'unsafe-inline'); dev mode
// additionally needs eval (react-refresh) and the Vercel Analytics debug script.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
