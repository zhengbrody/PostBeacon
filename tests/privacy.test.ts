import { afterEach, describe, expect, it } from "vitest";
import { availableProviders } from "@/lib/llm";
import {
  clearPolicyProviders,
  DATA_CATEGORIES,
  PROVIDER_PRIVACY,
  SUBPROCESSORS,
} from "@/lib/privacy";
import type { Provider } from "@/lib/types";

const ALL_PROVIDERS: Provider[] = ["claude", "openai", "deepseek"];
const KEY_ENVS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEFAULT_PROVIDER",
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

  it("the inventory names the load-bearing truths (localStorage, provider flow, no transcripts)", () => {
    const all = JSON.stringify(DATA_CATEGORIES);
    expect(all).toContain("localStorage");
    expect(all).toContain("model you selected");
    expect(all).toMatch(/never long-term memory/);
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

  it("an explicit DEFAULT_PROVIDER remains an operator override", () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.DEFAULT_PROVIDER = "deepseek";
    expect(availableProviders()[0]).toBe("deepseek");
  });
});
