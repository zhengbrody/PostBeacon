import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bounded production Beta schedule", () => {
  it("registers one daily authenticated mission route without changing existing jobs", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.crons).toEqual([
      { path: "/api/retention", schedule: "0 4 * * *" },
      { path: "/api/reminders", schedule: "0 16 * * *" },
      { path: "/api/agent-missions/tick", schedule: "0 12 * * *" },
    ]);
    const route = readFileSync("app/api/agent-missions/tick/route.ts", "utf8");
    expect(route).toContain("if (!secret)");
    expect(route).toContain("bearer(req) !== secret");
    expect(route).toContain("if (!agentMissionsEnabled())");
  });
});
