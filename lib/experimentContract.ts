import { PLATFORMS } from "./platforms";
import { successContractSummary } from "./successContract";
import type {
  Fact,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  SuccessContract,
} from "./types";

export interface ExperimentContractProjection {
  audience: string;
  venue: string;
  variable: "Hook";
  candidate: string;
  angle: string;
  decisionRule: string;
}

export interface DraftRationale {
  evidence: Pick<Fact, "id" | "claim" | "status">[];
  platformRule: string;
  angle: string;
  inferenceNotes: string[];
}

export interface ShareKitScreenshot {
  title: string;
  focus: string;
  altText: string;
}

export interface ShareKit {
  screenshots: ShareKitScreenshot[];
  xPosts: string[];
  linkedIn: string;
  privacyReminder: string;
}

interface DraftDecisionInput {
  profile: ProductProfile;
  recommendation?: PlatformRecommendation;
  content: PlatformContent;
  post: Pick<PlatformPost, "hook" | "body">;
  successContract?: SuccessContract;
}

const fallback = (value: string | undefined, label: string) => value?.trim() || label;

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const candidate = normalized.slice(0, Math.max(1, max - 1));
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary > max * 0.6 ? boundary : candidate.length)}…`;
}

function fitX(value: string): string {
  if (value.length <= 280) return value;
  return clip(value, 280);
}

export function projectExperimentContract({
  profile,
  recommendation,
  content,
  post,
  successContract,
}: DraftDecisionInput): ExperimentContractProjection {
  return {
    audience: fallback(profile.audience, "Audience not confirmed"),
    venue: fallback(recommendation?.venue, content.platformName),
    variable: "Hook",
    candidate: fallback(post.hook, "No hook selected"),
    angle: fallback(recommendation?.angle, "Angle not recorded"),
    decisionRule: successContract
      ? successContractSummary(successContract)
      : "No Success Contract is stored for this legacy plan.",
  };
}

/**
 * Explain only provenance the product can actually prove. Recommendation
 * breakdown fact IDs are the strategy's explicit evidence links; we never
 * pretend a semantic paraphrase in the draft is an exact citation.
 */
export function explainDraft({
  facts,
  recommendation,
  content,
}: {
  facts: Fact[];
  recommendation?: PlatformRecommendation;
  content: PlatformContent;
}): DraftRationale {
  const citedIds = new Set(
    Object.values(recommendation?.breakdown ?? {}).flatMap(
      (dimension) => dimension.factIds ?? []
    )
  );
  const evidence = facts
    .filter((fact) => citedIds.has(fact.id) && fact.claim.trim())
    .slice(0, 4)
    .map(({ id, claim, status }) => ({ id, claim, status }));
  const platform = PLATFORMS.find((candidate) => candidate.id === content.platformId);
  const inferenceNotes: string[] = [];
  if (recommendation?.angle) {
    inferenceNotes.push("The angle and hook are strategic choices, not observed facts.");
  }
  if (recommendation?.provenance !== "grounded" && recommendation?.venue) {
    inferenceNotes.push("The venue is inferred; confirm its rules before posting.");
  }
  if (evidence.some((fact) => fact.status === "inferred")) {
    inferenceNotes.push("At least one cited strategy fact is inferred, not page-verified.");
  }

  return {
    evidence,
    platformRule: clip(
      platform?.guidance ??
        content.playbook?.howToPost ??
        "Follow the venue's current rules and publish manually.",
      260
    ),
    angle: fallback(recommendation?.angle, "No strategy angle is attached."),
    inferenceNotes,
  };
}

export function buildShareKit(input: DraftDecisionInput): ShareKit {
  const contract = projectExperimentContract(input);
  const name = clip(input.profile.name || "this product", 48);
  const platform = clip(input.content.platformName, 40);
  const venue = clip(contract.venue, 60);
  const rule = clip(contract.decisionRule, 110);

  const xPosts = [
    fitX(
      `1/3\n\nI’m testing a clearer growth loop for ${name}: verified product facts → one channel decision → one manual experiment.\n\nPostBeacon chose ${platform}, with ${venue} as the next place to test.`
    ),
    fitX(
      `2/3\n\nThe test is explicit: ${rule}.\n\nThe draft shows its evidence and platform rule, runs a deterministic truth check, and records a hook change before I publish.`
    ),
    fitX(
      `3/3\n\nAfter the result window, I’ll record what actually happened. The verdict stays attached to that checkpoint, so the next experiment changes from evidence instead of a fresh AI guess.\n\nBuilt with PostBeacon.`
    ),
  ];

  return {
    screenshots: [
      {
        title: "1 · Decision",
        focus: `Capture the ${platform} recommendation, venue and why it outranks the alternative.`,
        altText: `PostBeacon recommending ${platform} for ${name}, with the venue and ranking rationale visible.`,
      },
      {
        title: "2 · Draft proof",
        focus: "Capture the Experiment Contract, selected hook and passed Truth Gate.",
        altText: `PostBeacon draft workbench showing the experiment contract and truth check for ${name}.`,
      },
      {
        title: "3 · Learning loop",
        focus:
          "Capture Prepare → Publish → Measure → Learn and the next result checkpoint.",
        altText: `PostBeacon progress view for the ${platform} experiment, from preparation through learning.`,
      },
    ],
    xPosts,
    linkedIn: [
      `I’m testing a more disciplined growth loop for ${name}.`,
      `PostBeacon verified the product evidence, compared the available channels and selected ${platform} — specifically ${venue} — as one experiment to run next.`,
      `Before publishing, the workspace makes the contract visible: ${contract.decisionRule}. It also shows which facts and platform rules support the draft, runs a deterministic truth check and records a hook change instead of silently replacing it.`,
      "After the result window, I’ll record the real outcome. The verdict remains attached to that checkpoint, and the evidence shapes the next experiment.",
      "No automatic posting and no invented results.",
    ].join("\n\n"),
    privacyReminder:
      "Before sharing, hide email addresses, private project tabs, live-post URLs and any unannounced metrics.",
  };
}
