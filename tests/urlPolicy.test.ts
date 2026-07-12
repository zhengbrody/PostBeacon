import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  isBlockedIp,
  isPublicHttpUrl,
  isSafeExternalHref,
} from "@/lib/urlPolicy";
import { BlockedUrlError, PublicError } from "@/lib/errors";

const BLOCKED: [string, string][] = [
  // wrong scheme
  ["ftp://example.com/", "ftp"],
  ["javascript:alert(1)", "javascript"],
  ["file:///etc/passwd", "file"],
  ["data:text/html,hi", "data"],
  // localhost in every spelling
  ["http://localhost/", "localhost"],
  ["http://LOCALHOST/", "localhost uppercase"],
  ["https://sub.localhost/", "*.localhost"],
  // loopback / private / special IPv4
  ["http://127.0.0.1/", "loopback"],
  ["http://127.8.8.8/", "loopback /8"],
  ["http://0.0.0.0/", "this-network"],
  ["http://10.1.2.3/", "private 10/8"],
  ["http://172.16.0.1/", "private 172.16/12 low"],
  ["http://172.31.255.255/", "private 172.16/12 high"],
  ["http://192.168.1.1/", "private 192.168/16"],
  ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
  ["http://169.254.170.2/", "ECS task metadata"],
  ["http://100.100.100.200/", "Alibaba metadata (CGNAT)"],
  ["http://100.64.0.1/", "CGNAT low"],
  ["http://192.0.0.8/", "IETF special"],
  ["http://192.0.2.1/", "TEST-NET-1"],
  ["http://192.88.99.1/", "6to4 relay"],
  ["http://198.18.0.1/", "benchmarking"],
  ["http://198.51.100.7/", "TEST-NET-2"],
  ["http://203.0.113.9/", "TEST-NET-3"],
  ["http://224.0.0.1/", "multicast"],
  ["http://240.0.0.1/", "reserved"],
  ["http://255.255.255.255/", "broadcast"],
  // non-dotted IPv4 forms (WHATWG URL canonicalizes them)
  ["http://2130706433/", "decimal loopback"],
  ["http://0x7f000001/", "hex loopback"],
  ["http://017700000001/", "octal loopback"],
  ["http://0x7f.1/", "mixed hex loopback"],
  // IPv6 (allowlist: only global unicast 2000::/3 minus carve-outs)
  ["http://[::1]/", "v6 loopback"],
  ["http://[::]/", "v6 unspecified"],
  ["http://[fd12:3456::1]/", "v6 ULA"],
  ["http://[fe80::1]/", "v6 link-local"],
  ["http://[ff02::1]/", "v6 multicast"],
  ["http://[::ffff:127.0.0.1]/", "v4-mapped loopback"],
  ["http://[::ffff:10.0.0.1]/", "v4-mapped private"],
  ["http://[64:ff9b::a9fe:a9fe]/", "NAT64 metadata"],
  ["http://[100::1]/", "v6 discard"],
  ["http://[2001:db8::1]/", "v6 documentation"],
  ["http://[2002:c0a8:101::1]/", "6to4"],
  ["http://[2001:0:abcd::1]/", "Teredo"],
  // ports & credentials
  ["https://example.com:8443/", "non-standard port"],
  ["http://example.com:3000/", "non-standard port"],
  ["https://user:pass@example.com/", "embedded credentials"],
  // reserved / internal name spaces
  ["https://foo.internal/", ".internal"],
  ["https://metadata.google.internal/", "GCP metadata host"],
  ["https://foo.local/", ".local"],
  ["https://bar.test/", ".test"],
  ["https://x.home.arpa/", ".home.arpa"],
  ["https://y.invalid/", ".invalid"],
  ["https://z.onion/", ".onion"],
  ["https://intranet/", "single-label host"],
  // malformed
  ["not a url", "unparseable"],
  ["https://999.1.1.1/", "invalid IPv4 host"],
];

const ALLOWED: string[] = [
  "https://example.com/",
  "http://example.com",
  "https://sub.deep.example.co.uk/path?q=1",
  "https://example.com:443/",
  "http://example.com:80/",
  "https://example.com./", // trailing dot normalizes away
  "http://8.8.8.8/",
  "https://[2606:4700:4700::1111]/",
  "https://172.15.0.1/", // just outside 172.16/12
  "https://172.32.0.1/",
  "https://100.63.0.1/", // just outside CGNAT
  "https://100.128.0.1/",
  "https://192.0.3.1/", // not TEST-NET-1
  "https://198.20.0.1/", // not benchmarking
  "https://223.255.255.255/", // last unicast before multicast
];

describe("assertPublicHttpUrl", () => {
  it.each(BLOCKED)("rejects %s (%s)", (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(PublicError);
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  it.each(ALLOWED.map((u) => [u]))("allows %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).not.toThrow();
    expect(isPublicHttpUrl(url)).toBe(true);
  });

  it("throws BlockedUrlError (not just PublicError) for policy rejections", () => {
    expect(() => assertPublicHttpUrl("http://169.254.169.254/")).toThrow(BlockedUrlError);
    expect(() => assertPublicHttpUrl("http://localhost/")).toThrow(BlockedUrlError);
  });

  it("never echoes the URL in the error message", () => {
    try {
      assertPublicHttpUrl("http://10.9.8.7/secret-path");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("10.9.8.7");
      expect((err as Error).message).not.toContain("secret-path");
    }
  });

  it("allows non-standard ports only via the test-only escape hatch", () => {
    expect(() =>
      assertPublicHttpUrl("http://example.com:3000/", { allowNonStandardPorts: true })
    ).not.toThrow();
  });
});

describe("isBlockedIp", () => {
  it("classifies raw addresses (as returned by DNS)", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("::ffff:192.168.0.1")).toBe(true);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("garbage")).toBe(true); // unparseable fails closed
  });
});

describe("isSafeExternalHref", () => {
  it("accepts only absolute http(s)", () => {
    expect(isSafeExternalHref("https://reddit.com/r/selfhosted")).toBe(true);
    expect(isSafeExternalHref("http://news.ycombinator.com")).toBe(true);
    expect(isSafeExternalHref("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalHref("data:text/html,x")).toBe(false);
    expect(isSafeExternalHref("vbscript:x")).toBe(false);
    expect(isSafeExternalHref("//evil.com/x")).toBe(false);
    expect(isSafeExternalHref("/relative/path")).toBe(false);
    expect(isSafeExternalHref("mailto:a@b.c")).toBe(false);
    expect(isSafeExternalHref("")).toBe(false);
  });
});
