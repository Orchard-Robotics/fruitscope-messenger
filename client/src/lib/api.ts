import type {
  AdminUser,
  Bootstrap,
  Message,
  ModelCatalog,
  Orchard,
  SyncOrchardOption,
  SyncPreview,
  SyncReport,
  User,
} from "@shared/index";

/** Full-page navigation target that starts the "Sign in with FruitScope" flow. */
export const LOGIN_URL = "/api/auth/login";

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
};
