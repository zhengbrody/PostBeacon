import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
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

  // Optional DEFAULT_PROVIDER pins which one the UI selects first.
  const preferred = process.env.DEFAULT_PROVIDER as Provider | undefined;
  if (preferred && out.includes(preferred)) {
    return [preferred, ...out.filter((p) => p !== preferred)];
  }
  return out;
}

/** Resolve the requested provider, falling back to whatever key exists. */
function resolveProvider(requested?: Provider): Provider {
  const avail = availableProviders();
  if (avail.length === 0) {
    throw new Error(
      "No model API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY in .env."
    );
  }
  if (requested && avail.includes(requested)) return requested;
  return avail[0];
}

/** Pull the first balanced JSON object/array out of a model response. */
function extractJson(text: string): any {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "");
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
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error("Could not parse JSON from model output.");
}

/**
 * Single entry point. Sends a system + user prompt, returns parsed JSON.
 * Works across Claude and OpenAI so the rest of the app is provider-agnostic.
 */
export async function generateJson(opts: {
  provider?: Provider;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<any> {
  const provider = resolveProvider(opts.provider);
  const maxTokens = opts.maxTokens ?? 4000;

  if (provider === "claude") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: opts.system + "\n\nReturn ONLY valid JSON. No prose, no markdown fences.",
      messages: [
        { role: "user", content: opts.user },
        { role: "assistant", content: "{" }, // prefill nudges clean JSON
      ],
    });
    const text =
      "{" + msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return extractJson(text);
  }

  // OpenAI and DeepSeek share the OpenAI SDK + chat-completions shape; DeepSeek
  // just needs a different base URL, key, and model. Both support JSON mode.
  const isDeepseek = provider === "deepseek";
  const client = new OpenAI({
    apiKey: isDeepseek
      ? process.env.DEEPSEEK_API_KEY
      : process.env.OPENAI_API_KEY,
    baseURL: isDeepseek ? DEEPSEEK_BASE_URL : undefined,
  });
  const res = await client.chat.completions.create({
    model: isDeepseek ? DEEPSEEK_MODEL : OPENAI_MODEL,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return extractJson(res.choices[0].message.content || "");
}
