import type { WorkspaceState } from "./types";

export type GrowthMode = "launch" | "growth";

export const PRIMARY_GOALS = [
  "Waitlist signups",
  "Free signups / installs",
  "Paying customers",
  "User feedback / conversations",
  "Qualified traffic / awareness",
] as const;

/** One founder lifecycle: the first measured publish is the mode boundary. */
export function growthMode(workspace: WorkspaceState): GrowthMode {
  return workspace.experiments.length > 0 ? "growth" : "launch";
}

/** “Help me decide” resolves to a real goal instead of vague model input. */
export function recommendedPrimaryGoal(stage?: string): (typeof PRIMARY_GOALS)[number] {
  const normalized = stage?.toLowerCase() ?? "";
  if (normalized.includes("pre-launch") || normalized.includes("no users")) {
    return "Waitlist signups";
  }
  if (normalized.includes("growing") || normalized.includes("established")) {
    return "Paying customers";
  }
  if (normalized.includes("launched") || normalized.includes("first users")) {
    return "Free signups / installs";
  }
  return "User feedback / conversations";
}
