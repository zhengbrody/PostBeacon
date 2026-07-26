"use client";

import { track } from "@vercel/analytics/react";
import type { OutcomeCheckpoint, Provider } from "./types";

/**
 * Aggregate product-funnel events only. Event payloads are deliberately
 * allowlisted here so call sites cannot accidentally send URLs, product text,
 * account ids, email addresses, draft copy, or outcome values to analytics.
 */
export const PRODUCT_EVENTS = {
  guestPreviewStarted: "Guest Preview Started",
  guestPreviewCompleted: "Guest Preview Completed",
  guestPreviewFailed: "Guest Preview Failed",
  guestHandoffAccepted: "Guest Handoff Accepted",
  analysisCompleted: "Analysis Completed",
  strategyCompleted: "Strategy Completed",
  planGenerated: "Plan Generated",
  publishConfirmed: "Manual Publish Confirmed",
  outcomeRecorded: "Outcome Recorded",
  learningLoopCompleted: "Learning Loop Completed",
} as const;

export type ProductEvent = (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS];

export interface ProductEventProperties {
  provider?: Provider;
  checkpoint?: OutcomeCheckpoint;
  mode?: "guest" | "signed-in";
  source?: "direct" | "guest-handoff";
}

const PROVIDERS = new Set<Provider>(["claude", "openai", "deepseek"]);
const CHECKPOINTS = new Set<OutcomeCheckpoint>(["manual", "24h", "72h"]);
const MODES = new Set(["guest", "signed-in"]);
const SOURCES = new Set(["direct", "guest-handoff"]);

/** Testable last-mile guard for the analytics boundary. */
export function safeProductEventProperties(
  properties: Record<string, unknown> = {}
): Record<string, string> {
  const safe: Record<string, string> = {};
  if (PROVIDERS.has(properties.provider as Provider)) {
    safe.provider = properties.provider as Provider;
  }
  if (CHECKPOINTS.has(properties.checkpoint as OutcomeCheckpoint)) {
    safe.checkpoint = properties.checkpoint as OutcomeCheckpoint;
  }
  if (MODES.has(properties.mode as string)) {
    safe.mode = properties.mode as string;
  }
  if (SOURCES.has(properties.source as string)) {
    safe.source = properties.source as string;
  }
  return safe;
}

/** Analytics must never block the product if the vendor script is unavailable. */
export function trackProductEvent(
  event: ProductEvent,
  properties: ProductEventProperties = {}
): void {
  try {
    track(event, safeProductEventProperties({ ...properties }));
  } catch {
    // Aggregate measurement is best-effort and never changes product state.
  }
}
