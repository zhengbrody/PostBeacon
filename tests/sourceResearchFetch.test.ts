import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({
  fetch: vi.fn(),
  render: vi.fn(),
  configured: vi.fn(() => true),
}));
vi.mock("@/lib/safeFetch", () => ({ safeFetch: seams.fetch }));
vi.mock("@/lib/render", () => ({
  renderUrl: seams.render,
  renderConfigured: seams.configured,
}));
import { scrapeStaticSource } from "@/lib/scrape";
beforeEach(() => {
  vi.clearAllMocks();
  seams.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    body: "<html><body><div id='app'></div></body></html>",
    finalUrl: "https://example.org/need",
    truncated: false,
  });
});
describe("source-only static fetch budget", () => {
  it("permits bounded same-origin canonical redirects only with exact host approval", async () => {
    const page = await scrapeStaticSource("https://example.org/need", {
      approvedDomains: ["example.org"],
    });
    expect(page.rendered).toBe(false);
    const options = seams.fetch.mock.calls[0][1];
    expect(options).toMatchObject({ timeoutMs: 8000, maxRedirects: 2 });
    expect(options.assertAllowedUrl).toBeTypeOf("function");
    expect(() => options.assertAllowedUrl("https://example.org/need/")).not.toThrow();
    expect(seams.render).not.toHaveBeenCalled();
  });
  it.each([
    "https://other.example/need/",
    "https://docs.example.org/need/",
    "http://example.org/need/",
    "https://example.org:444/need/",
    "https://user:password@example.org/need/",
    "https://example.org/need/?page=2",
    "https://example.org/need/#section",
    "https://example.org/need/?",
    "https://example.org/need/#",
    "https://example.org/users/customer",
    "https://example.org/%75sers/customer",
    "https://reddit.com/r/example",
    "http://169.254.169.254/latest/meta-data/",
    "https://example.org/need/?access_token=private",
  ])("rejects out-of-capability redirect %s", async (target) => {
    await scrapeStaticSource("https://example.org/need", {
      approvedDomains: ["example.org", "other.example"],
    });
    const policy = seams.fetch.mock.calls[0][1].assertAllowedUrl;
    expect(() => policy(target)).toThrow();
    expect(seams.render).not.toHaveBeenCalled();
  });
  it("rejects a redirect loop before reconnecting to a visited source", async () => {
    await scrapeStaticSource("https://example.org/need", {
      approvedDomains: ["example.org"],
    });
    const policy = seams.fetch.mock.calls[0][1].assertAllowedUrl;
    policy("https://example.org/need");
    policy("https://example.org/need/");
    expect(() => policy("https://example.org/need")).toThrow(/loop/);
  });
  it.each([
    { url: "https://example.org/need", approvedDomains: ["other.example"] },
    { url: "https://docs.example.org/need", approvedDomains: ["example.org"] },
    { url: "https://reddit.com/r/example", approvedDomains: ["reddit.com"] },
    { url: "https://example.org/need?token=private", approvedDomains: ["example.org"] },
    { url: "https://example.org/need#part", approvedDomains: ["example.org"] },
    { url: "https://example.org/need?", approvedDomains: ["example.org"] },
    { url: "https://example.org/need#", approvedDomains: ["example.org"] },
    { url: "https://example.org/need", approvedDomains: ["*.example.org"] },
    { url: "https://example.org/need", approvedDomains: [] },
  ])(
    "rejects invalid initial approval before any fetch: $url",
    async ({ url, approvedDomains }) => {
      await expect(scrapeStaticSource(url, { approvedDomains })).rejects.toThrow();
      expect(seams.fetch).not.toHaveBeenCalled();
      expect(seams.render).not.toHaveBeenCalled();
    }
  );
  it("uses SSRF-safe fetch with an 8s deadline, no redirects and no paid rendering", async () => {
    await scrapeStaticSource("https://example.org/need");
    expect(seams.fetch).toHaveBeenCalledOnce();
    expect(seams.fetch.mock.calls[0][1]).toMatchObject({
      timeoutMs: 8000,
      maxRedirects: 0,
      maxBytes: 2_000_000,
    });
    expect(seams.render).not.toHaveBeenCalled();
    expect(seams.configured).not.toHaveBeenCalled();
  });
  it("rejects a private URL before fetching, and never renders after fetch failure", async () => {
    await expect(scrapeStaticSource("http://127.0.0.1/private")).rejects.toThrow();
    expect(seams.fetch).not.toHaveBeenCalled();
    seams.fetch.mockRejectedValue(new Error("network failure"));
    await expect(scrapeStaticSource("https://example.org/need")).rejects.toThrow();
    expect(seams.render).not.toHaveBeenCalled();
  });
});
