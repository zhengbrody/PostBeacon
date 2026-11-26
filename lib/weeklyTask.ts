import { asRecord, asRecordList, asString } from "./coerce";
import { trialProductFacts } from "./opportunityResearch";
import { successContractSummary } from "./successContract";
import type {
  Fact,
  ProviderRunMeta,
  WeeklyTask,
  WeeklyTaskEvidence,
  WeeklyTaskIntake,
  WeeklyTaskKind,
  WeeklyTaskProposal,
  WeeklyTaskRecord,
  WeeklyTaskScenarioResult,
  WeeklyTaskStatus,
  WorkspaceState,
} from "./types";

/**
 * M27.1 — one weekly task. Pure domain rules: normalization, the state machine
 * and the Build Brief. A model may only supply a proposal; every transition,
 * revision check and "verified" decision is made here.
 *
 * PostBeacon never reads the founder's repository or inspects their product,
 * so "verified" always means "the founder reported evidence", never "we checked".
 */

export const WEEKLY_TASK_LIMITS = {
  text: 600,
  item: 240,
  items: 6,
  title: 140,
  progress: 20,
  history: 20,
  minEvidence: 20,
  evidence: 2000,
} as const;

export const WEEKLY_TASK_STATUS_LABEL: Record<WeeklyTaskStatus, string> = {
  planning: "Needs a plan",
  proposed: "Needs your confirmation",
  building: "In development",
  verifying: "Needs verification",
  verified: "Verified by you",
};

export const WEEKLY_TASK_KIND_LABEL: Record<WeeklyTaskKind, string> = {
  "product-improvement": "Product improvement",
  "validate-demand": "Validate demand first",
  "usability-check": "Usability check first",
};

const STATUSES: WeeklyTaskStatus[] = [
  "planning",
  "proposed",
  "building",
  "verifying",
  "verified",
];
const KINDS: WeeklyTaskKind[] = [
  "product-improvement",
  "validate-demand",
  "usability-check",
];
const RESULTS: WeeklyTaskScenarioResult[] = ["passed", "failed", "not-checked"];

const clean = (value: unknown, max: number) =>
  asString(value).replace(/\s+/g, " ").trim().slice(0, max);
const isIso = (value: string) => Boolean(value) && !Number.isNaN(Date.parse(value));

/** Framework and site names that look like file names but are not. */
const NOT_A_FILE =
  /^(?:next|node|vue|react|nuxt|three|d3|express|ember|backbone|alpine|solid|angular|svelte|chart|p5|moment|socket|discord|ethers|web3|deno|bun|electron|nest|remix|gatsby|astro|htmx|preact|redux|rx|video|plotly|tensorflow|pdf|handlebars|require|lodash|underscore|docs|lib)\.(?:js|rs)$/i;
const FILE_EXTENSION =
  "tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|php|cs|vue|svelte|sql|ya?ml|toml|md|json|html?|s?css|lock|env|sh";
const CODE_ROOT = "src|app|lib|components|pages|hooks|utils|tests?|server|api|packages";
const INSPECT =
  "checked|reviewed|inspected|read|audited|examined|scanned|analy[sz]ed|looked (?:at|through|into)|gone through";
const INSPECTING =
  "checking|reviewing|inspecting|reading|auditing|examining|scanning|analy[sz]ing|looking (?:at|through|into)|going through";
const CODEBASE = "code|codebase|repo|repository|source|source code|implementation";

/**
 * A model that has not read the repository must not name files, code symbols
 * or claim it inspected code. A heuristic, deliberately conservative: it is a
 * second line behind the prompt, not proof. Web addresses and framework names
 * ("Next.js") are not file references.
 */
