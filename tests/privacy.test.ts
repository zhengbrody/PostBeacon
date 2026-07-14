import { afterEach, describe, expect, it } from "vitest";
import { availableProviders } from "@/lib/llm";
import {
  activeSubprocessors,
  automaticFallbackProviders,
  billingConfigured,
  clearPolicyProviders,
  configuredProviderPrivacy,
  DATA_CATEGORIES,
  providerFallbackNotice,
  PROVIDER_PRIVACY,
  SUBPROCESSORS,
  visibleDataCategories,
} from "@/lib/privacy";
import type { Provider } from "@/lib/types";

const ALL_PROVIDERS: Provider[] = ["claude", "openai", "deepseek"];
const KEY_ENVS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEFAULT_PROVIDER",
  "NEXT_PUBLIC_DEEPSEEK_FALLBACK",
  "POLAR_ACCESS_TOKEN",
  "POLAR_PRODUCT_ID",
  "POLAR_WEBHOOK_SECRET",
] as const;
const saved = KEY_ENVS.map((k) => [k, process.env[k]] as const);
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("privacy single source stays complete", () => {
  it("every provider has a privacy note, policy link, and a subprocessor entry", () => {
    for (const p of ALL_PROVIDERS) {
      const info = PROVIDER_PRIVACY[p];
      expect(info.note.length).toBeGreaterThan(20);
      expect(info.policyUrl).toMatch(/^https:\/\//);
      expect(
        SUBPROCESSORS.some((s) => s.name === info.label || info.label.includes(s.name)),
        `${p} missing from SUBPROCESSORS`
      ).toBe(true);
    }
  });

  it("an unclear-policy provider is flagged, never silently equal to the clear ones", () => {
    expect(clearPolicyProviders()).toEqual(["claude", "openai"]);
    expect(PROVIDER_PRIVACY.deepseek.clearPolicy).toBe(false);
    expect(PROVIDER_PRIVACY.deepseek.note).toMatch(/confidential/i);
  });

  it("DeepSeek automatic fallback requires the public beta opt-in", () => {
    delete process.env.NEXT_PUBLIC_DEEPSEEK_FALLBACK;
    expect(automaticFallbackProviders()).toEqual(["claude", "openai"]);
    expect(providerFallbackNotice()).toContain("never an automatic fallback");

    process.env.NEXT_PUBLIC_DEEPSEEK_FALLBACK = "true";
    expect(automaticFallbackProviders()).toEqual(["claude", "openai", "deepseek"]);
    expect(providerFallbackNotice()).toContain("processes data in China");
  });

  it("the inventory names the load-bearing truths (localStorage, provider flow, no transcripts)", () => {
    const all = JSON.stringify(DATA_CATEGORIES);
    expect(all).toContain("localStorage");
    expect(all).toContain("primary model");
    expect(all).toContain("clear-policy fallback");
    expect(all).toMatch(/never long-term memory/);
  });

  it("hides dormant billing from the current private-beta pages", () => {
    delete process.env.POLAR_ACCESS_TOKEN;
    delete process.env.POLAR_PRODUCT_ID;
    delete process.env.POLAR_WEBHOOK_SECRET;
    expect(billingConfigured()).toBe(false);
    expect(activeSubprocessors().some((vendor) => vendor.name === "Polar")).toBe(false);
    expect(visibleDataCategories().some((category) => category.what === "Billing")).toBe(
      false
    );

    process.env.POLAR_ACCESS_TOKEN = "test";
    process.env.POLAR_PRODUCT_ID = "test";
    process.env.POLAR_WEBHOOK_SECRET = "test";
    expect(billingConfigured()).toBe(true);
    expect(activeSubprocessors().some((vendor) => vendor.name === "Polar")).toBe(true);
    expect(visibleDataCategories().some((category) => category.what === "Billing")).toBe(
      true
    );
  });

  it("publishes provider notes only for configured models", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test";
    process.env.DEEPSEEK_API_KEY = "test";
    expect(configuredProviderPrivacy().map((provider) => provider.label)).toEqual([
      "OpenAI",
      "DeepSeek",
    ]);
  });
});

describe("provider default ordering (M17 §5: unclear policy never the silent default)", () => {
  it("with multiple keys and no DEFAULT_PROVIDER, a clear-policy provider comes first", () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    delete process.env.DEFAULT_PROVIDER;
    expect(availableProviders()).toEqual(["claude", "openai", "deepseek"]);
  });

  it("deepseek-only stays available (ordering never hides a configured provider)", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DEEPSEEK_API_KEY = "k";
    delete process.env.DEFAULT_PROVIDER;
    expect(availableProviders()).toEqual(["deepseek"]);
  });

  it("an unclear-policy DEFAULT_PROVIDER cannot silently opt users in", () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.DEFAULT_PROVIDER = "deepseek";
    expect(availableProviders()).toEqual(["claude", "deepseek"]);
  });

  it("a clear-policy DEFAULT_PROVIDER is still honored", () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.DEFAULT_PROVIDER = "openai";
    expect(availableProviders()).toEqual(["openai", "claude", "deepseek"]);
  });
});
