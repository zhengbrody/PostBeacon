import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Deliberately use the installed OpenAI SDK, not a class mock. Only its HTTP
// transport is replaced; no request can reach a real provider or use real keys.
interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}
const sent: CapturedRequest[] = [];
type Reply = (request: CapturedRequest) => Response;
let reply: Reply;

function completion(model: string, content = '{"ok":true}') {
  return Response.json({
    id: "chatcmpl-offline",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  });
}

function rejection(status: number) {
  return Response.json(
    { error: { message: "private upstream response", type: "test_error" } },
    { status }
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "offline-openai-key");
  vi.stubEnv("DEEPSEEK_API_KEY", "offline-deepseek-key");
  vi.stubEnv("OPENAI_MODEL", "gpt-4o");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-chat");
  vi.stubEnv("DEFAULT_PROVIDER", "openai");
  vi.stubEnv("NEXT_PUBLIC_DEEPSEEK_FALLBACK", "true");
  sent.length = 0;
  reply = () => {
    throw new Error("Unconfigured offline transport response.");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const captured: CapturedRequest = {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: await request.json(),
      };
      sent.push(captured);
      return reply(captured);
    })
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("installed SDK wire compatibility (offline)", () => {
  it.each([
    ["openai", "https://api.openai.com/v1/chat/completions", "gpt-4o", "openai"],
    ["deepseek", "https://api.deepseek.com/chat/completions", "deepseek-chat", "deepseek"],
  ] as const)(
    "keeps %s endpoint, model, JSON mode, token budget and bearer unchanged",
    async (provider, url, model, key) => {
      reply = () => completion(model);
      const { generateJsonOnce } = await import("@/lib/llm");
      const result = await generateJsonOnce({
        provider,
        system: "Offline system instruction",
        user: "Offline public test description",
        maxTokens: 2600,
      });
      expect(result).toEqual({ data: { ok: true }, meta: { provider, model } });
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe(url);
      expect(sent[0].method).toBe("POST");
      expect(sent[0].headers.get("authorization")).toBe(`Bearer offline-${key}-key`);
      expect(sent[0].body).toEqual({
        model,
        max_tokens: 2600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: expect.stringContaining("Offline system instruction"),
          },
          { role: "user", content: "Offline public test description" },
        ],
      });
    }
  );

  it.each([402, 429, 500])(
    "research HTTP %s makes one request, with no SDK retry or provider fallback",
    async (status) => {
      reply = () => rejection(status);
      const { generateJsonOnce } = await import("@/lib/llm");
      await expect(
        generateJsonOnce({
          provider: "openai",
          system: "Offline system instruction",
          user: "Offline public test description",
          maxTokens: 2600,
        })
      ).rejects.toMatchObject({ status: 503 });
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    }
  );

  it("research transport errors make one request and keep upstream details private", async () => {
    reply = () => {
      throw new TypeError("private network details");
    };
    const { generateJsonOnce } = await import("@/lib/llm");
    await expect(
      generateJsonOnce({
        provider: "deepseek",
        system: "Offline system instruction",
        user: "Offline public test description",
        maxTokens: 2600,
      })
    ).rejects.toMatchObject({
      status: 503,
      message: expect.not.stringContaining("private"),
    });
    expect(sent).toHaveLength(1);
  });

  it("research invalid JSON is not repaired with another request", async () => {
    reply = () => completion("gpt-4o", "invalid structured output");
    const { generateJsonOnce } = await import("@/lib/llm");
    await expect(
      generateJsonOnce({
        provider: "openai",
        system: "Offline system instruction",
        user: "Offline public test description",
        maxTokens: 2600,
      })
    ).rejects.toMatchObject({ status: 503 });
    expect(sent).toHaveLength(1);
  });

  it("ordinary generation retains disclosed fallback and actual-provider provenance", async () => {
    reply = ({ url }) =>
      url.startsWith("https://api.openai.com/")
        ? rejection(402)
        : completion("deepseek-chat");
    const { generateJsonMeta } = await import("@/lib/llm");
    const result = await generateJsonMeta({
      provider: "openai",
      system: "Offline system instruction",
      user: "Offline public test description",
      maxTokens: 1200,
    });
    expect(result).toEqual({
      data: { ok: true },
      meta: { provider: "deepseek", model: "deepseek-chat", fallbackFrom: "openai" },
    });
    expect(sent.map((request) => request.url)).toEqual([
      "https://api.openai.com/v1/chat/completions",
      "https://api.deepseek.com/chat/completions",
    ]);
    expect(sent.map((request) => request.body.max_tokens)).toEqual([1200, 1200]);
  });

  it("ordinary request rejection is not routed around with another provider", async () => {
    reply = () => rejection(400);
    const { generateJsonMeta } = await import("@/lib/llm");
    await expect(
      generateJsonMeta({
        provider: "openai",
        system: "Offline system instruction",
        user: "Offline public test description",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(sent).toHaveLength(1);
  });
});
