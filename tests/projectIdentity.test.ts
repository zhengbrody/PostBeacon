import { describe, expect, it } from "vitest";
import { projectIdentity } from "@/lib/projectIdentity";

describe("projectIdentity", () => {
  it("distinguishes duplicate names with domain and updated date", () => {
    const first = projectIdentity(
      "MindMarket",
      "https://mindmarket.app/path",
      "2026-07-14T12:00:00Z"
    );
    const second = projectIdentity(
      "MindMarket",
      "https://preview.mindmarket.app",
      "2026-07-15T12:00:00Z"
    );

    expect(first.detail).toContain("mindmarket.app");
    expect(first.detail).toContain("Jul 14");
    expect(second.detail).toContain("preview.mindmarket.app");
    expect(second.label).not.toBe(first.label);
  });

  it("has bounded fallbacks for malformed historical rows", () => {
    expect(projectIdentity("", "not a url", "not a date")).toEqual({
      name: "Untitled project",
      detail: "saved project · date unknown",
      label: "Untitled project — saved project · date unknown",
    });
  });
});
