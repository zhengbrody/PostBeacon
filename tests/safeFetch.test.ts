import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch, type SafeFetchOptions } from "@/lib/safeFetch";
import { BlockedUrlError, PublicError } from "@/lib/errors";

/**
 * Exercises the real transport against a local server. Production policy
 * blocks loopback, so the tests use the documented TEST-ONLY seams: a fake
 * DNS lookup that maps a public-looking hostname to 127.0.0.1, and an
 * isAllowedIp that permits exactly that address. Everything else — hop
 * revalidation, redirect caps, size/type/time limits — runs the real code.
 */

let server: http.Server;
let port: number;

/** dns.lookup-shaped fake: every hostname resolves to the local test server. */
const localLookup = ((hostname: string, options: unknown, cb: unknown) => {
  const callback = (typeof options === "function" ? options : cb) as (
    err: null,
    addresses: { address: string; family: number }[]
  ) => void;
  callback(null, [{ address: "127.0.0.1", family: 4 }]);
}) as unknown as SafeFetchOptions["lookupFn"];

const seams: SafeFetchOptions = {
  lookupFn: localLookup,
  isAllowedIp: (ip) => ip === "127.0.0.1",
  allowNonStandardPorts: true,
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>hello</body></html>");
    } else if (url === "/redir") {
      res.writeHead(302, { location: "/ok" });
      res.end();
    } else if (url === "/absolute-redir") {
      res.writeHead(301, { location: `http://app.example:${port}/ok` });
      res.end();
    } else if (url === "/meta") {
      // A malicious page bouncing the scraper into cloud metadata.
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    } else if (url === "/local-redir") {
      res.writeHead(302, { location: "http://localhost/admin" });
      res.end();
    } else if (url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
    } else if (url === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(100_000));
    } else if (url === "/bin") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from([1, 2, 3]));
    } else if (url === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("late");
      }, 500);
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("nope");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const base = () => `http://app.example:${port}`;

describe("safeFetch", () => {
  it("fetches a page and reports the final URL", async () => {
    const res = await safeFetch(`${base()}/ok`, seams);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toContain("hello");
    expect(res.truncated).toBe(false);
    expect(res.finalUrl).toBe(`${base()}/ok`);
  });

  it("follows validated redirects (relative and absolute)", async () => {
    const rel = await safeFetch(`${base()}/redir`, seams);
    expect(rel.status).toBe(200);
    expect(rel.finalUrl).toBe(`${base()}/ok`);

    const abs = await safeFetch(`${base()}/absolute-redir`, seams);
    expect(abs.body).toContain("hello");
  });

  it("blocks a redirect into cloud metadata", async () => {
    await expect(safeFetch(`${base()}/meta`, seams)).rejects.toThrow(BlockedUrlError);
  });

  it("blocks a redirect to localhost", async () => {
    await expect(safeFetch(`${base()}/local-redir`, seams)).rejects.toThrow(
      BlockedUrlError
    );
  });

  it("gives up after maxRedirects hops", async () => {
    await expect(
      safeFetch(`${base()}/loop`, { ...seams, maxRedirects: 2 })
    ).rejects.toThrow(/redirects too many times/);
  });

  it("truncates the body at maxBytes", async () => {
    const res = await safeFetch(`${base()}/big`, { ...seams, maxBytes: 10_000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(10_000);
  });

  it("rejects disallowed content types", async () => {
    await expect(
      safeFetch(`${base()}/bin`, { ...seams, contentTypes: /^text\/html/ })
    ).rejects.toThrow(PublicError);
  });

  it("enforces the overall timeout", async () => {
    await expect(
      safeFetch(`${base()}/slow`, { ...seams, timeoutMs: 150 })
    ).rejects.toThrow(/Timed out/);
  });

  it("supports HEAD without reading a body", async () => {
    const res = await safeFetch(`${base()}/ok`, { ...seams, method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });

  it("rejects at connect time when DNS resolves to a private address (rebinding)", async () => {
    // Real IP policy, fake DNS: the hostname looks public but resolves privately.
    const evilLookup = ((_h: string, options: unknown, cb: unknown) => {
      const callback = (typeof options === "function" ? options : cb) as (
        err: null,
        addresses: { address: string; family: number }[]
      ) => void;
      callback(null, [{ address: "10.0.0.1", family: 4 }]);
    }) as unknown as SafeFetchOptions["lookupFn"];
    await expect(
      safeFetch("http://evil.example/", { lookupFn: evilLookup })
    ).rejects.toThrow(BlockedUrlError);
  });

  it("rejects when ANY resolved address is private (multi-A rebinding)", async () => {
    const mixedLookup = ((_h: string, options: unknown, cb: unknown) => {
      const callback = (typeof options === "function" ? options : cb) as (
        err: null,
        addresses: { address: string; family: number }[]
      ) => void;
      callback(null, [
        { address: "93.184.216.34", family: 4 }, // public
        { address: "169.254.169.254", family: 4 }, // metadata
      ]);
    }) as unknown as SafeFetchOptions["lookupFn"];
    await expect(
      safeFetch("http://mixed.example/", { lookupFn: mixedLookup })
    ).rejects.toThrow(BlockedUrlError);
  });

  it("rejects blocked initial URLs before any network activity", async () => {
    await expect(safeFetch("http://127.0.0.1/", {})).rejects.toThrow(BlockedUrlError);
    await expect(safeFetch("http://[::1]/", {})).rejects.toThrow(BlockedUrlError);
    await expect(safeFetch("ftp://example.com/", {})).rejects.toThrow(PublicError);
  });
});