export function mentionsRepoInternals(text: string): boolean {
  const prose = text
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    // bare domains with an optional path: example.com/pricing.html
    .replace(
      /\b[\w-]+(?:\.[\w-]+)*\.(?:com|dev|io|app|org|net|ai|co|xyz|me|sh|so|tech|site)\b(?:\/\S*)?/gi,
      " "
    );
  const fileNames =
    prose.match(new RegExp(`\\b[\\w-]+\\.(?:${FILE_EXTENSION})\\b(?![\\w.])`, "g")) ?? [];
  return (
    fileNames.some((name) => !NOT_A_FILE.test(name)) ||
    // a path under a conventional code root, with or without an extension
    new RegExp(`(?:^|[\\s("'\`])(?:\\.{0,2}\\/)?(?:${CODE_ROOT})\\/[\\w.-]+`, "i").test(
      prose
    ) ||
    // a named code symbol: "the handleSubmit function", "function handleSubmit"
    /\b[a-z]+[A-Z]\w*\s+(?:function|component|method|hook|class|handler|module)\b/.test(
      prose
    ) ||
    /\b(?:function|component|method|hook|class|handler)\s+`?[a-z]+[A-Z]\w*/.test(prose) ||
    new RegExp(
      `\\b(?:i|we)(?:'ve|\\s+have)?\\s+(?:${INSPECT})\\s+(?:the|your|this)\\s+(?:${CODEBASE})\\b`,
      "i"
    ).test(prose) ||
    new RegExp(`\\b(?:${INSPECTING})\\s+(?:the|your|this)\\s+(?:${CODEBASE})\\b`, "i").test(
      prose
    ) ||
    new RegExp(
      `\\b(?:in|from)\\s+(?:the|your)\\s+(?:${CODEBASE})\\s*,?\\s+(?:i|we)\\s+(?:found|saw|noticed)\\b`,
      "i"
    ).test(prose)
  );
}

export function normalizeWeeklyTaskIntake(raw: unknown): WeeklyTaskIntake | undefined {
  const item = asRecord(raw);
  const pain = clean(item.pain, WEEKLY_TASK_LIMITS.text);
  const successSignal = clean(item.successSignal, WEEKLY_TASK_LIMITS.text);
  const hours = Number(item.hoursAvailable);
  if (pain.length < 8 || successSignal.length < 8) return undefined;
  if (!Number.isFinite(hours) || hours < 0.5 || hours > 80) return undefined;
  return { pain, successSignal, hoursAvailable: Math.round(hours * 2) / 2 };
}

function itemList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((entry) => {
    const text = clean(entry, WEEKLY_TASK_LIMITS.item);
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return seen.size <= WEEKLY_TASK_LIMITS.items ? [text] : [];
  });
}

/**
 * Normalize a proposal against the CURRENT verified facts.
 * - model/example output: repository claims are refused, and a product
 *   improvement must cite at least one verified fact; otherwise it must be one
 *   of the "learn first" kinds and must state what is unknown.
 * - founder-written: their own words about their own product; only bounded.
 */
export function normalizeWeeklyTaskProposal(
  raw: unknown,
  facts: Fact[],
  source: "model" | "founder" | "example"
): WeeklyTaskProposal | undefined {
  const item = asRecord(raw);
  const guard = source !== "founder";
  const kind = asString(item.kind) as WeeklyTaskKind;
  const title = clean(item.title, WEEKLY_TASK_LIMITS.title);
  const rationale = clean(item.rationale, WEEKLY_TASK_LIMITS.text);
  if (!KINDS.includes(kind) || title.length < 4 || rationale.length < 8) return undefined;
  const known = new Set(trialProductFacts(facts).map((fact) => fact.id));
  const factIds = Array.isArray(item.factIds)
    ? Array.from(
        new Set(
          item.factIds.filter((id): id is string => typeof id === "string" && known.has(id))
        )
      ).slice(0, WEEKLY_TASK_LIMITS.items)
    : [];
  const proposal: WeeklyTaskProposal = {
    kind,
    title,
    rationale,
    factIds,
    minimalScope: itemList(item.minimalScope),
    assumptions: itemList(item.assumptions),
    nonGoals: itemList(item.nonGoals),
    acceptance: itemList(item.acceptance),
    tests: itemList(item.tests),
    unknowns: itemList(item.unknowns),
  };
  if (!proposal.minimalScope.length || !proposal.acceptance.length) return undefined;
  return guard && !agentProposalAllowed(proposal) ? undefined : proposal;
}

