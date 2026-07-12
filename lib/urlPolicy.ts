import { BlockedUrlError, PublicError } from "./errors";

/**
 * URL policy for every URL we did not author ourselves: user-pasted product
 * pages (scrape), model/search-suggested community links (discovery), URLs
 * forwarded to the headless renderer (Firecrawl input), and external hrefs
 * rendered in the UI.
 *
 * Pure string/IP logic — no DNS, no node imports — so it runs in both server
 * and client bundles. DNS-time enforcement (anti-rebinding) lives in
 * lib/safeFetch.ts, which re-checks every resolved address with isBlockedIp
 * at connection time.
 */

// ---------------------------------------------------------------------------
// IPv4

/** Strict dotted-quad parse. WHATWG URL already canonicalizes decimal/hex/octal
 *  hosts (http://2130706433/ → 127.0.0.1), so this sees only canonical forms. */
function parseIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** Special-purpose IPv4 ranges that must never be fetched server-side. */
function ipv4Blocked(ip: number[]): boolean {
  const [a, b, c] = ip;
  if (a === 0 || a === 10 || a === 127) return true; // "this" net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (incl. Alibaba metadata 100.100.100.200)
  if (a === 169 && b === 254) return true; // link-local (AWS/GCP/Azure metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF special + TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

// ---------------------------------------------------------------------------
// IPv6

/** Parse an IPv6 literal (no brackets) into 16 bytes; null if malformed. */
function parseIpv6(host: string): number[] | null {
  if (host.includes("%")) return null; // zone index — never legitimate here
  let h = host;
  let tailV4: number[] | null = null;
  if (h.includes(".")) {
    const idx = h.lastIndexOf(":");
    tailV4 = parseIpv4(h.slice(idx + 1));
    if (!tailV4) return null;
    h = h.slice(0, idx + 1) + "0:0"; // placeholder for the last 2 groups
  }
  const dbl = h.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(":") : [];
  const tail = dbl.length === 2 && dbl[1] ? dbl[1].split(":") : [];
  const groups =
    dbl.length === 2
      ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail]
      : head;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  if (tailV4) bytes.splice(12, 4, ...tailV4);
  return bytes;
}

/**
 * IPv6 is allowlisted: only global unicast (2000::/3) may be fetched, minus
 * documentation/tunnel carve-outs. Everything else — loopback, unspecified,
 * v4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96), ULA (fc00::/7), link/site
 * local, multicast, discard (100::/64) — is blocked by not being in 2000::/3.
 */
function ipv6Blocked(b: number[]): boolean {
  if ((b[0] & 0xe0) !== 0x20) return true; // not global unicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 docs
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32 Teredo
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 2002::/16 6to4
  return false;
}

// ---------------------------------------------------------------------------
// Combined policy

/** True if this IP (v4 or v6 text form) must not be fetched. Unparseable → blocked. */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return ipv4Blocked(v4);
  if (ip.includes(":")) {
    const v6 = parseIpv6(ip);
    return v6 ? ipv6Blocked(v6) : true;
  }
  return true;
}

/** Reserved / internal-only name suffixes that must never resolve publicly. */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal", // covers metadata.google.internal
  ".home.arpa",
  ".invalid",
  ".test",
  ".onion",
];

/** Hostname-level (pre-DNS) rejection reasons; null = pass to DNS validation. */
function hostnameBlocked(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase().replace(/\.+$/, "");
  if (!host) return true;
  if (host === "localhost") return true;
  if (!host.includes(".")) return true; // single-label = intranet-style name
  return BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

const BLOCKED_MSG =
  "This URL points at a private, internal, or otherwise disallowed address.";

export interface UrlPolicyOptions {
  /** TEST-ONLY seam: lets tests target a local server on an ephemeral port.
   *  Production callers must never set this. */
  allowNonStandardPorts?: boolean;
}

/**
 * Validate that a URL is a plain public http(s) target. Throws PublicError /
 * BlockedUrlError with a user-safe message (never echoing the URL) otherwise.
 * Applied to the initial URL and re-applied to every redirect hop.
 */
export function assertPublicHttpUrl(raw: string, opts: UrlPolicyOptions = {}): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PublicError("That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new BlockedUrlError("Only http(s) URLs are supported.");
  }
  if (u.username || u.password) {
    throw new BlockedUrlError("URLs with embedded credentials aren't allowed.");
  }
  if (!opts.allowNonStandardPorts && u.port && u.port !== "80" && u.port !== "443") {
    throw new BlockedUrlError("Only standard http(s) ports are allowed.");
  }

  let host = u.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host.includes(":")) {
    // IPv6 literal
    if (isBlockedIp(host)) throw new BlockedUrlError(BLOCKED_MSG);
    return u;
  }
  const v4 = parseIpv4(host);
  if (v4) {
    if (ipv4Blocked(v4)) throw new BlockedUrlError(BLOCKED_MSG);
    return u;
  }
  if (hostnameBlocked(host)) throw new BlockedUrlError(BLOCKED_MSG);
  return u;
}

/** Non-throwing form, for filtering lists (e.g. discovered channels). */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    assertPublicHttpUrl(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a string is safe to render as an external <a href>: absolute
 * http(s) only — kills javascript:, data:, vbscript:, protocol-relative, etc.
 * (No DNS/IP policy here; it's a navigation the user chooses, not a server fetch.)
 */
export function isSafeExternalHref(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
