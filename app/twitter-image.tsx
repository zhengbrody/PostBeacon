// Reuse the OpenGraph card for the Twitter summary_large_image — one implementation.
// `runtime` must be declared literally here: Next statically analyzes segment
// config and can't see through a re-export (it warns on every build otherwise).
export const runtime = "nodejs";
export { default, alt, size, contentType } from "./opengraph-image";
