import { describe, expect, it } from "vitest";
import { projectSaveErrorMessage } from "@/lib/projectSaveError";

describe("project save error messages", () => {
  it("names the missing PostgREST column without echoing other detail", () => {
    const message = projectSaveErrorMessage({
      code: "PGRST204",
      message:
        "Could not find the 'meta' column of 'projects' in the schema cache\nBearer secret",
    });
    expect(message).toContain("“meta”");
    expect(message).toContain("latest Supabase migration");
    expect(message).not.toContain("Bearer secret");
  });

  it("keeps unknown database failures generic", () => {
    expect(
      projectSaveErrorMessage({ code: "42501", message: "private database detail" })
    ).toBe("Project save failed (42501). Try Save now again.");
  });
});
