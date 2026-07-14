import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { PublicError } from "./errors";
import { logError } from "./log";
import { automaticFallbackProviders, clearPolicyProviders } from "./privacy";
import type { Provider, ProviderRunMeta } from "./types";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function availableProviders(): Provider[] {
  const out: Provider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("claude");
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.DEEPSEEK_API_KEY) out.push("deepseek");

  // DEFAULT_PROVIDER may choose among clear-policy providers. An unclear-policy
  // provider must be selected explicitly by the user whenever a clear-policy
  // option is configured; an operator env var cannot silently opt users in.
  const preferred = process.env.DEFAULT_PROVIDER as Provider | undefined;
  const clear = new Set(clearPolicyProviders());
  if (preferred && out.includes(preferred) && clear.has(preferred)) {
    return [preferred, ...out.filter((p) => p !== preferred)];
  }
  // Privacy posture (M17): a provider whose API data policy doesn't clearly
  // exclude training use must never become the silent default, so order
  // clear-policy providers first. Stable within each group.
  return [...out.filter((p) => clear.has(p)), ...out.filter((p) => !clear.has(p))];
}

/**
 * Primary first, then configured automatic-fallback alternatives. DeepSeek is
 * eligible only under the explicit, publicly disclosed beta operator opt-in.
 */
function providerRunOrder(requested?: Provider): Provider[] {
  const avail = availableProviders();
  if (avail.length === 0) {
    // PublicError: this exact message is safe (and useful) to show the user.
    throw new PublicError(
      "No model API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY in .env.",
      503
    );
  }
  const primary = requested && avail.includes(requested) ? requested : avail[0];
  const fallback = new Set(automaticFallbackProviders());
  return [primary, ...avail.filter((p) => p !== primary && fallback.has(p))];
}

/**
 * Slice the first balanced JSON object/array out of a model response, ignoring
 * any prose/fences around it. Returns the raw substring — parsing is the
 * caller's job so it can attempt a repair on failure.
 */
function sliceJson(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "");
  const start = trimmed.search(/[[{]/);
  if (start === -1) throw new Error("Model returned no JSON: " + text.slice(0, 200));
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  // Unbalanced (e.g. truncated) — hand back what we have so repair can try.
  return trimmed.slice(start);
}

/** Parse model output into JSON, with a cheap, always-safe local repair pass. */
function extractJson(text: string): any {
  const sliced = sliceJson(text);
  try {
    return JSON.parse(sliced);
  } catch {
    // The only structural fix that can never corrupt content: drop trailing
    // commas before a closing } or ]. Anything else (e.g. an unescaped inner
    // quote) is left to the model repair retry in generateJson.
    return JSON.parse(sliced.replace(/,(\s*[}\]])/g, "$1"));
  }
}

const JSON_GUARD =
  '\n\nReturn ONLY valid JSON — no prose, no markdown fences. Inside string values, escape any double quote as \\" and never use a raw newline (use \\n).';

/** One raw model round-trip. Returns the model's text (JSON not yet parsed). */
async function callRaw(
  provider: Provider,
  system: string,
  user: string,
  maxTokens: number
): Promise<string> {
  if (provider === "claude") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: system + JSON_GUARD,
      messages: [
        { role: "user", content: user },
        { role: "assistant", content: "{" }, // prefill nudges clean JSON
      ],
    });
    return "{" + msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }

  // OpenAI and DeepSeek share the OpenAI SDK + chat-completions shape; DeepSeek
  // just needs a different base URL, key, and model. Both support JSON mode.
  const isDeepseek = provider === "deepseek";
  const client = new OpenAI({
    apiKey: isDeepseek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY,
    baseURL: isDeepseek ? DEEPSEEK_BASE_URL : undefined,
  });
  const res = await client.chat.completions.create({
    model: isDeepseek ? DEEPSEEK_MODEL : OPENAI_MODEL,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system + JSON_GUARD },
      { role: "user", content: user },
    ],
  });
  return res.choices[0].message.content || "";
}

