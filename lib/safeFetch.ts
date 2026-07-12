import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { BlockedUrlError, PublicError } from "./errors";
import { assertPublicHttpUrl, isBlockedIp } from "./urlPolicy";

/**
 * SSRF-safe fetch for URLs we did not author (user-pasted pages, model/search
 * suggested links). This is the ONLY sanctioned way to fetch such a URL
 * server-side. Guarantees, on top of lib/urlPolicy's static checks:
 *
 * - DNS-pinned validation: every address a hostname resolves to is checked
 *   against the IP blocklist inside the socket's own lookup step, so the
 *   validated address IS the connected address (no DNS-rebinding TOCTOU).
 *   A host resolving to ANY blocked address is rejected outright.
 * - Redirects are never followed blindly: each hop is re-validated through
 *   the full URL policy + pinned DNS, capped at `maxRedirects`.
 * - Bounded response: hard timeout for the whole operation, response body
 *   truncated at `maxBytes`, optional Content-Type allowlist.
 *
 * Operator-configured API endpoints (Firecrawl/Tavily/Polar, set via env by
 * the deployer, not reachable from user input) intentionally keep using
 * lib/fetch.ts — they may legitimately point at private infrastructure.
 */

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** Whole-operation deadline across all redirect hops. Default 15s. */
  timeoutMs?: number;
  /** Redirect hops to follow (each fully re-validated). Default 3. */
  maxRedirects?: number;
  /** Body bytes to keep; the connection is dropped past this. Default 2MB. */
  maxBytes?: number;
  /** If set and the response HAS a Content-Type, it must match this. */
  contentTypes?: RegExp;
  /** TEST-ONLY seams — never set these in production code. */
  lookupFn?: typeof dnsLookup;
  isAllowedIp?: (ip: string) => boolean;
  allowNonStandardPorts?: boolean;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  body: string;
  truncated: boolean;
  finalUrl: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: unknown,
  family?: number
) => void;

/**
 * A dns.lookup wrapper that validates every resolved address before the
 * socket may connect. Because it runs inside the connection attempt itself,
 * a hostname can't pass validation with one address and connect to another.
 */
function makeValidatingLookup(
  lookupFn: typeof dnsLookup,
  isAllowedIp: (ip: string) => boolean
) {
  return (hostname: string, options: unknown, callback?: unknown): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCallback;
    const opts = (typeof options === "object" && options !== null ? options : {}) as {
      all?: boolean;
      family?: number;
      hints?: number;
    };
    lookupFn(
      hostname,
      { family: opts.family ?? 0, hints: opts.hints, all: true },
      (err, addresses) => {
        if (err) return cb(err);
        const list = Array.isArray(addresses)
          ? addresses
          : [{ address: String(addresses), family: 4 }];
        if (list.length === 0) {
          return cb(new PublicError("Couldn't resolve that host.", 502));
        }
        for (const a of list) {
          if (!isAllowedIp(String(a.address))) {
            return cb(
              new BlockedUrlError(
                "This URL resolves to a private or internal address, which isn't allowed."
              )
            );
          }
        }
        if (opts.all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      }
    );
  };
}

interface HopResult {
  status: number;
  statusText: string;
  contentType: string;
  redirectTo: string | null;
  body: string;
  truncated: boolean;
}

function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "method" | "maxBytes">> &
    Pick<SafeFetchOptions, "headers" | "contentTypes">,
  lookup: ReturnType<typeof makeValidatingLookup>,
  remainingMs: number
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: opts.method,
        headers: {
          accept: "*/*",
          ...opts.headers,
          "accept-encoding": "identity",
          connection: "close",
        },
        lookup: lookup as never,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] || "");
        const location = res.headers.location;

        if (REDIRECT_STATUSES.has(status) && typeof location === "string") {
          res.resume();
          return done(() =>
            resolve({
              status,
              statusText: res.statusMessage || "",
              contentType,
              redirectTo: location.slice(0, 4096),
              body: "",
              truncated: false,
            })
          );
        }

        if (opts.contentTypes && contentType && !opts.contentTypes.test(contentType)) {
          req.destroy();
          return done(() =>
            reject(new PublicError("That URL isn't a readable web page.", 502))
          );
        }

        if (opts.method === "HEAD") {
          res.resume();
          return done(() =>
            resolve({
              status,
              statusText: res.statusMessage || "",
              contentType,
              redirectTo: null,
              body: "",
              truncated: false,
            })
          );
        }

        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.length;
          chunks.push(chunk);
          if (received >= opts.maxBytes) {
            truncated = received > opts.maxBytes;
            const body = Buffer.concat(chunks).subarray(0, opts.maxBytes).toString("utf8");
            done(() =>
              resolve({
                status,
                statusText: res.statusMessage || "",
                contentType,
                redirectTo: null,
                body,
                truncated,
              })
            );
            req.destroy(); // stop pulling bytes we won't keep
          }
        });
        res.on("end", () =>
          done(() =>
            resolve({
              status,
              statusText: res.statusMessage || "",
              contentType,
              redirectTo: null,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
            })
          )
        );
        res.on("error", (err) => done(() => reject(err)));
      }
    );

    const timer = setTimeout(() => {
      done(() => reject(new PublicError("Timed out fetching that URL.", 504)));
      req.destroy();
    }, remainingMs);

    req.on("error", (err) => done(() => reject(err)));
    req.end();
  });
}

/** Fetch a non-trusted URL with the full SSRF policy enforced. */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const lookup = makeValidatingLookup(
    options.lookupFn ?? dnsLookup,
    options.isAllowedIp ?? ((ip) => !isBlockedIp(ip))
  );
  const policyOpts = { allowNonStandardPorts: options.allowNonStandardPorts };

  const deadline = Date.now() + timeoutMs;
  let url = assertPublicHttpUrl(rawUrl, policyOpts);

  for (let hop = 0; ; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new PublicError("Timed out fetching that URL.", 504);

    const res = await requestOnce(
      url,
      { method, maxBytes, headers: options.headers, contentTypes: options.contentTypes },
      lookup,
      remaining
    );

    if (res.redirectTo !== null) {
      if (hop >= maxRedirects) {
        throw new PublicError("That URL redirects too many times.", 502);
      }
      let next: URL;
      try {
        next = new URL(res.redirectTo, url);
      } catch {
        throw new PublicError("That URL redirects somewhere invalid.", 502);
      }
      url = assertPublicHttpUrl(next.toString(), policyOpts); // re-validate every hop
      continue;
    }

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      contentType: res.contentType,
      body: res.body,
      truncated: res.truncated,
      finalUrl: url.toString(),
    };
  }
}