/**
 * Rules for text PostBeacon itself puts in front of the founder (model or
 * example). Any repository claim refuses the WHOLE proposal — silently
 * dropping one item would change what the founder reviews.
 */
export function agentProposalAllowed(proposal: WeeklyTaskProposal): boolean {
  if (proposal.kind === "product-improvement" && !proposal.factIds.length) return false;
  if (proposal.kind !== "product-improvement" && !proposal.unknowns.length) return false;
  return !proposalRepoClaim(proposal);
}

export function proposalRepoClaim(proposal: WeeklyTaskProposal): boolean {
  return planText(proposal).some(mentionsRepoInternals);
}

function planText(proposal: WeeklyTaskProposal): string[] {
  return [
    proposal.title,
    proposal.rationale,
    ...proposal.minimalScope,
    ...proposal.assumptions,
    ...proposal.nonGoals,
    ...proposal.acceptance,
    ...proposal.tests,
    ...proposal.unknowns,
  ];
}

const contentWords = (text: string) =>
  new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
const overlap = (words: Set<string>, reference: Set<string>) =>
  [...words].filter((word) => reference.has(word)).length / words.size;
const sameWords = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && overlap(a, b) === 1;

/**
 * Why evidence was refused, or the normalized evidence. A plan is not proof.
 * The wording checks catch empty, duplicated or copied-from-the-plan text; they
 * cannot tell whether the founder's account is true — nothing here can.
 */
export function checkWeeklyTaskEvidence(
  raw: unknown,
  proposal: WeeklyTaskProposal,
  at: string
): { evidence: WeeklyTaskEvidence } | { refusal: string } {
  const item = asRecord(raw);
  const changeSummary = clean(item.changeSummary, WEEKLY_TASK_LIMITS.evidence);
  const proof = clean(item.proof, WEEKLY_TASK_LIMITS.evidence);
  if (
    changeSummary.length < WEEKLY_TASK_LIMITS.minEvidence ||
    proof.length < WEEKLY_TASK_LIMITS.minEvidence
  )
    return {
      refusal:
        "Describe what actually changed and what you observed when checking it (at least a sentence each).",
    };
  const mine = [contentWords(changeSummary), contentWords(proof)];
  if (mine.some((words) => words.size < 4))
    return {
      refusal:
        "Say concretely what changed and what you saw — a few real words each, not filler.",
    };
  if (sameWords(mine[0], mine[1]))
    return {
      refusal:
        '"What changed" and "what you observed" must be two different things: the change, then the check.',
    };
  // Obvious restatement only: most of the wording already sits in the plan.
  const plan = contentWords(planText(proposal).join(" "));
  if (mine.some((words) => overlap(words, plan) >= 0.8))
    return {
      refusal:
        "That repeats the plan. Evidence is what you changed and what you saw afterwards, in your own words.",
    };
  const results = Array.isArray(item.results) ? item.results : [];
  if (
    results.length !== proposal.acceptance.length ||
    !results.every((r) => RESULTS.includes(r as WeeklyTaskScenarioResult))
  )
    return { refusal: "Record a result for every acceptance scenario." };
  if (results.includes("failed"))
    return {
      refusal:
        "A scenario failed. Reopen the task and keep building, or abandon it — it is not verified.",
    };
  if (results.includes("not-checked"))
    return {
      refusal:
        "Every acceptance scenario must be checked before the task counts as verified.",
    };
  let proofUrl: string | undefined;
  const rawUrl = asString(item.proofUrl).trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("unsupported");
      proofUrl = url.toString().slice(0, 2048);
    } catch {
      return {
        refusal: "The evidence link must be a plain http(s) URL, or leave it empty.",
      };
    }
  }
  return {
    evidence: {
      changeSummary,
      proof,
      ...(proofUrl ? { proofUrl } : {}),
      results: results as WeeklyTaskScenarioResult[],
      submittedAt: at,
    },
  };
}

