import { PLATFORMS } from "./platforms";
import { successContractSummary } from "./successContract";
import { auditDraftSafety } from "./contentSafety";
import { normalizeTrackedUrl } from "./trackedUrl";
import { VARIABLE_LABELS } from "./experimentQueue";
import type {
  Fact,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  SuccessContract,
  TestedVariable,
} from "./types";

export interface ExperimentContractProjection {
  audience: string;
  venue: string;
  variable: string;
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
  copyReady: boolean;
  issues: string[];
}

interface DraftDecisionInput {
  profile: ProductProfile;
  recommendation?: PlatformRecommendation;
  content: PlatformContent;
  post: Pick<PlatformPost, "hook" | "body">;
  successContract?: SuccessContract;
  variable?: TestedVariable;
  productUrl?: string;
  facts?: Fact[];
  shareMode?: "product" | "process";
}

const fallback = (value: string | undefined, label: string) => value?.trim() || label;

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const candidate = normalized.slice(0, Math.max(1, max - 1));
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary > max * 0.6 ? boundary : candidate.length)}…`;
}

export function projectExperimentContract({
  profile,
  recommendation,
  content,
  post,
  successContract,
  variable = "exploratory",
}: DraftDecisionInput): ExperimentContractProjection {
  return {
    audience: fallback(profile.audience, "Audience not confirmed"),
    venue: fallback(recommendation?.venue, content.platformName),
    variable: VARIABLE_LABELS[variable],
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

  const process = input.shareMode === "process";
  const url = normalizeTrackedUrl(input.productUrl);
  // Preserve complete claims. Overlong copy is blocked, never silently clipped.
  const xPosts = process
    ? [
        `A growth experiment for ${name}: one channel, one manual test.\n\nThe current plan selects ${platform}; venue: ${venue}.`,
        `The planned success rule: ${rule}.\n\nEvidence and unknowns are reviewed before publishing.`,
        "After the result window, record what actually happened. A checkpoint read informs the next experiment; it does not prove causality. Built with PostBeacon.",
      ]
    : [
        input.post.hook,
        input.post.body,
        `Try ${name}${url ? `: ${url}` : ". Use the product's confirmed public entry point."}\n\nWhat was useful, and where did you get stuck? Feedback is welcome.`,
      ];
  const linkedIn = xPosts.join("\n\n");
  const issues = Array.from(
    new Set([
      ...xPosts.flatMap((text) =>
        auditDraftSafety(
          { hook: "", body: text },
          input.facts ?? [],
          input.profile,
          "twitter"
        ).issues.map((issue) => `${issue.title}: ${issue.fix}`)
      ),
      ...auditDraftSafety(
        { hook: "", body: linkedIn },
        input.facts ?? [],
        input.profile,
        "linkedin"
      ).issues.map((issue) => `${issue.title}: ${issue.fix}`),
      ...(xPosts.some((text) => text.length > 280)
        ? [
            "One X segment exceeds 280 characters. Edit the source draft; no claim was automatically shortened.",
          ]
        : []),
      ...(!process && !url
        ? ["Confirm a public product URL before copying this product kit."]
        : []),
    ])
  );

  return {
    screenshots: [
      {
        title: process ? "1 · Decision" : "1 · The use case",
        focus: process
          ? `Capture the ${platform} recommendation and uncertainty.`
          : `Capture ${name}'s real starting screen and the task a user can try.`,
        altText: process
          ? `PostBeacon channel decision for ${name}.`
          : `${name}'s starting screen for the demonstrated task.`,
      },
      {
        title: process ? "2 · Draft proof" : "2 · The interaction",
        focus: process
          ? "Capture the contract and Truth Gate."
          : "Capture the actual product operation. Use clearly labelled sample data; do not invent an interface or user results.",
        altText: process
          ? `PostBeacon draft workbench for ${name}.`
          : `${name} during the actual demonstrated interaction.`,
      },
      {
        title: process ? "3 · Learning loop" : "3 · The result",
        focus: process
          ? "Capture the next result checkpoint."
          : "Capture the real task output and the next usable action. Hide private data and label simulated output.",
        altText: process
          ? `PostBeacon experiment progress for ${name}.`
          : `${name}'s demonstrated task output; sample data must be labelled.`,
      },
    ],
    xPosts,
    linkedIn,
    copyReady: issues.length === 0,
    issues,
    privacyReminder:
      "Before sharing, hide email addresses, private project tabs, live-post URLs and any unannounced metrics.",
  };
}