/** The model id a provider resolves to (for output provenance). */
export function modelFor(provider: Provider): string {
  if (provider === "claude") return ANTHROPIC_MODEL;
  if (provider === "deepseek") return DEEPSEEK_MODEL;
  return OPENAI_MODEL;
}

export interface LlmCallMeta {
  provider: ProviderRunMeta["provider"];
  model: ProviderRunMeta["model"];
  fallbackFrom?: ProviderRunMeta["fallbackFrom"];
}

class InvalidModelOutputError extends Error {
  constructor() {
    super("The model returned invalid structured output.");
    this.name = "InvalidModelOutputError";
  }
}

function upstreamStatus(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** Errors that indicate availability/configuration, not a content-policy refusal. */
function canAutoFallback(err: unknown): boolean {
  if (err instanceof InvalidModelOutputError) return true;
  const status = upstreamStatus(err);
  if (status !== null) {
    return [401, 402, 403, 404, 408, 409, 429].includes(status) || status >= 500;
  }
  const name = err instanceof Error ? err.name : "";
  return /APIConnection|Timeout|RateLimit|InternalServer/i.test(name);
}

function logProviderFailure(provider: Provider, err: unknown): void {
  const status = upstreamStatus(err);
  const category =
    err instanceof InvalidModelOutputError
      ? "invalid-output"
      : status === 401 || status === 403
        ? "auth"
        : status === 402
          ? "credit"
          : status === 429
            ? "rate-limit"
            : status !== null && status >= 500
              ? "upstream"
              : status !== null
                ? "http"
                : "network";
  // Static operational breadcrumb only: never log the SDK message/response,
  // which can contain prompt fragments or provider request details.
  logError(
    `llm.${provider}`,
    new Error(`provider-failure category=${category} status=${status ?? "none"}`)
  );
}

async function generateWithProvider(
  provider: Provider,
  opts: { system: string; user: string },
  maxTokens: number
): Promise<any> {
  const raw = await callRaw(provider, opts.system, opts.user, maxTokens);
  try {
    return extractJson(raw);
  } catch {
    // Repair pass: hand the broken text back and ask only for valid JSON.
    const fixed = await callRaw(
      provider,
      "You fix malformed JSON. Output ONLY the corrected, strictly valid JSON — same data, properly escaped quotes, no trailing commas, no truncation.",
      `This was meant to be a single JSON value but does not parse. Return the corrected JSON only:\n\n${raw}`,
      maxTokens
    );
    try {
      return extractJson(fixed);
    } catch {
      throw new InvalidModelOutputError();
    }
  }
}

/**
 * Single entry point. Sends a system + user prompt, returns parsed JSON plus
 * which provider/model actually ran (the request's provider is a preference;
 * resolution can fall back). If the model emits malformed JSON (most commonly
 * an unescaped quote inside a long prose value), one repair round-trip asks
 * the model to return strictly valid JSON before we give up.
 */
export async function generateJsonMeta(opts: {
  provider?: Provider;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ data: any; meta: LlmCallMeta }> {
  const providers = providerRunOrder(opts.provider);
  const primary = providers[0];
  const maxTokens = opts.maxTokens ?? 4000;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const data = await generateWithProvider(provider, opts, maxTokens);
      return {
        data,
        meta: {
          provider,
          model: modelFor(provider),
          ...(provider !== primary ? { fallbackFrom: primary } : {}),
        },
      };
    } catch (err) {
      logProviderFailure(provider, err);
      const retryable = canAutoFallback(err);
      if (!retryable) throw err;
      if (i === providers.length - 1) {
        throw new PublicError(
          providers.length > 1
            ? "The configured AI providers are unavailable, out of credit, or rate-limited. Try again shortly."
            : "The selected AI provider is unavailable, out of credit, or rate-limited. Try another model or try again shortly.",
          503
        );
      }
    }
  }

  // Unreachable, but keeps the return contract explicit for TypeScript.
  throw new PublicError("No AI provider completed the request.", 503);
}

/** generateJsonMeta without the meta — for callers that don't record provenance. */
export async function generateJson(opts: {
  provider?: Provider;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<any> {
  return (await generateJsonMeta(opts)).data;
}
