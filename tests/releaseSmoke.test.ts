import { describe, expect, it, vi } from "vitest";
import { releaseOrigin, runReleaseSmoke } from "../scripts/release-smoke.mjs";

function successfulFetch() {
  return vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    const origin = new Headers(options?.headers).get("origin");
    if (path === "/privacy")
      return new Response("<p>Explicit trial research sends short excerpts.</p>");
    if (path === "/app") return new Response("Public shell");
    if (path === "/api/opportunities" && origin === "https://untrusted.example")
      return new Response("Denied", { status: 403 });
    return new Response("Denied", { status: 401 });
  });
}

describe("release acceptance cannot be confused with a mock or public smoke", () => {
  it("accepts only credential-free operator PostBeacon, Vercel or local origins", () => {
    expect(releaseOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(releaseOrigin("https://postbeacon-preview.vercel.app")).toBe(
      "https://postbeacon-preview.vercel.app"
    );
    for (const url of [
      "https://user:secret@postbeacon.app",
      "https://postbeacon.app?token=secret",
      "https://postbeacon.app/app",
      "http://postbeacon.app",
      "https://evil.example",
      "https://postbeacon.app.evil.example",
      "file:///tmp/app",
    ])
      expect(() => releaseOrigin(url)).toThrow();
  });
  it("never sends cookies, bearer tokens, identities, sources or a deletion request", async () => {
    const fetchFn = successfulFetch();
    const report = await runReleaseSmoke({ baseUrl: "https://postbeacon.app", fetchFn });
    expect(report.smokePassed).toBe(true);
    expect(report.productionAccepted).toBe(false);
    expect(report.stillRequired).toHaveLength(5);
    expect(report.deploymentRevision).toContain("not verified");
    for (const [url, options] of fetchFn.mock.calls) {
      expect(String(url)).not.toContain("/delete");
      expect(options).toMatchObject({
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
      });
      expect(new Headers(options?.headers).has("authorization")).toBe(false);
      expect(options?.body).toBe(options?.method === "POST" ? "{}" : undefined);
    }
  });
  it("marks a missing research route as not passed, even if the rest of the site works", async () => {
    const original = successfulFetch();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation((url, options) =>
        String(url).includes("/opportunities")
          ? Promise.resolve(new Response("Missing", { status: 404 }))
          : original(url, options)
      );
    const report = await runReleaseSmoke({ baseUrl: "https://postbeacon.app", fetchFn });
    expect(report.smokePassed).toBe(false);
    expect(report.checks.filter((check) => check.actualStatus === 404)).toHaveLength(2);
  });
  it("does not treat keyless research 503 as ready for the signed-in beta", async () => {
    const original = successfulFetch();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation((url, options) =>
        String(url).includes("/opportunities")
          ? Promise.resolve(new Response("Disabled", { status: 503 }))
          : original(url, options)
      );
    expect(
      (await runReleaseSmoke({ baseUrl: "http://localhost:3100", fetchFn })).smokePassed
    ).toBe(false);
  });
  it("does not follow redirects or quietly accept a login redirect as the workspace", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { location: "https://untrusted.example" },
      })
    );
    const report = await runReleaseSmoke({ baseUrl: "https://postbeacon.app", fetchFn });
    expect(report.smokePassed).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });
  it("requires the actual new privacy notice rather than any successful privacy page", async () => {
    const original = successfulFetch();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation((url, options) =>
        String(url).endsWith("/privacy")
          ? Promise.resolve(new Response("Old privacy page"))
          : original(url, options)
      );
    const report = await runReleaseSmoke({ baseUrl: "https://postbeacon.app", fetchFn });
    expect(report.checks.find((check) => check.id === "trial-privacy-notice")?.passed).toBe(
      false
    );
  });
  it("bounded errors never echo fetched content or upstream errors", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private-user@example.com token=SECRET"));
    const report = await runReleaseSmoke({ baseUrl: "https://postbeacon.app", fetchFn });
    expect(report.smokePassed).toBe(false);
    expect(JSON.stringify(report)).not.toContain("SECRET");
    expect(JSON.stringify(report)).not.toContain("private-user");
  });
  it("rejects an oversized privacy body without leaking its content", async () => {
    const original = successfulFetch();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation((url, options) =>
        String(url).endsWith("/privacy")
          ? Promise.resolve(new Response("x".repeat(200_001) + "Explicit trial research"))
          : original(url, options)
      );
    const report = await runReleaseSmoke({ baseUrl: "https://postbeacon.app", fetchFn });
    expect(report.smokePassed).toBe(false);
  });
});
