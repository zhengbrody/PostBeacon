import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Operator-specified origins only; never take a target from product/user content. */
export function releaseOrigin(raw) {
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const hosted =
    ["postbeacon.app", "www.postbeacon.app"].includes(url.hostname) ||
    url.hostname.endsWith(".vercel.app");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (!local && !hosted) ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new Error(
      "Choose a credential-free PostBeacon/Vercel HTTPS origin or a local HTTP origin."
    );
  }
  return url.origin;
}

const PROBES = [
  { id: "workspace-page", path: "/app", method: "GET", expected: [200] },
  {
    id: "buffer-connections-sign-in-gate",
    path: "/api/buffer/connections",
    method: "GET",
    expected: [401],
  },
  {
    id: "buffer-deliveries-sign-in-gate",
    path: "/api/buffer/deliveries",
    method: "GET",
    expected: [401],
  },
  {
    id: "buffer-write-cross-origin-gate",
    path: "/api/buffer/deliveries",
    method: "POST",
    expected: [403],
    foreignOrigin: true,
  },
  {
    id: "trial-privacy-notice",
    path: "/privacy",
    method: "GET",
    expected: [200],
    marker: "Explicit trial research",
  },
  {
    id: "research-sign-in-gate",
    path: "/api/opportunities",
    method: "POST",
    expected: [401],
  },
  {
    id: "research-cross-origin-gate",
    path: "/api/opportunities",
    method: "POST",
    expected: [403],
    foreignOrigin: true,
  },
  {
    id: "account-export-sign-in-gate",
    path: "/api/account/export",
    method: "GET",
    expected: [401],
  },
  // Disabled reporting (503) is also closed to the public, not proof it is configured.
  {
    id: "operator-metrics-not-public",
    path: "/api/metrics",
    method: "GET",
    expected: [401, 503],
  },
];

async function containsMarker(response, marker) {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text.includes(marker);
      size += value.byteLength;
      if (size > 200_000) return false;
      text += decoder.decode(value, { stream: true });
      if (text.includes(marker)) return true;
    }
  } finally {
    await reader.cancel();
  }
}

/**
 * @param {{ baseUrl: string, fetchFn?: typeof fetch }} options
 * Signed-out smoke only. No bearer, cookies, submitted sources or model requests.
 */
export async function runReleaseSmoke({ baseUrl, fetchFn = fetch }) {
  const origin = releaseOrigin(baseUrl);
  const checks = [];
  for (const probe of PROBES) {
    const headers = { Origin: probe.foreignOrigin ? "https://untrusted.example" : origin };
    if (probe.method === "POST") headers["Content-Type"] = "application/json";
    try {
      const response = await fetchFn(`${origin}${probe.path}`, {
        method: probe.method,
        headers,
        ...(probe.method === "POST" ? { body: "{}" } : {}),
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const markerFound = probe.marker
        ? await containsMarker(response, probe.marker)
        : undefined;
      if (!probe.marker && response.body) await response.body.cancel();
      checks.push({
        id: probe.id,
        expectedStatuses: probe.expected,
        actualStatus: response.status,
        ...(probe.marker ? { requiredNoticeFound: markerFound } : {}),
        passed: probe.expected.includes(response.status) && (markerFound ?? true),
      });
    } catch {
      // Never print upstream error text, page bodies, headers or credentials.
      checks.push({
        id: probe.id,
        expectedStatuses: probe.expected,
        actualStatus: null,
        passed: false,
        error: "Request or bounded response check failed.",
      });
    }
  }
  return {
    origin,
    checkedAt: new Date().toISOString(),
    scope:
      "Signed-out HTTP smoke only; no model, project write, account deletion or authenticated session.",
    smokePassed: checks.every((check) => check.passed),
    productionAccepted: false,
    deploymentRevision: "not verified by this probe",
    checks,
    stillRequired: [
      "Real OpenAI research and explicit DeepSeek research",
      "Signed-in trial review, draft edits, confirm and manual-publish recording",
      "Cloud save, refresh, export and dedicated test-project deletion",
      "Two-account isolation and provider failure handling",
      "Real activation, feedback and repeat-experiment retention",
      "Separately authorized real Buffer OAuth and exact-copy/account/time scheduling acceptance; signed-out gates never prove publication",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error(
      "Usage: npm run release:smoke -- https://postbeacon.app (or a local origin)"
    );
    process.exitCode = 2;
  } else {
    try {
      const report = await runReleaseSmoke({ baseUrl: args[0] });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.smokePassed ? 0 : 1;
    } catch {
      console.error("Invalid release target. No probes were sent.");
      process.exitCode = 2;
    }
  }
}