/** Bring a persisted task back to a state the machine could actually have produced. */
export function normalizeWeeklyTask(raw: unknown): WeeklyTask | undefined {
  const item = asRecord(raw);
  const id = asString(item.id).slice(0, 80);
  const intake = normalizeWeeklyTaskIntake(item.intake);
  const createdAt = asString(item.createdAt);
  if (!id || !intake || !isIso(createdAt)) return undefined;
  let status = STATUSES.includes(item.status as WeeklyTaskStatus)
    ? (item.status as WeeklyTaskStatus)
    : "planning";
  const source = ["model", "founder", "example"].includes(asString(item.proposalSource))
    ? (item.proposalSource as WeeklyTask["proposalSource"])
    : undefined;
  // Stored proposals were validated against the facts of their own moment, so
  // fact ids are not re-resolved here; every other rule is applied again.
  const stored = asRecord(item.proposal);
  const kind = asString(stored.kind) as WeeklyTaskKind;
  const proposal: WeeklyTaskProposal | undefined =
    source && KINDS.includes(kind) && clean(stored.title, WEEKLY_TASK_LIMITS.title)
      ? {
          kind,
          title: clean(stored.title, WEEKLY_TASK_LIMITS.title),
          rationale: clean(stored.rationale, WEEKLY_TASK_LIMITS.text),
          factIds: Array.isArray(stored.factIds)
            ? stored.factIds
                .filter((v): v is string => typeof v === "string")
                .map((v) => v.slice(0, 80))
                .slice(0, WEEKLY_TASK_LIMITS.items)
            : [],
          minimalScope: itemList(stored.minimalScope),
          assumptions: itemList(stored.assumptions),
          nonGoals: itemList(stored.nonGoals),
          acceptance: itemList(stored.acceptance),
          tests: itemList(stored.tests),
          unknowns: itemList(stored.unknowns),
        }
      : undefined;
  const usable =
    proposal &&
    proposal.acceptance.length &&
    proposal.minimalScope.length &&
    proposal.rationale.length >= 8 &&
    // Founder-edited text is the founder's; untouched agent text keeps agent rules.
    (source === "founder" || item.founderEdited === true || agentProposalAllowed(proposal));
  const confirmedAt = isIso(asString(item.confirmedAt)) ? asString(item.confirmedAt) : "";
  const evidenceCheck =
    usable && item.evidence
      ? checkWeeklyTaskEvidence(
          item.evidence,
          proposal,
          asString(asRecord(item.evidence).submittedAt)
        )
      : undefined;
  const evidence =
    evidenceCheck &&
    "evidence" in evidenceCheck &&
    isIso(evidenceCheck.evidence.submittedAt)
      ? evidenceCheck.evidence
      : undefined;
  // Never load a state the evidence does not support.
  if (status !== "planning" && !usable) status = "planning";
  if (["building", "verifying", "verified"].includes(status) && !confirmedAt)
    status = "proposed";
  if (status === "verified" && !evidence) status = "verifying";
  const contextKey = asString(item.contextKey);
  const revision = Number(item.revision);
  const meta = asRecord(item.meta);
  const provider = asString(meta.provider);
  const confirmed = status !== "planning" && status !== "proposed";
  return {
    id,
    revision: Number.isInteger(revision) && revision > 0 ? revision : 1,
    status,
    intake,
    ...(status !== "planning" && contextKey && contextKey.length <= 200
      ? { contextKey }
      : {}),
    ...(status !== "planning" && usable ? { proposal, proposalSource: source } : {}),
    ...(status !== "planning" && item.founderEdited === true
      ? { founderEdited: true }
      : {}),
    ...(status !== "planning" &&
    source === "model" &&
    ["openai", "deepseek", "claude"].includes(provider)
      ? {
          meta: {
            provider: provider as ProviderRunMeta["provider"],
            model: asString(meta.model).slice(0, 80),
          },
        }
      : {}),
    ...(confirmed
      ? {
          confirmedAt,
          confirmedFacts: asRecordList(item.confirmedFacts)
            .slice(0, WEEKLY_TASK_LIMITS.items)
            .flatMap((fact) => {
              const factId = asString(fact.id).slice(0, 80);
              const claim = clean(fact.claim, WEEKLY_TASK_LIMITS.text);
              return factId && claim ? [{ id: factId, claim }] : [];
            }),
        }
      : {}),
    progress: confirmed
      ? asRecordList(item.progress)
          .flatMap((entry) => {
            const note = clean(entry.note, WEEKLY_TASK_LIMITS.text);
            const at = asString(entry.at);
            return note && isIso(at) ? [{ at, note }] : [];
          })
          .slice(-WEEKLY_TASK_LIMITS.progress)
      : [],
    ...(status === "verified" && evidence
      ? { evidence, verifiedAt: evidence.submittedAt }
      : {}),
    createdAt,
    updatedAt: isIso(asString(item.updatedAt)) ? asString(item.updatedAt) : createdAt,
    ...(item.example === true ? { example: true } : {}),
    ...(confirmed && asString(item.linkedPlannedExperimentId)
      ? { linkedPlannedExperimentId: asString(item.linkedPlannedExperimentId).slice(0, 80) }
      : {}),
  };
}

