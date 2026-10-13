import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverChannels, searchSourceId } from "@/lib/discovery";
import { groundRecommendations } from "@/lib/scoring";
import { DEMO_PROJECT } from "@/lib/demo";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  search: vi.fn(),
  configured: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/llm", () => ({ generateJson: mocks.generate }));
vi.mock("@/lib/search", () => ({
  searchWeb: mocks.search,
  searchConfigured: mocks.configured,
}));
vi.mock("@/lib/safeFetch", () => ({ safeFetch: mocks.fetch }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.search.mockResolvedValue([
    {
      title: "A community",
      url: "https://example.com/community",
      snippet: "An indexed source",
    },
  ]);
  mocks.fetch.mockResolvedValue({ status: 200 });
});

describe("discovery provenance is earned independently of link reachability", () => {
  it("invented model URLs never reach a liveness probe when search results exist", async () => {
    mocks.generate.mockResolvedValue({
      channels: [
        { name: "Made up", url: "https://invented.example/community" },
        { name: "Indexed", url: "https://example.com/community" },
      ],
    });
    const channels = await discoverChannels(DEMO_PROJECT.profile);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("A community"); // indexed title, not the model's invented label
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(channels[0]).toMatchObject({
      searchBacked: true,
      sourceId: "search:1",
      reachable: true,
      contentRead: false,
      rulesReviewed: false,
      validated: false,
    });
  });
  it("a reachable fallback URL remains a model suggestion and cannot ground a recommendation", async () => {
    mocks.configured.mockReturnValue(false);
    mocks.generate.mockResolvedValue({
      channels: [{ name: "r/selfhosted", url: "https://reddit.com/r/selfhosted" }],
    });
    const channels = await discoverChannels(DEMO_PROJECT.profile);
    expect(channels[0]).toMatchObject({
      searchBacked: false,
      reachable: true,
      validated: false,
    });
    const rec = { ...DEMO_PROJECT.strategy.recommendations[0], venue: "r/selfhosted" };
    expect(groundRecommendations([rec], channels)[0].provenance).toBe("inferred");
  });
  it("source membership allows fragments but never rewritten query paths", () => {
    const sources = [
      { title: "source", url: "https://example.com/community?a=1", snippet: "" },
    ];
    expect(searchSourceId("https://example.com/community?a=1#x", sources)).toBe("search:1");
    expect(searchSourceId("https://example.com/community?a=2", sources)).toBeUndefined();
  });
});
