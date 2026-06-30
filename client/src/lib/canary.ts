/**
 * Client for the Canary AI assistant — talks only to our own `/api/canary/*`
 * proxy (which acts as the user against the FruitScope API server-side). The
 * streaming chat itself is driven by `useChat` (see CanaryPanel); everything
 * else — orchards, blocks, conversation history, turn-0 context — lives here.
 */

const BASE = "/api/canary";

/** Thrown with the proxy's status so callers can special-case 409 (reconnect). */
export class CanaryError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CanaryError";
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new CanaryError(res.status, body.error ?? `Request failed (${res.status})`, body.code);
  }
  return res.json() as Promise<T>;
}

const o = (orchard: string): string => `/o/${encodeURIComponent(orchard)}`;

/** The chat endpoint for an orchard — handed to the `useChat` transport. */
export const chatApiPath = (orchard: string): string => `${BASE}${o(orchard)}/chat`;

/* ------------------------------------------------------------------ */
/* Types (camelCased view of the FruitScope payloads)                  */
/* ------------------------------------------------------------------ */

export interface CanaryOrchard {
  code: string;
  name: string;
}

export interface CanaryBlock {
  blockId: number;
  blockName: string;
  ranchName: string | null;
  variety: string | null;
  fruitType: string | null;
  acreage: number | null;
  /** Block centroid (for the map selector); null if the block has no geometry. */
  lat: number | null;
  lon: number | null;
  lastScanDate: string | null;
  lastScanStage: string | null;
  lastScanId: number | null;
}

export interface CanaryScan {
  scanId: number;
  scanName: string;
  time: string;
  entityType: string | null;
  stage: string | null;
  variety: string | null;
  rows: number | null;
  trees: number | null;
}

export interface CanaryConversation {
  id: string;
  title: string | null;
  blockName: string | null;
  blockId: number | null;
  agentMode: string;
  generalMode: boolean;
  fastMode: boolean;
  updatedAt: string;
  preview?: string;
}

/** A persisted message as stored by FruitScope: `content` holds the UI parts. */
export interface CanaryStoredMessage {
  role: "user" | "assistant";
  content: { parts?: unknown[] } | unknown;
  createdAt: string;
}

interface RawConversation {
  id: string;
  title: string | null;
  block_name: string | null;
  block_id?: number | null;
  agent_mode?: string;
  general_mode?: boolean;
  fast_mode?: boolean;
  updated_at: string;
  preview?: string;
}

function mapConversation(c: RawConversation): CanaryConversation {
  return {
    id: c.id,
    title: c.title,
    blockName: c.block_name,
    blockId: c.block_id ?? null,
    agentMode: c.agent_mode ?? "analytical",
    generalMode: Boolean(c.general_mode),
    fastMode: Boolean(c.fast_mode),
    updatedAt: c.updated_at,
    ...(c.preview !== undefined ? { preview: c.preview } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export const canaryApi = {
  /** Orchards the user can use Canary in, plus the user's Canary tool mode. */
  orchards: async (): Promise<{ orchards: CanaryOrchard[]; canaryMode: number }> => {
    const r = await req<{ orchards: CanaryOrchard[]; canaryMode?: number }>("/orchards");
    return { orchards: r.orchards, canaryMode: r.canaryMode ?? 5 };
  },

  /** Blocks (+ recent scans) in an orchard. */
  blocks: async (orchard: string): Promise<CanaryBlock[]> =>
    (await req<{ blocks: CanaryBlock[] }>(`${o(orchard)}/blocks`)).blocks,

  /** A block's scan timeline (newest first). `blockName`, per FruitScope's quirk. */
  scans: async (orchard: string, blockName: string): Promise<CanaryScan[]> =>
    (await req<{ scans: CanaryScan[] }>(`${o(orchard)}/scans?block=${encodeURIComponent(blockName)}`))
      .scans,

  /** Past conversations in an orchard, newest first. */
  conversations: async (orchard: string): Promise<CanaryConversation[]> => {
    const { conversations } = await req<{ conversations: RawConversation[] }>(
      `${o(orchard)}/conversations`,
    );
    return conversations.map(mapConversation);
  },

  /** Load a conversation's stored messages + its (possibly stale) session id. */
  conversation: async (
    orchard: string,
    id: string,
  ): Promise<{ conversation: CanaryConversation; messages: CanaryStoredMessage[]; sessionId: string | null }> => {
    const raw = await req<{
      conversation: RawConversation;
      messages: { role: "user" | "assistant"; content: unknown; created_at: string }[];
      session_id: string | null;
    }>(`${o(orchard)}/conversations/${encodeURIComponent(id)}`);
    return {
      conversation: mapConversation(raw.conversation),
      messages: raw.messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at })),
      sessionId: raw.session_id,
    };
  },

  createConversation: (
    orchard: string,
    body: {
      block_id: number | null;
      block_name: string;
      agent_mode?: string;
      fast_mode?: boolean;
      general_mode?: boolean;
    },
  ): Promise<{ conversation_id: string }> =>
    req(`${o(orchard)}/conversations`, { method: "POST", body: JSON.stringify(body) }),

  renameConversation: (orchard: string, id: string, title: string): Promise<{ id: string; title: string }> =>
    req(`${o(orchard)}/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (orchard: string, id: string): Promise<{ deleted: boolean }> =>
    req(`${o(orchard)}/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Build turn-0 context; returns the `session_id` to pass on each chat turn. */
  prepareContext: (
    orchard: string,
    body: {
      block?: {
        name: string;
        fruitType?: string | null;
        variety?: string | null;
        acreage?: number | null;
        lastScanStage?: string | null;
        lat?: number | null;
        lon?: number | null;
      } | null;
      scan_ids?: number[] | null;
      conversation_id?: string;
      general_mode?: boolean;
      fast_mode?: boolean;
      is_imperial?: boolean;
      canary_mode?: number;
    },
  ): Promise<{ session_id: string; scan_report_pending?: boolean }> =>
    req(`${o(orchard)}/prepare-context`, { method: "POST", body: JSON.stringify(body) }),
};
