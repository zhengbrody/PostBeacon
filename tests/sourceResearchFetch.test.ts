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
