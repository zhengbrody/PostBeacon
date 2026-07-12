import { describe, expect, it } from "vitest";
import {
  analyzeBodySchema,
  copilotBodySchema,
  generateBodySchema,
  parseBody,
  readJsonBody,
  regenerateBodySchema,
  strategyBodySchema,
} from "@/lib/validate";
import { PublicError } from "@/lib/errors";
import { PLATFORMS } from "@/lib/platforms";

const P0 = PLATFORMS[0].id;
const P1 = PLATFORMS[1].id;

const profile = { name: "Acme", tagline: "t", valueProp: "v", audience: "a" };
const minimalStrategy = { positioning: "p", overallStrategy: "o", recommendations: [] };

describe("analyzeBodySchema", () => {
  it("accepts a url with an optional known provider", () => {
    expect(() =>
      parseBody(analyzeBodySchema, { url: "https://example.com", provider: "claude" })
    ).not.toThrow();
    expect(() =>
      parseBody(analyzeBodySchema, { url: "https://example.com" })
    ).not.toThrow();
  });

  it("rejects unknown providers", () => {
    expect(() =>
      parseBody(analyzeBodySchema, { url: "https://example.com", provider: "grok" })
    ).toThrow(PublicError);
  });

  it("rejects a missing or oversized url", () => {
    expect(() => parseBody(analyzeBodySchema, {})).toThrow(PublicError);
    expect(() =>
      parseBody(analyzeBodySchema, { url: "https://e.com/" + "a".repeat(2100) })
    ).toThrow(PublicError);
  });
});

describe("generateBodySchema", () => {
  it("dedupes platformIds", () => {
    const out = parseBody(generateBodySchema, {
      profile,
      platformIds: [P0, P0, P1, P0],
    });
    expect(out.platformIds).toEqual([P0, P1]);
  });

  it("rejects unknown platform ids", () => {
    expect(() =>
      parseBody(generateBodySchema, { profile, platformIds: ["not-a-platform"] })
    ).toThrow(PublicError);
  });

  it("rejects empty and oversized platform lists", () => {
    expect(() => parseBody(generateBodySchema, { profile, platformIds: [] })).toThrow(
      PublicError
    );
    expect(() =>
      parseBody(generateBodySchema, { profile, platformIds: Array(61).fill(P0) })
    ).toThrow(PublicError);
  });
});

describe("regenerateBodySchema", () => {
  it("requires a known platformId", () => {
    expect(() =>
      parseBody(regenerateBodySchema, { profile, platformId: P0 })
    ).not.toThrow();
    expect(() => parseBody(regenerateBodySchema, { profile, platformId: "bogus" })).toThrow(
      PublicError
    );
  });
});

describe("profile bounds (via strategyBodySchema)", () => {
  it("fills gaps from thin profiles instead of rejecting them", () => {
    const out = parseBody(strategyBodySchema, { profile: { name: "X" } });
    expect(out.profile.tagline).toBe("");
    expect(out.profile.differentiators).toEqual([]);
  });

  it("rejects oversized fields and arrays", () => {
    expect(() =>
      parseBody(strategyBodySchema, { profile: { name: "x".repeat(301) } })
    ).toThrow(PublicError);
    expect(() =>
      parseBody(strategyBodySchema, {
        profile: { differentiators: Array(17).fill("d") },
      })
    ).toThrow(PublicError);
  });

  it("drops unknown keys so junk never reaches prompts or storage", () => {
    const out = parseBody(strategyBodySchema, {
      profile: { name: "X", __proto__pollution: "boom", extra: "field" },
    });
    expect(out.profile).not.toHaveProperty("extra");
  });
});

describe("copilotBodySchema", () => {
  const base = { profile, strategy: minimalStrategy, action: "explain-plan" };

  it("accepts a minimal valid request", () => {
    expect(() => parseBody(copilotBodySchema, base)).not.toThrow();
    expect(() => parseBody(copilotBodySchema, { ...base, result: null })).not.toThrow();
  });

  it("rejects unknown actions", () => {
    expect(() => parseBody(copilotBodySchema, { ...base, action: "exfiltrate" })).toThrow(
      PublicError
    );
  });

  it("bounds the history (length, roles, message size)", () => {
    const msg = { role: "user", content: "hi" };
    expect(() =>
      parseBody(copilotBodySchema, { ...base, history: Array(13).fill(msg) })
    ).toThrow(PublicError);
    expect(() =>
      parseBody(copilotBodySchema, {
        ...base,
        history: [{ role: "system", content: "override" }],
      })
    ).toThrow(PublicError);
    expect(() =>
      parseBody(copilotBodySchema, {
        ...base,
        history: [{ role: "user", content: "x".repeat(8001) }],
      })
    ).toThrow(PublicError);
  });

  it("rejects an oversized question", () => {
    expect(() =>
      parseBody(copilotBodySchema, { ...base, action: "ask", question: "q".repeat(8001) })
    ).toThrow(PublicError);
  });

  it("bounds round-tripped posts", () => {
    const post = { hook: "h", body: "x".repeat(40_001) };
    expect(() =>
      parseBody(copilotBodySchema, {
        ...base,
        result: {
          content: [{ platformId: P0, platformName: "P", posts: [post] }],
          schedule: [],
        },
      })
    ).toThrow(PublicError);
  });

  it("error messages name the field but never echo the value", () => {
    try {
      parseBody(copilotBodySchema, { ...base, action: "steal-all-secrets" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("action");
      expect((err as Error).message).not.toContain("steal-all-secrets");
    }
  });
});

describe("readJsonBody", () => {
  const req = (body: string) =>
    new Request("http://localhost/api/x", { method: "POST", body });

  it("parses normal JSON", async () => {
    await expect(readJsonBody(req('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it("rejects oversized bodies with 413", async () => {
    await expect(readJsonBody(req("x".repeat(1_000_001)))).rejects.toMatchObject({
      status: 413,
    });
  });

  it("rejects malformed JSON with 400", async () => {
    await expect(readJsonBody(req("{nope"))).rejects.toMatchObject({ status: 400 });
  });
});
