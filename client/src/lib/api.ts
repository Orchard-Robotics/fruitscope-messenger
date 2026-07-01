import type {
  AdminBot,
  AdminConversation,
  AdminUser,
  Bootstrap,
  Channel,
  Message,
  MessageCursor,
  ModelCatalog,
  Orchard,
  SyncOrchardOption,
  SyncPreview,
  SyncReport,
  ThreadMention,
  User,
} from "@shared/index";

/** Full-page navigation target that starts the "Sign in with FruitScope" flow. */
export const LOGIN_URL = "/api/auth/login";

/** Result of a read-only SQL query from CanaryCode's DB tool / editor. */
export interface SqlQueryResult {
  database?: string;
  fields?: string[];
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  truncated?: boolean;
  ms?: number;
  error?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    // The session rides on an httpOnly cookie — same-origin in dev (via the Vite
    // proxy) and prod (behind the load balancer), so the cookie is always sent.
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const rest = {
  me: () => request<User>("/me"),
  bootstrap: () => request<Bootstrap>("/bootstrap"),
  /** Server-side message search across the orchard's accessible channels. */
  search: (q: string) =>
    request<{ messages: Message[] }>(`/search?q=${encodeURIComponent(q)}`),
  /** Your Threads inbox: recent messages that @mention you (with unread flags). */
  mentions: () => request<{ mentions: ThreadMention[] }>("/mentions"),
  /** Upload a new profile picture (multipart); returns the updated user. */
  uploadAvatar: async (file: File): Promise<User> => {
    const form = new FormData();
    form.append("file", file);
    // No Content-Type header — the browser sets the multipart boundary itself.
    const res = await fetch("/api/me/avatar", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Upload failed (${res.status})`);
    }
    return res.json() as Promise<User>;
  },
  /** Remove the current profile picture; returns the updated user. */
  removeAvatar: () => request<User>("/me/avatar", { method: "DELETE" }),
  /** Orchards the current user can switch into (all for super admins). */
  orchards: () => request<Orchard[]>("/orchards"),
  switchOrchard: (orchardId: string) =>
    request<{ orchard: Orchard }>("/orchards/switch", {
      method: "POST",
      body: JSON.stringify({ orchardId }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  /* ---- admin: user management + masquerade ---- */
  /** Every user (+ orchards/roles) — for the admin User Management page. */
  adminUsers: async (): Promise<AdminUser[]> =>
    (await request<{ users: AdminUser[] }>("/admin/users")).users,
  /** Start masquerading as another user; reload the app to take effect. */
  masquerade: (userId: string) =>
    request<{ ok: true }>("/admin/masquerade", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  /** Stop masquerading. */
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),

  /* ---- admin: sync workspaces + users from FruitScope ---- */
  /** Orchards the admin can sync (flagged if already a workspace). */
  syncOrchards: async (): Promise<SyncOrchardOption[]> =>
    (await request<{ orchards: SyncOrchardOption[] }>("/admin/sync/orchards")).orchards,
  /** Preview the users syncing an orchard would provision (no writes). */
  syncOrchardUsers: (code: string) =>
    request<SyncPreview>(`/admin/sync/orchards/${encodeURIComponent(code)}/users`),
  /** Run the sync; returns a report of what changed. */
  runSync: (orchardCode: string) =>
    request<SyncReport>("/admin/sync/orchard", {
      method: "POST",
      body: JSON.stringify({ orchardCode }),
    }),

  /* ---- admin: create workspaces + LLM bots ---- */
  /** Every workspace (for the bot-creation picker). */
  adminWorkspaces: async (): Promise<Orchard[]> =>
    (await request<{ workspaces: Orchard[] }>("/admin/workspaces")).workspaces,
  /** Create a workspace; returns it. */
  createWorkspace: async (code: string, name: string): Promise<Orchard> =>
    (await request<{ workspace: Orchard }>("/admin/workspaces", {
      method: "POST",
      body: JSON.stringify({ code, name }),
    })).workspace,
  /** The catalog of every model a bot can run under (live). */
  llmModels: () => request<ModelCatalog>("/admin/llm/models"),
  /** Create an LLM bot; returns it. */
  createBot: async (input: {
    displayName: string;
    orchardId: string;
    model: string;
    systemPrompt: string;
  }): Promise<User> =>
    (await request<{ bot: User }>("/admin/bots", {
      method: "POST",
      body: JSON.stringify(input),
    })).bot,
  /** Every managed bot. */
  adminBots: async (): Promise<AdminBot[]> =>
    (await request<{ bots: AdminBot[] }>("/admin/bots")).bots,
  /** Edit a bot (name / model / system prompt / workspace); returns it. */
  updateBot: async (
    id: string,
    fields: { displayName?: string; model?: string; systemPrompt?: string; orchardId?: string },
  ): Promise<AdminBot> =>
    (await request<{ bot: AdminBot }>(`/admin/bots/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    })).bot,
  /** Permanently delete a bot and its messages. */
  deleteBot: (id: string) =>
    request<{ ok: true }>(`/admin/bots/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /* ---- CanaryCode: interactive read-only SQL (staff only) ---- */
  /** Run a read-only SQL query against the shared FruitScope DB; returns rows or an error. */
  dbQuery: (sql: string, database?: string, limit?: number) =>
    request<SqlQueryResult>("/canarycode/db/query", {
      method: "POST",
      body: JSON.stringify({ sql, ...(database ? { database } : {}), ...(limit ? { limit } : {}) }),
    }),
  /** List databases on the shared instance for the SQL editor's picker. */
  dbDatabases: () => request<{ databases: string[]; error?: string }>("/canarycode/db/databases"),

  /* ---- admin: conversation monitor ---- */
  /** Every conversation across all workspaces (newest activity first). */
  adminConversations: async (): Promise<AdminConversation[]> =>
    (await request<{ conversations: AdminConversation[] }>("/admin/conversations")).conversations,
  /** Read a conversation's messages (admins can read any); pages back via cursor. */
  adminConversationMessages: (id: string, before?: MessageCursor) =>
    request<{ channel: Channel; messages: Message[]; authors: User[]; hasMore: boolean }>(
      `/admin/conversations/${encodeURIComponent(id)}/messages` +
        (before ? `?beforeAt=${before.createdAt}&beforeId=${encodeURIComponent(before.id)}` : ""),
    ),
};