export function normalizeWeeklyTaskHistory(raw: unknown): WeeklyTaskRecord[] {
  const seen = new Set<string>();
  return asRecordList(raw)
    .flatMap((entry): WeeklyTaskRecord[] => {
      const id = asString(entry.id).slice(0, 80);
      const title = clean(entry.title, WEEKLY_TASK_LIMITS.title);
      const kind = asString(entry.kind) as WeeklyTaskKind;
      const outcome = asString(entry.outcome);
      const endedAt = asString(entry.endedAt);
      if (
        !id ||
        seen.has(id) ||
        !title ||
        !KINDS.includes(kind) ||
        (outcome !== "verified" && outcome !== "abandoned") ||
        !isIso(endedAt)
      )
        return [];
      seen.add(id);
      return [{ id, title, kind, outcome, endedAt }];
    })
    .slice(-WEEKLY_TASK_LIMITS.history);
}

/** Prefill from what the founder already confirmed; only the pain is always asked. */
export function weeklyTaskIntakeDefaults(workspace: WorkspaceState): {
  successSignal: string;
  hoursAvailable: string;
} {
  const contract = workspace.successContract;
  return {
    successSignal: contract
      ? `${contract.primaryGoal} — ${successContractSummary(contract)}`.slice(
          0,
          WEEKLY_TASK_LIMITS.text
        )
      : "",
    hoursAvailable: workspace.weeklyMinutes
      ? String(Math.max(0.5, Math.round(workspace.weeklyMinutes / 30) / 2))
      : "",
  };
}

/** Fictional demo proposal: built by code, no model call, always "learn first". */
export function exampleWeeklyTaskProposal(facts: Fact[]): WeeklyTaskProposal {
  const fact = trialProductFacts(facts)[0];
  return {
    kind: "usability-check",
    title: "Watch three people try the first-run flow (fictional example)",
    rationale:
      "Fictional example. There is no evidence yet about where new visitors get stuck, so the cheapest useful step is to observe real attempts before building anything.",
    factIds: fact ? [fact.id] : [],
    minimalScope: [
      "Ask three people who match the audience to complete the first task while you watch",
      "Write down the first point where each person hesitates or asks a question",
    ],
    assumptions: ["Three people can be reached this week (not verified)"],
    nonGoals: [
      "No new features this week",
      "No redesign of pages nobody was observed using",
    ],
    acceptance: [
      "Three separate attempts were observed from start to finish",
      "Each attempt has a written note of the first sticking point",
    ],
    tests: ["Record the three notes in one place so next week's task can cite them"],
    unknowns: [
      "Whether first-run confusion is the main reason visitors leave",
      "Whether these three people represent the wider audience",
    ],
  };
}

