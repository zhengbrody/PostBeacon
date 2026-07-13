import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { PublicError } from "./errors";
import { clearPolicyProviders } from "./privacy";
import type { Provider } from "./types";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function availableProviders(): Provider[] {
  const out: Provider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("claude");
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.DEEPSEEK_API_KEY) out.push("deepseek");

  // Optional DEFAULT_PROVIDER pins which one the UI selects first — an explicit
  // operator decision that overrides the privacy ordering below.
  const preferred = process.env.DEFAULT_PROVIDER as Provider | undefined;
  if (preferred && out.includes(preferred)) {
    return [preferred, ...out.filter((p) => p !== preferred)];
  }
  // Privacy posture (M17): a provider whose API data policy doesn't clearly
  // exclude training use must never become the silent default, so order
  // clear-policy providers first. Stable within each group.
  const clear = new Set(clearPolicyProviders());
  return [...out.filter((p) => clear.has(p)), ...out.filter((p) => !clear.has(p))];
}

/** Resolve the requested provider, falling back to whatever key exists. */
function resolveProvider(requested?: Provider): Provider {
  const avail = availableProviders();
  if (avail.length === 0) {
    // PublicError: this exact message is safe (and useful) to show the user.
    throw new PublicError(
      "No model API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY in .env.",
      503
    );
  }
  if (requested && avail.includes(requested)) return requested;
  return avail[0];
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
  provider: Provider;
  model: string;
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
  const provider = resolveProvider(opts.provider);
  const maxTokens = opts.maxTokens ?? 4000;
  const meta: LlmCallMeta = { provider, model: modelFor(provider) };

  const raw = await callRaw(provider, opts.system, opts.user, maxTokens);
  try {
    return { data: extractJson(raw), meta };
  } catch {
    // Repair pass: hand the broken text back and ask only for valid JSON.
    const fixed = await callRaw(
      provider,
      "You fix malformed JSON. Output ONLY the corrected, strictly valid JSON — same data, properly escaped quotes, no trailing commas, no truncation.",
      `This was meant to be a single JSON value but does not parse. Return the corrected JSON only:\n\n${raw}`,
      maxTokens
    );
    return { data: extractJson(fixed), meta };
  }
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
