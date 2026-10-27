import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../supabase");
const migration = readFileSync(
  join(root, "migrations/20261026_workspace_ownership.sql"),
  "utf8"
);
const schema = readFileSync(join(root, "schema.sql"), "utf8");

describe("workspace parent ownership installation contract", () => {
  it("fresh installs and upgrades use the same ownership transaction", () => {
    const body = migration.slice(migration.indexOf("\nbegin;") + 1).trim();
    expect(schema).toContain(body);
    expect(body).toMatch(/^begin;/);
    expect(body).toMatch(/notify pgrst, 'reload schema';\ncommit;$/);
  });
  it("preflights under write-blocking locks before any index or constraint mutation", () => {
    expect(migration.indexOf("in share row exclusive mode")).toBeLessThan(
      migration.indexOf("do $workspace_ownership_preflight$")
    );
    expect(migration.indexOf("workspace_ownership_preflight_failed")).toBeLessThan(
      migration.indexOf("create unique index")
    );
    expect(migration).not.toMatch(/\b(?:delete from|update) public\./i);
    expect(migration).not.toMatch(/drop (?:table|constraint|index)/i);
  });
});
