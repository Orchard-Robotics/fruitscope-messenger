/**
 * GitHub App authentication for CanaryCode's read-only tools.
 *
 * The credential is owned by the Orchard-Robotics *organization* (a GitHub App),
 * not by any individual — unlike a personal access token. We authenticate by
 * signing a short-lived app JWT with the app's private key, then exchanging it
 * for an installation access token scoped to the org's install. Because the App
 * is granted only read permissions, that token can only read — defense in depth
 * on top of the GET-only tool layer.
 *
 * NOTE ON "POST": minting an installation token is a POST, but it is an *auth
 * handshake for our own credential*, not a data mutation — no repository content
 * is ever changed. All tool/data calls still go through the GET-only `ghFetch`.
 */
import { createSign } from "node:crypto";

import { canaryCodeIntegrations as cfg } from "./env";

const GH_API = "https://api.github.com";

interface CachedToken {
  token: string;
  expiresAtMs: number;
}
let cached: CachedToken | null = null;

/** PEM keys are often stored with literal "\n" escapes; restore real newlines. */
function normalizePem(pem: string): string {
  const t = pem.trim();
  return t.includes("\\n") ? t.replace(/\\n/g, "\n") : t;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** A ~9-minute app JWT (GitHub caps app JWTs at 10 min), signed RS256. */
function appJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(normalizePem(privateKeyPem));
  return `${signingInput}.${b64url(signature)}`;
}

/** GET/POST against the App-level API using the app JWT (auth handshake only). */
async function appApi(
  path: string,
  jwt: string,
  method: "GET" | "POST" = "GET",
): Promise<unknown> {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "canarycode",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub App API ${res.status} on ${path}: ${body.slice(0, 240)}`);
  }
  return res.json();
}

/** Find the installation id for the configured org (so the admin needn't supply it). */
async function discoverInstallationId(jwt: string): Promise<string> {
  if (cfg.githubAppInstallationId) return cfg.githubAppInstallationId;
  const list = (await appApi("/app/installations?per_page=100", jwt)) as Array<{
    id?: number;
    account?: { login?: string };
  }>;
  const org = cfg.githubOrg.toLowerCase();
  const match =
    list.find((i) => i.account?.login?.toLowerCase() === org) ?? (list.length === 1 ? list[0] : undefined);
  if (!match?.id) {
    throw new Error(
      `No GitHub App installation found for org "${cfg.githubOrg}". Install the app on the org.`,
    );
  }
  return String(match.id);
}

/**
 * Return a valid installation access token, minting (and caching) one when the
 * cached token is missing or within 5 minutes of expiry. Returns null when the
 * App isn't configured (no app id / private key) — the tool then stays dormant.
 */
export async function getGithubInstallationToken(): Promise<string | null> {
  const appId = cfg.githubAppId;
  const key = cfg.githubAppPrivateKey;
  if (!appId || !key) return null;

  const now = Date.now();
  if (cached && cached.expiresAtMs - now > 5 * 60_000) return cached.token;

  const jwt = appJwt(appId, key);
  const installationId = await discoverInstallationId(jwt);
  const result = (await appApi(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    "POST",
  )) as { token?: string; expires_at?: string };
  if (!result.token) throw new Error("GitHub App did not return an installation token.");

  cached = {
    token: result.token,
    expiresAtMs: result.expires_at ? Date.parse(result.expires_at) : now + 55 * 60_000,
  };
  return cached.token;
}

/** True when either a static token or App credentials are configured. */
export function githubConfigured(): boolean {
  return Boolean(cfg.githubToken || (cfg.githubAppId && cfg.githubAppPrivateKey));
}
