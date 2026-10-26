"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { useAgentMission } from "@/hooks/useAgentMission";
import {
  agentMissionSettingsSchema,
  type AgentMission,
  type AgentMissionSettings,
} from "@/lib/agentMissions";
import { normalizeAutonomousSearch } from "@/lib/autonomousResearch";
import { researchContextKey } from "@/lib/opportunityResearch";
import { successContractSummary } from "@/lib/successContract";
import { createTrialBrief } from "@/lib/trialBrief";
import type {
  Fact,
  ProductProfile,
  SuccessContract,
  TrialResearchInput,
} from "@/lib/types";

interface MissionEditor {
  scope: string;
  contextKey: string;
  brief: TrialResearchInput;
  queries: string;
  domains: string;
  publicSearch: boolean;
  openaiProcessing: boolean;
  receipt: string;
  example: AgentMission | null;
}

/** A standing delegation is separate from a one-off trial kit. Real authorization
 * is server-owned; the fictional preview is explicitly ephemeral and makes no calls. */
export function DailyResearchMission({
  ownerId,
  projectId,
  demo,
  profile,
  facts,
  contract,
  productUrl,
  bannedClaims,
  initialBrief,
  onRunsChanged,
}: {
  ownerId: string | null | undefined;
  projectId: string;
  demo: boolean;
  profile: ProductProfile;
  facts: Fact[];
  contract: SuccessContract;
  productUrl: string;
  bannedClaims: string[];
  initialBrief?: TrialResearchInput;
  onRunsChanged?: () => void;
}) {
  const remote = useAgentMission(ownerId, projectId, demo);
  const scope = `${ownerId ?? ""}:${projectId}:${demo}`;
  const contextKey = researchContextKey(profile, facts, contract, productUrl, bannedClaims);
  const defaults = (): MissionEditor => ({
    scope,
    contextKey,
    brief: {
      ...(initialBrief ?? createTrialBrief(profile, productUrl)),
      mode: "product-led",
      sources: [],
    },
    queries: "",
    domains: "",
    publicSearch: false,
    openaiProcessing: false,
    receipt: "",
    example: null,
  });
  const [state, setState] = useState<MissionEditor>(defaults);
  // Hide old account inputs on the first render, before any cleanup effect runs.
  const editor =
    state.scope === scope && state.contextKey === contextKey ? state : defaults();
  const mission = demo ? editor.example : remote.mission;
  const stale = Boolean(mission && mission.contextKey !== contextKey);
  const expired = Boolean(mission && Date.parse(mission.expiresAt) <= Date.now());
  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const settings: AgentMissionSettings = {
    brief: editor.brief,
    searchQueries: lines(editor.queries),
    allowedDomains: lines(editor.domains),
    enabled: true,
  };
  const unsavedChanges = Boolean(
    mission &&
    (JSON.stringify(settings.brief) !== JSON.stringify(mission.settings.brief) ||
      JSON.stringify(settings.searchQueries) !==
        JSON.stringify(mission.settings.searchQueries) ||
      JSON.stringify(settings.allowedDomains) !==
        JSON.stringify(mission.settings.allowedDomains))
  );
  const valid =
    agentMissionSettingsSchema.safeParse(settings).success &&
    Boolean(
      normalizeAutonomousSearch({
        queries: settings.searchQueries,
        domains: settings.allowedDomains,
      })
    ) &&
    contextKey.length <= 50_000;
  const canWrite =
    demo || (remote.enabled && !remote.checking && Boolean(ownerId && projectId));
  const canAuthorize =
    canWrite && valid && editor.publicSearch && editor.openaiProcessing && !remote.busy;
  const update = (patch: Partial<MissionEditor>) =>
    setState((previous) => ({
      ...(previous.scope === scope && previous.contextKey === contextKey
        ? previous
        : defaults()),
      ...patch,
      publicSearch: false,
      openaiProcessing: false,
      receipt: "",
    }));
  const updateBrief = (patch: Partial<TrialResearchInput>) =>
    update({ brief: { ...editor.brief, ...patch, mode: "product-led", sources: [] } });
  const acknowledge = (patch: Partial<MissionEditor>) =>
    setState((previous) => ({
      ...(previous.scope === scope && previous.contextKey === contextKey
        ? previous
        : defaults()),
      receipt: "",
      ...patch,
    }));

  const authorize = async () => {
    if (!canAuthorize) return;
    if (demo) {
      const now = new Date().toISOString();
      acknowledge({
        example: {
          id: "example-mission",
          projectId,
          revision: (mission?.revision ?? 0) + 1,
          contextKey,
          settings,
          enabled: true,
          createdAt: mission?.createdAt ?? now,
          updatedAt: now,
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
        receipt:
          "Example authorization saved in this view only. No scheduler, search or model was started.",
        publicSearch: false,
        openaiProcessing: false,
      });
      return;
    }
    acknowledge({ receipt: "" });
    const result = await remote.command({
      action: "save",
      projectId,
      contextKey,
      expectedRevision: mission?.revision ?? null,
      settings,
      consent: {
        publicSearch: editor.publicSearch,
        openaiProcessing: editor.openaiProcessing,
      },
    });
    if (result?.mission)
      acknowledge({
        receipt: `Daily authorization saved · revision ${result.mission.revision}. No post was sent.`,
        publicSearch: false,
        openaiProcessing: false,
      });
  };
  const pause = async () => {
    if (!mission || remote.busy) return;
    if (demo) {
      acknowledge({
        example: {
          ...mission,
          enabled: false,
          settings: { ...mission.settings, enabled: false },
        },
        receipt: "Example paused. No real background task existed or was cancelled.",
      });
      return;
    }
    acknowledge({ receipt: "" });
    const result = await remote.command({ action: "pause", projectId });
    if (result?.mission && !result.mission.enabled)
      acknowledge({
        receipt:
          "Daily authorization paused. No future check may start from this authorization; an already-sent provider request cannot be recalled.",
      });
  };
  const runNow = async () => {
    if (!mission?.enabled || stale || expired || !canWrite || remote.busy) return;
    if (demo) {
      acknowledge({
        receipt:
          "Example check preview: a real check would search only your approved queries and domains, then require kit review. No search, model or scheduler call occurred.",
      });
      return;
    }
    acknowledge({ receipt: "" });
    const result = await remote.command({
      action: "run-now",
      projectId,
      contextKey,
      expectedRevision: mission.revision,
    });
    if (result?.run) {
      acknowledge({
        receipt:
          "Check request received. See the actual task receipt in Growth Agent, then review its result before adding a trial to Today.",
      });
      remote.refresh();
      onRunsChanged?.();
    }
  };
  const loadSaved = () => {
    if (!mission) return;
    update({
      brief: mission.settings.brief,
      queries: mission.settings.searchQueries.join("\n"),
      domains: mission.settings.allowedDomains.join("\n"),
    });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-300">
            Growth Agent · daily delegation
          </p>
          <h3 className="mt-2 text-xl font-semibold">
            Research while you are away. You still approve what ships.
          </h3>
        </div>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-neutral-400">
          {demo
            ? "Example only"
            : remote.checking
              ? "Checking availability"
              : !remote.enabled
                ? "Execution not enabled"
                : mission?.enabled
                  ? stale || expired
                    ? "Re-approval needed"
                    : "Daily authorization on"
                  : mission
                    ? "Paused"
                    : "Not authorized"}
        </span>
      </div>
      <p className="mt-3 text-sm text-neutral-400">
        For {profile.name}: search approved public pages and prepare a reviewable trial
        invitation. No automatic posting, replies, contact collection, or social-account
        connection.
      </p>
      <p className="mt-2 text-xs text-neutral-400">
        Goal: {successContractSummary(contract)}. At most one check per authorization
        revision per UTC day, including “Check now”; changing the authorization creates a
        new revision. Shared limits are 10 checks per user and 100 globally per day. This
        pilot checks at most three delegations per daily scheduler trigger, not continuous
        monitoring. Delivery time is not guaranteed, and service/API costs may apply.
        Authorization expires after 30 days; review and save again to renew it explicitly.
      </p>
      {demo ? (
        <p className="mt-3 rounded-lg border border-accent-500/30 p-3 text-xs text-accent-200">
          Example only: no scheduler, search or model calls. Changes are not saved to your
          account or browser storage.
        </p>
      ) : !remote.enabled && !remote.checking ? (
        <p className="mt-3 rounded-lg border border-line p-3 text-sm text-neutral-400">
          Daily execution is not enabled for this deployment. You can prepare these
          settings, but saving, enabling and checking are unavailable. Existing
          authorizations can still be paused.
        </p>
      ) : null}
      {mission ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-sm font-medium">
            Saved delegation · revision {mission.revision} ·{" "}
            {mission.enabled ? "authorized" : "paused"}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {stale
              ? "Your product facts, voice restrictions or success goal changed. Save a fresh authorization before another check."
              : "Saved context matches the current product facts and goal."}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {mission.lastRunAt
              ? `Last check reserved: ${mission.lastRunAt}. This is not proof that a useful opportunity was found.`
              : "No check reservation is recorded for this delegation."}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {expired
              ? "Authorization expired. Review and save again before another check."
              : `Authorization expires: ${mission.expiresAt}. No automatic renewal.`}
          </p>
          {mission.enabled && unsavedChanges ? (
            <p className="mt-2 text-xs text-amber-300">
              Unsaved form changes do not change or pause this saved authorization. Pause
              research to stop future checks, or review and save the new settings
              explicitly.
            </p>
          ) : null}
          <details className="mt-3 text-xs text-neutral-400">
            <summary className="cursor-pointer py-2">
              Review approved search and Brief
            </summary>
            <div className="mt-2 space-y-2 break-words">
              <p>Audience: {mission.settings.brief.audience}</p>
              <p>Task: {mission.settings.brief.task}</p>
              <p>Queries: {mission.settings.searchQueries.join(" · ")}</p>
              <p>Exact domains: {mission.settings.allowedDomains.join(" · ")}</p>
              <p>
                Search matches and fetched quotes are not verified demand or permission to
                post. Empty results remain empty.
              </p>
            </div>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!mission.enabled || stale || expired || !canWrite || remote.busy}
              onClick={() => void runNow()}
            >
              {demo ? "Preview a check" : "Check now"}
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!mission.enabled || remote.busy}
              onClick={() => void pause()}
            >
              Pause daily research
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={remote.busy}
              onClick={loadSaved}
            >
              Edit saved delegation
            </Button>
          </div>
        </div>
      ) : null}
      <details className="mt-4 rounded-lg border border-line p-4">
        <summary className="cursor-pointer py-1 text-sm font-medium">
          {mission ? "Prepare a new authorization" : "Set up your daily research"}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Daily research audience"
              value={editor.brief.audience}
              onChange={(audience) => updateBrief({ audience })}
            />
            <Field
              label="Daily research trial task"
              value={editor.brief.task}
              onChange={(task) => updateBrief({ task })}
            />
          </div>
          <Field
            label="Daily research feedback question"
            value={editor.brief.feedbackQuestion}
            onChange={(feedbackQuestion) => updateBrief({ feedbackQuestion })}
          />
          <Field
            label="Daily research approved product entry"
            value={editor.brief.entryUrl}
            onChange={(entryUrl) => updateBrief({ entryUrl })}
          />
          <Field
            label="Daily research public search queries — one per line, 1–3"
            textarea
            value={editor.queries}
            onChange={(queries) => update({ queries })}
            placeholder="Public product problem or workflow; no names, email addresses, customer quotes or secrets"
          />
          <Field
            label="Daily research allowed domains — exact hostnames, one per line, 1–5"
            textarea
            value={editor.domains}
            onChange={(domains) => update({ domains })}
            placeholder="example.org\ndocs.example.org"
          />
          <p className="text-xs text-neutral-400">
            Only these exact hosts may be selected and fetched; subdomains are not
            automatically allowed. Restricted social platforms are excluded. Search queries
            go to Tavily; necessary verified product facts, your Brief and filtered public
            excerpts go to OpenAI. No DeepSeek fallback. Do not include private data or
            personal identifiers.
          </p>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer py-1 text-sm text-neutral-300">
              Review trial steps and manual publishing venue
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-neutral-400">
                Publishing channel: {editor.brief.platformId}. This delegation cannot post
                there.
              </p>
              <Field
                label="Daily research manual publishing venue"
                value={editor.brief.venue}
                onChange={(venue) => updateBrief({ venue })}
              />
              {editor.brief.steps.map((step, index) => (
                <Field
                  key={index}
                  label={`Daily research trial step ${index + 1}`}
                  value={step}
                  onChange={(value) => {
                    const steps: TrialResearchInput["steps"] = [...editor.brief.steps];
                    steps[index] = value;
                    updateBrief({ steps });
                  }}
                />
              ))}
            </div>
          </details>
          {!valid ? (
            <p className="text-xs text-amber-300">
              Complete the Brief, 1–3 distinct public queries (3–160 characters) and 1–5
              exact public hostnames. URLs, restricted social sites, personal identifiers
              and secrets are not approved search input.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={editor.publicSearch}
              onChange={(event) => acknowledge({ publicSearch: event.target.checked })}
            />
            I approve sending only these public, non-sensitive queries to Tavily for daily
            research on these domains.
          </label>
          <label className="flex items-start gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={editor.openaiProcessing}
              onChange={(event) => acknowledge({ openaiProcessing: event.target.checked })}
            />
            I approve sending the necessary verified product facts, this Brief and filtered
            public excerpts to OpenAI to prepare drafts. Publication still requires my
            review.
          </label>
          <p className="text-xs text-neutral-500">
            Editing any input clears both approvals. Saving is explicit; typing does not
            send search or model requests. You may pause later.
          </p>
          <Button
            className="min-h-11"
            disabled={!canAuthorize}
            onClick={() => void authorize()}
          >
            {remote.busy
              ? "Saving authorization…"
              : demo
                ? "Preview daily authorization"
                : "Save & authorize daily research"}
          </Button>
        </div>
      </details>
      {!demo ? (
        <Button
          variant="ghost"
          className="mt-3 min-h-11"
          disabled={remote.busy || !ownerId || !projectId}
          onClick={remote.refresh}
        >
          Refresh daily status
        </Button>
      ) : null}
      {editor.receipt ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-accent-500/30 p-3 text-sm text-accent-200"
        >
          {editor.receipt}
        </p>
      ) : null}
      {remote.error ? (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {remote.error}
        </p>
      ) : null}
    </Card>
  );
}
