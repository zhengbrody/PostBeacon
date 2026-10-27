import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("optional account configuration", () => {
  it.each([
    undefined,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
  ])(
    "distinguishes absent configuration from a lone %s value without accessing credentials",
    async (present) => {
      vi.resetModules();
      for (const key of [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ])
        vi.stubEnv(key, present === key ? "fictional-config-value" : "");
      const server = await import("@/lib/supabase/server");
      expect(server.authConfigurationPresent()).toBe(Boolean(present));
      expect(server.authConfigured()).toBe(false);
      expect(server.meteringEnabled()).toBe(false);
    }
  );
});
