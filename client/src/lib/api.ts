import type { Bootstrap, Orchard, User } from "@shared/index";

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
  /** Orchards the current user can switch into (all for super admins). */
  orchards: () => request<Orchard[]>("/orchards"),
  switchOrchard: (orchardId: string) =>
    request<{ orchard: Orchard }>("/orchards/switch", {
      method: "POST",
      body: JSON.stringify({ orchardId }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
};
