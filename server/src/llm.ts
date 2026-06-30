/**
 * LLM access for admin-created bots. Wraps `@earendil-works/pi-ai` (the same
 * library FarmAgent uses) so the messenger can run a bot under ANY model in
 * pi-ai's live registry — Anthropic, OpenAI, or Google. Model ids are
 * "provider/registry-key" (e.g. "anthropic/claude-haiku-4-5"). Keys come from
 * the env (same secrets as FarmAgent); pi-ai's google provider reads GEMINI_API_KEY.
 */

import { complete, getModels } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";

export const LLM_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
const PROVIDER_SET: ReadonlySet<string> = new Set(LLM_PROVIDERS);

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

/** Which env var authenticates each provider (matches pi-ai's providers). */
const PROVIDER_ENV: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

/** Fallback model when a bot's stored id is missing/unknown. */
export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4-5";

export interface LlmModelOption {
  id: string;
  label: string;
}
export interface LlmProviderGroup {
  provider: LlmProvider;
  label: string;
  authed: boolean;
  models: LlmModelOption[];
}

let cachedCatalog: LlmProviderGroup[] | null = null;

/** Provider-grouped catalog of every chat model pi-ai can route to. */
export function modelCatalog(): LlmProviderGroup[] {
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = LLM_PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    authed: hasKey(provider),
    models: (getModels(provider) as Model<Api>[])
      .map((m) => ({ id: `${provider}/${m.id}`, label: m.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));
  return cachedCatalog;
}

function splitModelId(id: string): { provider: LlmProvider; key: string } | null {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  const provider = id.slice(0, slash);
  if (!PROVIDER_SET.has(provider)) return null;
  return { provider: provider as LlmProvider, key: id.slice(slash + 1) };
}

function resolveModel(id: string): { provider: LlmProvider; model: Model<Api> } | null {
  const parts = splitModelId(id);
  if (!parts) return null;
  const model = (getModels(parts.provider) as Model<Api>[]).find((m) => m.id === parts.key);
  return model ? { provider: parts.provider, model } : null;
}

/** True if `id` resolves to a real, installed model. */
export function isKnownModelId(id: string): boolean {
  return resolveModel(id) !== null;
}

/** A known id as-is, else the default — so a stale selection can't break a turn. */
export function resolveModelId(id: string | null | undefined): string {
  return id && isKnownModelId(id) ? id : DEFAULT_MODEL_ID;
}

function apiKeyFor(provider: LlmProvider): string {
  return process.env[PROVIDER_ENV[provider]]?.trim() ?? "";
}

function hasKey(provider: LlmProvider): boolean {
  return apiKeyFor(provider) !== "";
}

/** The provider of a model id has a configured key (so a call would authenticate). */
export function modelIsAuthed(id: string): boolean {
  const r = resolveModel(resolveModelId(id));
  return r ? hasKey(r.provider) : false;
}

/**
 * One-shot completion: run `prompt` under `modelId` with the given system prompt
 * and return the assembled answer text. Throws on an unknown provider key or a
 * provider error. The conversation is passed as a single user message (the
 * caller folds the transcript in), so we never construct assistant messages.
 */
export async function llmComplete(opts: {
  modelId: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const resolved = resolveModel(resolveModelId(opts.modelId));
  if (!resolved) throw new Error(`Unknown model: ${opts.modelId}`);
  const apiKey = apiKeyFor(resolved.provider);
  if (!apiKey) throw new Error(`No API key configured for ${resolved.provider}.`);

  const result = await complete(
    resolved.model,
    {
      systemPrompt: opts.system,
      messages: [{ role: "user", content: opts.prompt, timestamp: Date.now() }],
    },
    { apiKey, maxTokens: opts.maxTokens ?? 1024, maxRetries: 2 },
  );

  return result.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
