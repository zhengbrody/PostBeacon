"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { VARIABLE_LABELS } from "@/lib/experimentQueue";
import type {
  AngleRecord,
  Experiment,
  MarketingStrategy,
  PlannedExperiment,
} from "@/lib/types";

/** Explicit confirmation creates work, never a publication or invented result. */
export function NextExperimentChoices({
  experiment,
  strategy,
  queue,
  loading,
  onPlan,
  onStop,
  evidenceState,
}: {
  experiment: Experiment;
  strategy: MarketingStrategy | null;
  queue: PlannedExperiment[];
  loading: boolean;
  onPlan: (plan: PlannedExperiment) => void;
  onStop: () => void;
  evidenceState?: AngleRecord["evidenceState"];
}) {
  const [choice, setChoice] = useState<"hook" | "venue" | "stop">();
  const [platformId, setPlatformId] = useState(experiment.platformId);
  const [venue, setVenue] = useState("");
  const queued = queue.some(
    (item) =>
      item.sourceExperimentId === experiment.id &&
      item.status !== "cancelled" &&
      item.status !== "published"
  );
  const platform = strategy?.recommendations.find((item) => item.platformId === platformId);
  function confirm() {
    if (choice === "stop") {
      onStop();
      setChoice(undefined);
      return;
    }
    if (!choice || queued) return;
    const snapshot = experiment.snapshot;
    onPlan({
      id: crypto.randomUUID(),
      templateId: `follow-up:${choice}`,
      sourceExperimentId: experiment.id,
      sourceOutcomeId: experiment.outcomes.at(-1)?.id,
      platformId: choice === "hook" ? experiment.platformId : platformId,
      platformName:
        choice === "hook"
          ? experiment.platformName
          : (platform?.platformName ?? experiment.platformName),
      venue: choice === "hook" ? experiment.community : venue.trim(),
      angle: experiment.angle,
      variable: snapshot ? choice : "exploratory",
      heldConstant: !snapshot
        ? "Legacy published body unavailable; exploratory test, no controlled comparison"
        : choice === "hook"
          ? "Intended: preserve body, angle, venue and evidence. Publish verifies the actual snapshot."
          : "Intended: same angle, another venue. Native-format changes may make this exploratory.",
      successContract: experiment.successContract,
      status: "planned",
      createdAt: new Date().toISOString(),
    });
    setChoice(undefined);
  }
  return (
    <div className="mt-5 rounded-xl border border-line bg-surface-2/40 p-4">
      <div
        className="mb-4 border-b border-line pb-3 text-xs text-neutral-400"
        role="status"
      >
        <p className="font-semibold text-neutral-200">Learning receipt</p>
        <p className="mt-1">
          Result: {experiment.outcomes.at(-1)?.checkpoint || "none"} ·{" "}
          {experiment.outcomes.at(-1)?.verdict?.assessment?.replaceAll("-", " ") ||
            "historical read"}
        </p>
        <p>
          Angle evidence:{" "}
          {evidenceState || "not added — legacy, early, unavailable or invalid evidence"}
        </p>
        <p>
          Next move: {queued ? "confirmed and queued" : "awaiting your decision"}. The
          strategy is not silently overwritten.
        </p>
      </div>
      <h3 className="text-sm font-semibold">Choose the next experiment</h3>
      <p className="mt-1 text-xs text-neutral-400">
        One observation is not proof of causality. Review what is still unknown before
        committing more time.
      </p>
      {queued ? (
        <p className="mt-3 text-sm text-emerald-300" role="status">
          Next experiment saved in your queue. Continue from Today.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={loading}
            onClick={() => setChoice("hook")}
          >
            Same channel, new hook
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={loading}
            onClick={() => setChoice("venue")}
          >
            Same angle, another venue
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled={loading}
            onClick={() => setChoice("stop")}
          >
            Pause this experiment
          </Button>
        </div>
      )}
      {choice && !queued && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {choice === "venue" && (
            <>
              <label className="block text-xs text-neutral-400">
                Channel
                <select
                  className="mt-1 min-h-11 w-full rounded-md border border-line bg-surface-2 px-2"
                  value={platformId}
                  onChange={(event) => setPlatformId(event.target.value)}
                >
                  {strategy?.recommendations.map((item) => (
                    <option key={item.platformId} value={item.platformId}>
                      {item.platformName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-neutral-400">
                Specific venue · confirm its current rules
                <input
                  maxLength={200}
                  value={venue}
                  onChange={(event) => setVenue(event.target.value)}
                  placeholder="e.g. a named community or audience"
                  className="mt-1 min-h-11 w-full rounded-md border border-line bg-surface-2 px-2"
                />
              </label>
            </>
          )}
          <p className="text-xs text-neutral-400">
            {choice === "stop"
              ? "Stops this execution and its check-ins. The original post, history and other experiments are not changed."
              : "Saves one planned experiment. Preparing its draft is a separate action; publishing remains manual."}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={
                loading ||
                (choice === "venue" &&
                  (!venue.trim() ||
                    (platformId === experiment.platformId &&
                      venue.trim() === experiment.community)))
              }
              onClick={confirm}
            >
              {choice === "stop" ? "Confirm pause" : "Confirm next experiment"}
            </Button>
            <Button variant="ghost" onClick={() => setChoice(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlannedExperimentQueue({
  queue,
  loading,
  demo = false,
  onPrepare,
  onOpen,
  onCancel,
}: {
  queue: PlannedExperiment[];
  loading: boolean;
  demo?: boolean;
  onPrepare: (id: string) => void;
  onOpen: (plan: PlannedExperiment) => void;
  onCancel: (id: string) => void;
}) {
  const active = queue.filter(
    (item) => item.status === "planned" || item.status === "ready"
  );
  if (!active.length) return null;
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold">Your next experiments · {active.length}</h3>
      <p className="mt-1 text-xs text-neutral-500">
        {demo ? "Temporary example queue — never saved." : "Saved with this project."}{" "}
        Nothing is posted automatically.
      </p>
      <div className="mt-4 space-y-3">
        {active.map((item) => (
          <div key={item.id} className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium">
              {item.platformName} · {VARIABLE_LABELS[item.variable]}
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              {item.venue || "Venue not confirmed"} · {item.angle}
            </p>
            <p className="mt-1 text-xs text-neutral-500">{item.heldConstant}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="min-h-11"
                disabled={loading}
                onClick={() =>
                  item.status === "ready" ? onOpen(item) : onPrepare(item.id)
                }
              >
                {item.status === "ready"
                  ? "Review prepared draft"
                  : "Prepare this experiment"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                disabled={loading}
                onClick={() => onCancel(item.id)}
              >
                Cancel planned experiment
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
