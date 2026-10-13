import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  openaiCreate: vi.fn(),
  deepseekCreate: vi.fn(),
  options: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: sdk.anthropicCreate };
  },
}));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    chat: { completions: { create: typeof sdk.openaiCreate } };

    constructor(opts: { baseURL?: string }) {
      sdk.options(opts);
      this.chat = {
        completions: {
          create: opts.baseURL ? sdk.deepseekCreate : sdk.openaiCreate,
        },
      };
    }
  },
}));

import { generateJsonMeta, generateJsonOnce } from "@/lib/llm";
import { PublicError } from "@/lib/errors";

const KEY_ENVS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEFAULT_PROVIDER",
  "NEXT_PUBLIC_DEEPSEEK_FALLBACK",
] as const;
const saved = KEY_ENVS.map((key) => [key, process.env[key]] as const);

function upstreamError(status: number) {
  return Object.assign(new Error("upstream detail must not reach the user"), { status });
}

function openAiJson(value: unknown) {
  return { choices: [{ message: { content: JSON.stringify(value) } }] };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-claude";
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.DEEPSEEK_API_KEY = "test-deepseek";
  process.env.DEFAULT_PROVIDER = "claude";
  delete process.env.NEXT_PUBLIC_DEEPSEEK_FALLBACK;
  sdk.anthropicCreate.mockReset();
  sdk.openaiCreate.mockReset();
  sdk.deepseekCreate.mockReset();
  sdk.options.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("automatic provider failover", () => {
  it("moves from an invalid Claude key to OpenAI and records provenance", async () => {
    sdk.anthropicCreate.mockRejectedValue(upstreamError(401));
    sdk.openaiCreate.mockResolvedValue(openAiJson({ ok: true }));

    const result = await generateJsonMeta({
      provider: "claude",
      system: "system",
      user: "user",
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.meta.provider).toBe("openai");
    expect(result.meta.fallbackFrom).toBe("claude");
    expect(sdk.anthropicCreate).toHaveBeenCalledOnce();
    expect(sdk.openaiCreate).toHaveBeenCalledOnce();
  });

  it("never uses DeepSeek as an automatic fallback", async () => {
    sdk.anthropicCreate.mockRejectedValue(upstreamError(401));
    sdk.openaiCreate.mockRejectedValue(upstreamError(429));

    await expect(
      generateJsonMeta({ provider: "claude", system: "system", user: "user" })
    ).rejects.toBeInstanceOf(PublicError);
    expect(sdk.deepseekCreate).not.toHaveBeenCalled();
  });

  it("uses DeepSeek only after the explicit public beta opt-in", async () => {
    process.env.NEXT_PUBLIC_DEEPSEEK_FALLBACK = "true";
    sdk.anthropicCreate.mockRejectedValue(upstreamError(401));
    sdk.openaiCreate.mockRejectedValue(upstreamError(429));
    sdk.deepseekCreate.mockResolvedValue(openAiJson({ ok: "deepseek" }));

    const result = await generateJsonMeta({
      provider: "claude",
      system: "system",
      user: "user",
    });

    expect(result.data).toEqual({ ok: "deepseek" });
    expect(result.meta).toMatchObject({ provider: "deepseek", fallbackFrom: "claude" });
    expect(sdk.deepseekCreate).toHaveBeenCalledOnce();
  });

  it("does not route around a non-retryable content/request rejection", async () => {
    sdk.anthropicCreate.mockRejectedValue(upstreamError(400));

    await expect(
      generateJsonMeta({ provider: "claude", system: "system", user: "user" })
    ).rejects.toMatchObject({ status: 400 });
    expect(sdk.openaiCreate).not.toHaveBeenCalled();
    expect(sdk.deepseekCreate).not.toHaveBeenCalled();
  });

  it("falls back when both the original and repair outputs are malformed", async () => {
    sdk.anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "not-json" }],
    });
    sdk.openaiCreate.mockResolvedValue(openAiJson({ repairedByFallback: true }));

    const result = await generateJsonMeta({
      provider: "claude",
      system: "system",
      user: "user",
    });

    expect(result.data).toEqual({ repairedByFallback: true });
    expect(result.meta).toMatchObject({ provider: "openai", fallbackFrom: "claude" });
    expect(sdk.anthropicCreate).toHaveBeenCalledTimes(2);
  });
});

describe("single-attempt research budget", () => {
  it("sets a 20s SDK timeout and zero retries, returning actual provider metadata", async () => {
    sdk.openaiCreate.mockResolvedValue(openAiJson({ opportunities: [] }));
    const result = await generateJsonOnce({
      provider: "openai",
      system: "system",
      user: "bounded",
      maxTokens: 2600,
    });
    expect(result.meta.provider).toBe("openai");
    expect(sdk.openaiCreate).toHaveBeenCalledOnce();
    expect(sdk.options).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 20_000, maxRetries: 0 })
    );
  });
  it.each(["invalid-json", "credit"])(
    "does not repair, retry or fallback on %s",
    async (mode) => {
      process.env.NEXT_PUBLIC_DEEPSEEK_FALLBACK = "true";
      if (mode === "credit") sdk.openaiCreate.mockRejectedValue(upstreamError(402));
      else
        sdk.openaiCreate.mockResolvedValue({
          choices: [{ message: { content: "private non-JSON output" } }],
        });
      await expect(
        generateJsonOnce({
          provider: "openai",
          system: "system",
          user: "bounded",
          maxTokens: 2600,
        })
      ).rejects.toMatchObject({ status: 503 });
      expect(sdk.openaiCreate).toHaveBeenCalledOnce();
      expect(sdk.deepseekCreate).not.toHaveBeenCalled();
      expect(sdk.anthropicCreate).not.toHaveBeenCalled();
    }
  );
  it("rejects over-budget or unconfigured requests without provider substitution", async () => {
    await expect(
      generateJsonOnce({
        provider: "openai",
        system: "system",
        user: "x".repeat(24_001),
        maxTokens: 2600,
      })
    ).rejects.toMatchObject({ status: 400 });
    delete process.env.OPENAI_API_KEY;
    await expect(
      generateJsonOnce({
        provider: "openai",
        system: "system",
        user: "bounded",
        maxTokens: 2600,
      })
    ).rejects.toMatchObject({ status: 503 });
    expect(sdk.options).not.toHaveBeenCalled();
    expect(sdk.anthropicCreate).not.toHaveBeenCalled();
  });
});
