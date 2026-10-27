"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useBufferPublishing } from "@/hooks/useBufferPublishing";
import { bufferDraftIssues, bufferScheduleAllowed } from "@/lib/bufferPublishing";
import { productTrialEntry, researchContextKey } from "@/lib/opportunityResearch";
import type { BufferConnection } from "@/lib/bufferConnections";
import type { BufferDelivery } from "@/lib/bufferPublishing";
import type {
  Fact,
  GenerateResult,
  ProductProfile,
  SuccessContract,
  PlannedExperiment,
} from "@/lib/types";

const statusLabel: Record<BufferDelivery["status"], string> = {
  "awaiting-approval": "Needs your approval",
  sending: "Sending request — not a confirmed post",
  scheduled: "Scheduled in Buffer — not published",
  published: "Buffer reports sent",
  failed: "Stopped — inspect the receipt",
  unknown: "Status unknown — do not resend",
  cancelled: "Cancelled locally",
  expired: "Approval expired",
};

export function scheduleUtc(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return;
  const date = new Date(`${value}:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value) return;
  return date.toISOString();
}

const exampleConnection: BufferConnection = {
  id: "00000000-0000-4000-8000-000000000050",
  revision: 1,
  status: "connected",
  accountLabel: "Fictional Buffer account",
  channels: [
    {
      id: "example-x",
      name: "Example X profile — not connected",
      service: "twitter",
      organizationId: "example",
    },
    {
      id: "example-linkedin",
      name: "Example LinkedIn profile — not connected",
      service: "linkedin",
      organizationId: "example",
    },
  ],
};

export function BufferPublishingCard({
  ownerId,
  projectId,
  demo,
  result,
  profile,
  facts,
  contract,
  plans,
  bannedClaims,
  productUrl,
}: {
  ownerId: string | null | undefined;
  projectId: string;
  demo: boolean;
  result: GenerateResult;
  profile: ProductProfile;
  facts: Fact[];
  contract: SuccessContract;
  plans: PlannedExperiment[];
  bannedClaims: string[];
  productUrl: string;
}) {
  const remote = useBufferPublishing(ownerId, projectId, demo);
  const formId = useId();
  const scope = `${ownerId ?? ""}:${projectId}:${demo}`;
  const context = researchContextKey(profile, facts, contract, productUrl, bannedClaims);
  const candidates = useMemo(
    () =>
      result.content.flatMap((content) =>
        content.platformId === "twitter" || content.platformId === "linkedin"
          ? content.posts.slice(0, 12).map((post, postIdx) => {
              const platformId = content.platformId as "twitter" | "linkedin";
              const planned = plans.find(
                (plan) =>
                  plan.platformId === platformId &&
                  plan.postIdx === postIdx &&
                  plan.opportunity
              );
              return {
                platformId,
                postIdx,
                post,
                planned,
                label: `${content.platformName} · draft ${postIdx + 1}`,
                issues: bufferDraftIssues({
                  post,
                  profile,
                  facts,
                  platformId,
                  postIdx,
                  plans,
                  contextKey: context,
                  bannedClaims,
                  approvedEntry:
                    planned?.opportunity?.entryUrl ?? productTrialEntry(productUrl),
                }),
              };
            })
          : []
      ),
    [result, profile, facts, plans, context, bannedClaims, productUrl]
  );
  const [selection, setSelection] = useState("");
  const selected =
    candidates.find((item) => `${item.platformId}:${item.postIdx}` === selection) ??
    candidates.find((item) => !item.issues.length) ??
    candidates[0];
  const connection = demo ? exampleConnection : remote.connection;
  const [channelId, setChannelId] = useState("");
  const channels =
    connection?.channels.filter((item) => item.service === selected?.platformId) ?? [];
  const channel = channels.find((item) => item.id === channelId) ?? channels[0];
  const [when, setWhen] = useState("");
  const scheduledAt = scheduleUtc(when);
  const [review, setReview] = useState<{
    scope: string;
    stamp: string;
    delivery: BufferDelivery;
  } | null>(null);
  const [ack, setAck] = useState("");
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [disconnectScope, setDisconnectScope] = useState<string | null>(null);
  const disconnectArmed = disconnectScope === scope;
  const [callbackPresent, setCallbackPresent] = useState(false);
  useEffect(() => {
    setCallbackPresent(
      new URL(window.location.href).searchParams.get("buffer") === "finish"
    );
  }, [scope]);
  const text = selected ? `${selected.post.hook}\n\n${selected.post.body}` : "";
  const stamp = JSON.stringify({
    scope,
    text,
    platformId: selected?.platformId,
    postIdx: selected?.postIdx,
    connectionId: connection?.id,
    revision: connection?.revision,
    channelId: channel?.id,
    scheduledAt,
    context,
    planned: selected?.planned,
  });
  const storedReview = review?.scope === scope ? review : null;
  const latestReceipt =
    !demo && storedReview
      ? remote.deliveries.find((item) => item.id === storedReview.delivery.id)
      : undefined;
  const currentReview = storedReview
    ? { ...storedReview, delivery: latestReceipt ?? storedReview.delivery }
    : null;
  const unchanged = Boolean(
    currentReview && currentReview.stamp === stamp && currentReview.delivery.body === text
  );
  const awaiting = currentReview?.delivery.status === "awaiting-approval";
  const expired = Boolean(
    currentReview && Date.parse(currentReview.delivery.expiresAt) <= Date.now()
  );
  const issues = selected?.issues ?? ["Prepare an X or LinkedIn draft first."];
  const eligible = Boolean(
    (demo || remote.enabled) &&
    connection?.status === "connected" &&
    selected &&
    channel &&
    scheduledAt &&
    !issues.length &&
    !remote.busy
  );
  const canPrepare = Boolean(eligible && scheduledAt && bufferScheduleAllowed(scheduledAt));
  const canApprove = Boolean(
    eligible &&
    unchanged &&
    awaiting &&
    !expired &&
    ack === `${currentReview?.delivery.id}:${stamp}`
  );
  const receipts = demo
    ? currentReview
      ? [currentReview.delivery]
      : []
    : remote.deliveries;
  const inform = (text: string) => setNotice({ scope, text });

  async function connect() {
    const response = await remote.connectionCommand({ action: "connect" });
    if (!response?.authorizationUrl) return;
    try {
      const url = new URL(response.authorizationUrl);
      if (
        url.origin !== "https://auth.buffer.com" ||
        url.pathname !== "/auth" ||
        url.username ||
        url.password
      )
        throw new Error();
      window.location.assign(url.href);
    } catch {
      inform(
        "The authorization destination could not be verified. No connection was opened."
      );
    }
  }
  async function finish() {
    const response = await remote.connectionCommand({ action: "finish" });
    if (response?.connection?.status !== "connected") return;
    setCallbackPresent(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("buffer");
    window.history.replaceState(null, "", url.href);
    inform(
      "Connection saved for this account. Review the destination and a draft before authorizing any post."
    );
  }
  async function prepare() {
    if (
      !canPrepare ||
      !selected ||
      !connection ||
      !channel ||
      !scheduledAt ||
      !bufferScheduleAllowed(scheduledAt)
    )
      return;
    setAck("");
    if (demo) {
      setReview({
        scope,
        stamp,
        delivery: {
          id: crypto.randomUUID(),
          projectId: "00000000-0000-4000-8000-000000000051",
          status: "awaiting-approval",
          body: text,
          platformId: selected.platformId,
          postIdx: selected.postIdx,
          channelId: channel.id,
          channelName: channel.name,
          connectionId: connection.id,
          connectionRevision: connection.revision,
          scheduledAt,
          timeZone: "UTC",
          approvalHash: "0".repeat(64),
          expiresAt: new Date(
            Math.min(Date.now() + 15 * 60_000, Date.parse(scheduledAt) - 2 * 60_000)
          ).toISOString(),
        },
      });
      inform(
        "Example approval preview only. No connection, database write or provider request."
      );
      return;
    }
    const response = await remote.deliveryCommand({
      action: "prepare",
      projectId,
      platformId: selected.platformId,
      postIdx: selected.postIdx,
      connectionId: connection.id,
      connectionRevision: connection.revision,
      channelId: channel.id,
      scheduledAt,
      timeZone: "UTC",
    });
    if (response?.delivery) {
      setReview({ scope, stamp, delivery: response.delivery });
      inform(
        "Saved approval preview. Nothing has been sent. Review the complete frozen text, account and time."
      );
    }
  }
  async function approve() {
    if (!canApprove || !currentReview) return;
    if (Date.parse(currentReview.delivery.expiresAt) <= Date.now()) {
      inform("This approval has expired. Prepare a new preview; nothing was sent.");
      return;
    }
    setAck("");
    if (demo) {
      setReview({
        ...currentReview,
        delivery: {
          ...currentReview.delivery,
          status: "scheduled",
          message: "Example only — no Buffer request or real schedule exists.",
        },
      });
      inform("Example scheduling receipt only. Nothing was sent, saved or published.");
      return;
    }
    const response = await remote.deliveryCommand({
      action: "approve",
      deliveryId: currentReview.delivery.id,
      approvalHash: currentReview.delivery.approvalHash,
    });
    if (response?.delivery) {
      setReview({ ...currentReview, delivery: response.delivery });
      inform("Read the provider receipt below. A scheduled item is not a published post.");
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent-300">
        Publishing · your approval, then scheduled delivery
      </p>
      <h3 className="mt-2 text-xl font-semibold">
        Review once. Let Buffer handle the scheduled send.
      </h3>
      <p className="mt-2 text-sm text-neutral-400">
        X and LinkedIn · one plain-text/link post at a time. No autonomous rewrites,
        threads, media, bulk posts, replies or direct messages.
      </p>
      <p className="mt-2 text-xs text-accent-300">
        {demo
          ? "Fictional example — no account connection, API call or saved schedule."
          : remote.checking
            ? "Checking publishing availability…"
            : remote.enabled
              ? connection?.status === "connected"
                ? `Connected: ${connection.accountLabel}`
                : "Not connected"
              : "Scheduling is not enabled on this deployment. Manual publishing remains available."}
      </p>
      <details className="mt-4 rounded-lg border border-line p-4">
        <summary className="cursor-pointer py-1 text-sm font-medium">
          {demo
            ? "Try the fictional scheduling review"
            : "Connection, approval and delivery receipts"}
        </summary>
        <div className="mt-4 space-y-4">
          {!demo && remote.error && (
            <p role="alert" className="text-sm text-amber-200">
              {remote.error}
            </p>
          )}
          {!demo && !remote.enabled && remote.setupIssues.length > 0 && (
            <p className="text-xs text-neutral-400">
              Operator setup required: {remote.setupIssues.join(" · ")}. Never paste
              social-account tokens into this form or the Copilot.
            </p>
          )}
          {!demo && (
            <div className="flex flex-wrap gap-2">
              {connection?.status !== "connected" && (
                <Button
                  disabled={!remote.enabled || remote.busy}
                  onClick={() => void connect()}
                >
                  Connect my Buffer account
                </Button>
              )}
              {callbackPresent && (
                <Button
                  disabled={!remote.enabled || remote.busy}
                  onClick={() => void finish()}
                >
                  Finish connection for this signed-in account
                </Button>
              )}
              {connection?.status === "connected" && (
                <Button
                  variant="outline"
                  disabled={!remote.enabled || remote.busy}
                  onClick={() =>
                    void remote.connectionCommand({ action: "refresh-channels" })
                  }
                >
                  Refresh connected channels
                </Button>
              )}
              <Button variant="ghost" disabled={remote.busy} onClick={remote.refresh}>
                Refresh receipts
              </Button>
              {connection && connection.status !== "disconnected" && (
                <Button
                  variant="ghost"
                  disabled={remote.busy}
                  onClick={() => setDisconnectScope(scope)}
                >
                  Disconnect Buffer…
                </Button>
              )}
            </div>
          )}
          {disconnectArmed && !demo && (
            <div className="rounded-lg border border-amber-900 p-3 text-sm text-amber-200">
              <p>
                Disconnect blocks new requests here. Items already accepted by Buffer may
                still publish; manage those in Buffer. Disconnecting does not delete
                external posts.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  disabled={remote.busy}
                  onClick={async () => {
                    const response = await remote.connectionCommand({
                      action: "disconnect",
                    });
                    if (response) {
                      setDisconnectScope(null);
                      setReview(null);
                      setAck("");
                      inform(
                        "Local connection disconnected. Check Buffer for any item already accepted."
                      );
                    }
                  }}
                >
                  Confirm disconnect
                </Button>
                <Button variant="ghost" onClick={() => setDisconnectScope(null)}>
                  Keep connection
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-neutral-400">
            Buffer receives the approved text, selected channel and UTC schedule only after
            your final approval. Credentials remain encrypted server-side and are not sent
            to the model. Opening OAuth is not permission to post.
          </p>
          <div>
            <label htmlFor={`${formId}-draft`} className="block text-xs text-neutral-400">
              Saved draft to review
            </label>
            <select
              id={`${formId}-draft`}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 p-2 text-sm"
              value={selected ? `${selected.platformId}:${selected.postIdx}` : ""}
              onChange={(event) => {
                setSelection(event.target.value);
                setAck("");
              }}
            >
              {!candidates.length && <option value="">No supported draft yet</option>}
              {candidates.map((item) => (
                <option
                  key={`${item.platformId}:${item.postIdx}`}
                  value={`${item.platformId}:${item.postIdx}`}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-channel`} className="block text-xs text-neutral-400">
              Exact destination account
            </label>
            <select
              id={`${formId}-channel`}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 p-2 text-sm"
              value={channel?.id ?? ""}
              onChange={(event) => {
                setChannelId(event.target.value);
                setAck("");
              }}
            >
              {!channels.length && (
                <option value="">Connect a matching X or LinkedIn channel</option>
              )}
              {channels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.service}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-time`} className="block text-xs text-neutral-400">
              Send at — UTC
            </label>
            <input
              id={`${formId}-time`}
              type="datetime-local"
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 p-2 text-sm"
              value={when}
              onChange={(event) => {
                setWhen(event.target.value);
                setAck("");
              }}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Enter UTC explicitly to avoid daylight-saving ambiguity. Choose between 10
              minutes and 30 days ahead; the server verifies the allowed window.
            </p>
          </div>
          {issues.length > 0 && (
            <ul role="alert" className="list-disc space-y-1 pl-4 text-sm text-amber-200">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          <Button disabled={!canPrepare} onClick={() => void prepare()}>
            {demo ? "Preview example approval" : "Prepare approval preview — no send"}
          </Button>
          {currentReview && (
            <section
              aria-label="Frozen publishing approval"
              className="space-y-3 rounded-lg border border-accent-800 p-4"
            >
              <p className="text-sm font-semibold">
                {statusLabel[currentReview.delivery.status]}
              </p>
              <p className="break-words text-xs text-neutral-400">
                Account: {currentReview.delivery.channelName}
                <br />
                Schedule: {currentReview.delivery.scheduledAt} (
                {currentReview.delivery.timeZone})<br />
                Approval expires: {currentReview.delivery.expiresAt}
              </p>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-neutral-200">
                {currentReview.delivery.body}
              </pre>
              {awaiting && (!unchanged || expired) && (
                <p role="alert" className="text-sm text-amber-200">
                  This approval is stale or expired. Draft, facts, destination or time
                  changed. Prepare a new preview; the old approval cannot send the edited
                  content.
                </p>
              )}
              {awaiting && (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ack === `${currentReview.delivery.id}:${stamp}`}
                      disabled={!unchanged || expired || remote.busy}
                      onChange={(event) =>
                        setAck(
                          event.target.checked
                            ? `${currentReview.delivery.id}:${stamp}`
                            : ""
                        )
                      }
                    />
                    <span>
                      I approve this exact text, destination account and UTC time. Approval
                      schedules a real post when enabled; it is not just saving a draft.
                    </span>
                  </label>
                  <Button disabled={!canApprove} onClick={() => void approve()}>
                    {demo
                      ? "Simulate approved scheduling — no send"
                      : "Approve & schedule in Buffer"}
                  </Button>
                </>
              )}
            </section>
          )}
          {notice?.scope === scope && (
            <p
              role="status"
              className="rounded-lg border border-line p-3 text-sm text-accent-200"
            >
              {notice.text}
            </p>
          )}
          {receipts.length > 0 && (
            <section aria-label="Publishing delivery history" className="space-y-2">
              <h4 className="text-sm font-semibold">
                Delivery receipts — not engagement metrics
              </h4>
              {receipts.map((delivery) => (
                <article key={delivery.id} className="rounded-lg border border-line p-3">
                  <p className="text-sm">{statusLabel[delivery.status]}</p>
                  <p className="mt-1 break-words text-xs text-neutral-400">
                    {delivery.channelName} · {delivery.scheduledAt}
                    {delivery.observedAt ? ` · observed ${delivery.observedAt}` : ""}
                  </p>
                  {delivery.message && (
                    <p className="mt-2 text-xs text-neutral-400">{delivery.message}</p>
                  )}
                  {!demo &&
                    ["scheduled", "unknown", "sending"].includes(delivery.status) && (
                      <Button
                        variant="outline"
                        className="mt-2"
                        disabled={
                          !remote.enabled || remote.busy || !delivery.providerPostId
                        }
                        onClick={() =>
                          void remote.deliveryCommand({
                            action: "read-reconcile",
                            deliveryId: delivery.id,
                          })
                        }
                      >
                        Check provider status — read only
                      </Button>
                    )}
                  {!demo && delivery.status === "awaiting-approval" && (
                    <Button
                      variant="ghost"
                      disabled={remote.busy}
                      onClick={() =>
                        void remote.deliveryCommand({
                          action: "cancel-local",
                          deliveryId: delivery.id,
                        })
                      }
                    >
                      Cancel unsent approval
                    </Button>
                  )}
                </article>
              ))}
            </section>
          )}
          <p className="text-xs text-neutral-500">
            Scheduling does not start an experiment or prove publication. Provider-reported
            sent status is shown separately; imported metrics and automatic experiment
            creation are not included in this first connector.
          </p>
        </div>
      </details>
    </Card>
  );
}