/**
 * Short, stable stand-in for the full product-version key, so a task stores a
 * few characters instead of the whole profile and ledger. Equality check only —
 * not a security hash.
 */
export function contextFingerprint(key: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b + code, 0x85ebca6b) ^ (b >>> 13);
  }
  return `${key.length}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

/* ------------------------------ state machine ------------------------------ */

export type WeeklyTaskCommand =
  | { type: "intake-saved"; id: string; revision?: number; intake: unknown; at: string }
  | {
      type: "proposal-received";
      taskId: string;
      revision: number;
      contextKey: string;
      proposal: unknown;
      source: "model" | "founder" | "example";
      meta?: ProviderRunMeta;
      at: string;
    }
  | {
      type: "proposal-edited";
      taskId: string;
      revision: number;
      proposal: unknown;
      at: string;
    }
  | { type: "replan-requested"; taskId: string; revision: number; at: string }
  | { type: "confirmed"; taskId: string; revision: number; at: string }
  | { type: "progress-noted"; taskId: string; revision: number; note: string; at: string }
  | { type: "ready-to-verify"; taskId: string; revision: number; at: string }
  | { type: "reopened"; taskId: string; revision: number; at: string }
  | {
      type: "evidence-submitted";
      taskId: string;
      revision: number;
      evidence: unknown;
      at: string;
    }
  | { type: "abandoned"; taskId: string; at: string }
  | { type: "closed"; taskId: string; at: string };

export interface WeeklyTaskContext {
  facts: Fact[];
  /** Exact current product/fact/contract version (lib/opportunityResearch researchContextKey). */
  contextKey: string;
  demo: boolean;
}

type TaskSlice = Pick<WorkspaceState, "weeklyTask" | "weeklyTaskHistory">;
export type WeeklyTaskResult =
  { ok: true; next: TaskSlice } | { ok: false; refusal: string };

const STALE =
  "This task changed since that view was loaded. Review the current version and try again.";
const refuse = (refusal: string): WeeklyTaskResult => ({ ok: false, refusal });

function archive(
  slice: TaskSlice,
  task: WeeklyTask,
  outcome: WeeklyTaskRecord["outcome"],
  at: string
): TaskSlice {
  const record: WeeklyTaskRecord[] = task.proposal
    ? [
        {
          id: task.id,
          title: task.proposal.title,
          kind: task.proposal.kind,
          outcome,
          endedAt: at,
        },
      ]
    : [];
  return {
    weeklyTask: undefined,
    weeklyTaskHistory: [
      ...(slice.weeklyTaskHistory ?? []).filter((item) => item.id !== task.id),
      ...record,
    ].slice(-WEEKLY_TASK_LIMITS.history),
  };
}

/**
 * The only way a weekly task changes. Refusals leave state untouched and say
 * why, so a duplicate click, a stale tab or an out-of-order response can never
 * advance the task.
 */
export function applyWeeklyTaskCommand(
  slice: TaskSlice,
  command: WeeklyTaskCommand,
  ctx: WeeklyTaskContext
): WeeklyTaskResult {
  const task = slice.weeklyTask;
  const keep = (next: WeeklyTask): WeeklyTaskResult => ({
    ok: true,
    next: {
      weeklyTask: { ...next, revision: (task?.revision ?? 0) + 1, updatedAt: command.at },
      weeklyTaskHistory: slice.weeklyTaskHistory,
    },
  });
  if (!isIso(command.at)) return refuse("Invalid timestamp.");

  if (command.type === "intake-saved") {
    const intake = normalizeWeeklyTaskIntake(command.intake);
    if (!intake)
      return refuse(
        "Describe the user pain and the success signal in a sentence each, and give 0.5–80 hours."
      );
    if (!task) {
      const id = command.id.slice(0, 80);
      if (!id) return refuse("Missing task id.");
      return keep({
        id,
        revision: 0,
        status: "planning",
        intake,
        progress: [],
        createdAt: command.at,
        updatedAt: command.at,
        ...(ctx.demo ? { example: true } : {}),
      });
    }
    if (task.id !== command.id || task.revision !== command.revision) return refuse(STALE);
    if (task.status !== "planning" && task.status !== "proposed")
      return refuse(
        "This task is already confirmed. Abandon it to start over with different inputs."
      );
    // New inputs make the old proposal an answer to a different question.
    return keep({
      id: task.id,
      revision: task.revision,
      status: "planning",
      intake,
      progress: [],
      createdAt: task.createdAt,
      updatedAt: command.at,
      ...(task.example ? { example: true } : {}),
    });
  }

  if (!task || task.id !== command.taskId) return refuse(STALE);

  switch (command.type) {
    case "proposal-received": {
      if (task.revision !== command.revision || task.status !== "planning")
        return refuse(STALE);
      if (command.contextKey !== ctx.contextKey)
        return refuse(
          "Your product facts changed while this was being planned. The old proposal was discarded; plan again."
        );
      // The demo never holds model output; real projects never hold example text.
      if (command.source === (ctx.demo ? "model" : "example"))
        return refuse(
          ctx.demo
            ? "The fictional demo does not call a model."
            : "Example proposals exist only in the fictional demo."
        );
      const proposal = normalizeWeeklyTaskProposal(
        command.proposal,
        ctx.facts,
        command.source
      );
      if (!proposal)
        return refuse(
          command.source === "founder"
            ? "Give the task a title, a reason, at least one scope item and one acceptance scenario."
            : "The proposal was not grounded in your verified facts, so it was discarded. Your task is unchanged."
        );
      return keep({
        ...task,
        status: "proposed",
        contextKey: command.contextKey,
        proposal,
        proposalSource: command.source,
        founderEdited: undefined,
        meta: command.source === "model" ? command.meta : undefined,
      });
    }
    case "proposal-edited": {
      if (task.revision !== command.revision || task.status !== "proposed")
        return refuse(STALE);
      // An edited proposal is the founder's text; fact references stay code-resolved.
      const proposal = normalizeWeeklyTaskProposal(command.proposal, ctx.facts, "founder");
      if (!proposal)
        return refuse(
          "Keep a title, a reason, at least one scope item and one acceptance scenario."
        );
      return keep({ ...task, proposal, founderEdited: true });
    }
    case "replan-requested":
      if (task.revision !== command.revision || task.status !== "proposed")
        return refuse(STALE);
      return keep({
        id: task.id,
        revision: task.revision,
        status: "planning",
        intake: task.intake,
        progress: [],
        createdAt: task.createdAt,
        updatedAt: command.at,
        ...(task.example ? { example: true } : {}),
      });
    case "confirmed": {
      if (
        task.revision !== command.revision ||
        task.status !== "proposed" ||
        !task.proposal
      )
        return refuse(STALE);
      if (task.contextKey !== ctx.contextKey)
        return refuse(
          "Your product facts changed after this proposal was written. Plan again before confirming."
        );
      const claims = new Map(ctx.facts.map((fact) => [fact.id, fact.claim]));
      return keep({
        ...task,
        status: "building",
        confirmedAt: command.at,
        confirmedFacts: task.proposal.factIds.flatMap((id) => {
          const claim = claims.get(id);
          return claim ? [{ id, claim }] : [];
        }),
      });
    }
    case "progress-noted": {
      const note = clean(command.note, WEEKLY_TASK_LIMITS.text);
      if (task.revision !== command.revision || task.status !== "building")
        return refuse(STALE);
      if (!note) return refuse("Write a short progress note.");
      return keep({
        ...task,
        progress: [...task.progress, { at: command.at, note }].slice(
          -WEEKLY_TASK_LIMITS.progress
        ),
      });
    }
    case "ready-to-verify":
      if (task.revision !== command.revision || task.status !== "building")
        return refuse(STALE);
      return keep({ ...task, status: "verifying" });
    case "reopened":
      if (task.revision !== command.revision || task.status !== "verifying")
        return refuse(STALE);
      return keep({ ...task, status: "building" });
    case "evidence-submitted": {
      if (
        task.revision !== command.revision ||
        task.status !== "verifying" ||
        !task.proposal
      )
        return refuse(STALE);
      const checked = checkWeeklyTaskEvidence(command.evidence, task.proposal, command.at);
      if ("refusal" in checked) return refuse(checked.refusal);
      return keep({
        ...task,
        status: "verified",
        evidence: checked.evidence,
        verifiedAt: command.at,
      });
    }
    case "abandoned":
      if (task.status === "verified") return refuse(STALE);
      return { ok: true, next: archive(slice, task, "abandoned", command.at) };
    case "closed":
      if (task.status !== "verified") return refuse(STALE);
      return { ok: true, next: archive(slice, task, "verified", command.at) };
  }
}

/* -------------------------------- Build Brief ------------------------------- */

const bullets = (items: string[], empty: string) =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;

/**
 * The hand-off for a coding agent. Rendered by code from the reviewed proposal,
 * so it cannot contain anything the founder did not see. It states plainly
 * that no repository was read.
 */
export function renderBuildBrief(
  task: WeeklyTask,
  product: { name: string; url: string },
  facts: Fact[]
): string {
  const proposal = task.proposal;
  if (!proposal) return "";
  const cited =
    task.confirmedFacts ??
    proposal.factIds.flatMap((id) => {
      const fact = facts.find((item) => item.id === id);
      return fact ? [{ id, claim: fact.claim }] : [];
    });
  const section = (heading: string, lines: string[]) =>
    `## ${heading}\n\n${lines.join("\n")}`;
  const hours = task.intake.hoursAvailable;
  return [
    `# Build Brief — ${proposal.title}`,
    ...(task.example
      ? ["> FICTIONAL EXAMPLE — demo data, not a real product decision."]
      : []),
    section("Background", [
      `- Product: ${product.name || "Untitled"}${product.url ? ` (${product.url})` : ""}`,
      `- User pain this week (founder's words): ${task.intake.pain}`,
      `- Task type: ${WEEKLY_TASK_KIND_LABEL[proposal.kind]}`,
      `- Why this task: ${proposal.rationale}`,
      "- Verified product facts this relies on:",
      ...(cited.length
        ? cited.map((fact) => `  - ${fact.claim}`)
        : ["  - None cited. Treat the reasoning above as an untested hypothesis."]),
    ]),
    section("Goal", [
      `- Success signal: ${task.intake.successSignal}`,
      `- Time budget: about ${hours} hour${hours === 1 ? "" : "s"} this week`,
    ]),
    section("Scope (smallest version)", [bullets(proposal.minimalScope, "Not specified.")]),
    section("Boundaries — do not do", [
      bullets(proposal.nonGoals, "Nothing beyond the scope above."),
      "- Do not expand scope, refactor unrelated code or add dependencies without asking.",
    ]),
    section("Assumptions", [bullets(proposal.assumptions, "None stated.")]),
    section("Unknowns", [bullets(proposal.unknowns, "None stated.")]),
    section(
      "Acceptance scenarios",
      proposal.acceptance.map((item, index) => `${index + 1}. ${item}`)
    ),
    section("Test requirements", [
      bullets(proposal.tests, "Cover each acceptance scenario with an automated test."),
      "- Run the project's existing tests and report the real result, including failures.",
    ]),
    section("Repository note", [
      "PostBeacon has NOT read the repository, and nothing above was checked against the code. Inspect the codebase first, say where the change belongs, and ask before editing if the scope does not fit what you find.",
    ]),
    section("When you finish, report", [
      "- What changed (plain language) and anything left undone.",
      "- How each acceptance scenario was checked and what was observed.",
    ]),
  ].join("\n\n");
}
