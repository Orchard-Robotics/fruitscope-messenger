export const PORT = Number(process.env.PORT ?? 3001);

export const isProd = process.env.NODE_ENV === "production";

/**
 * Public origin of the messenger (used for the OIDC redirect URI, post-login
 * redirects and the session-cookie `Secure` decision). Overridable for local
 * dev; defaults to the production domain.
 */
export const APP_URL = (process.env.APP_URL ?? "https://fruitscope-messenger.com").replace(/\/+$/, "");

/* ------------------------------------------------------------------ */
/* OIDC relying-party config — "Sign in with FruitScope".              */
/* The provider is the public FruitScope OIDC issuer; the messenger is */
/* a confidential client (authorization-code + PKCE).                  */
/* ------------------------------------------------------------------ */

export const oidc = {
  issuer: process.env.OIDC_ISSUER ?? "https://login.fruitscope.com",
  clientId: process.env.OIDC_CLIENT_ID ?? "fruitscope-messenger",
  clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  redirectUri: process.env.OIDC_REDIRECT_URI ?? `${APP_URL}/api/auth/callback`,
  // The `fruitscope` scope carries the orchard + role claim we key off of.
  scope: process.env.OIDC_SCOPE ?? "openid profile email phone fruitscope",
};

/** True once the confidential client is configured (so prod can fail loudly). */
export const oidcConfigured = oidc.clientSecret.length > 0;

/* ------------------------------------------------------------------ */
/* FruitScope API — the backend that powers the Canary AI assistant.   */
/* The messenger calls it server-to-server, acting as the signed-in    */
/* user via their `session_jwt` (presented as the `auth_jwt` cookie).  */
/* ------------------------------------------------------------------ */

/** Base origin of the FruitScope API (the same backend the web app uses). */
export const FRUITSCOPE_API_BASE = (
  process.env.FRUITSCOPE_API_BASE ?? "https://api.fruitscope.com"
).replace(/\/+$/, "");

/**
 * The namespace super admins are registered into. Regular users land on their
 * `primary_orchard`; super admins always land here and can switch elsewhere.
 */
export const superAdminOrchard = {
  code: process.env.SUPERADMIN_ORCHARD_CODE ?? "orchard-robotics",
  name: process.env.SUPERADMIN_ORCHARD_NAME ?? "Orchard Robotics",
};

/**
 * Read-only integration tokens for CanaryCode's developer tools (Phase 2:
 * GitHub + Linear). Each tool is GET/query-only and stays dormant — returning a
 * "not configured" note instead of erroring — until its secret is provisioned.
 * Populate the Secret Manager secrets `canarycode-github-token` /
 * `canarycode-linear-key` to light them up. NEVER give these write scopes.
 */
// Terraform seeds each secret with the placeholder "unset" so the deploy never
// breaks; treat that (and blank) as "no token", keeping the tool dormant.
const secretOr = (v: string | undefined): string => {
  const t = (v ?? "").trim();
  return t === "unset" ? "" : t;
};

export const canaryCodeIntegrations = {
  // Org-owned GitHub App (preferred): the credential belongs to Orchard-Robotics,
  // not a person. The App ID and installation id are not secret; the private key
  // is. Installation id is auto-discovered from the org when left blank.
  githubAppId: process.env.GITHUB_APP_ID ?? "",
  githubAppPrivateKey: secretOr(process.env.GITHUB_APP_PRIVATE_KEY),
  githubAppInstallationId: process.env.GITHUB_APP_INSTALLATION_ID ?? "",
  // Optional fallback: a static token (e.g. a PAT) if ever preferred over the App.
  githubToken: secretOr(process.env.GITHUB_TOKEN),
  githubOrg: process.env.GITHUB_ORG ?? "Orchard-Robotics",
  githubDefaultRepo: process.env.GITHUB_DEFAULT_REPO ?? "fruitscope",
  linearApiKey: secretOr(process.env.LINEAR_API_KEY),
  // PostHog (read-only) for errors_recent. Host defaults to US cloud; project is
  // auto-discovered when the id is blank. The key should be a read-scoped personal key.
  posthogKey: secretOr(process.env.POSTHOG_API_KEY),
  posthogHost: (process.env.POSTHOG_HOST ?? "https://us.posthog.com").replace(/\/+$/, ""),
  posthogProjectId: process.env.POSTHOG_PROJECT_ID ?? "",
};

/** Opaque session token delivered as an httpOnly cookie after OIDC login. */
export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "fsm_session";
/** Short-lived signed cookie holding the in-flight OIDC PKCE transaction. */
export const OIDC_TX_COOKIE = "fsm_oidc_tx";

/**
 * Secret for signing the OIDC transaction cookie. Falls back to the client
 * secret (always present in a configured deployment) so there's nothing extra
 * to provision; an explicit SESSION_SECRET overrides it.
 */
export const SESSION_SECRET =
  process.env.SESSION_SECRET || oidc.clientSecret || "dev-only-secret";

/**
 * Local-dev escape hatch: a forged-session login so the UI can be exercised
 * without reaching the real IdP. Hard-gated — never in production.
 */
export const allowDevLogin = !isProd && process.env.ALLOW_DEV_LOGIN === "true";

/**
 * Allow the OIDC issuer to be reached over plain http:// — only when pointing
 * at a locally-running provider. Hard-gated to non-production so a real
 * deployment can never silently drop TLS on the token/JWKS calls.
 */
export const oidcAllowInsecure = !isProd && process.env.OIDC_ALLOW_INSECURE === "true";

/* ------------------------------------------------------------------ */
/* Object storage — profile pictures.                                  */
/* GCS in prod (objects served via the CDN), the fake-gcs emulator     */
/* locally. The server uploads; the browser reads the public URL.      */
/* ------------------------------------------------------------------ */

export const media = {
  /** Bucket holding uploaded media (avatars). */
  bucket: process.env.GCS_MEDIA_BUCKET ?? "fruitscope-media",
  /**
   * When set, the GCS client talks to a local emulator (fake-gcs-server) at this
   * endpoint instead of real GCS — no credentials, and the bucket is auto-created
   * on boot. Unset in prod, where Application Default Credentials are used.
   */
  emulatorHost: process.env.GCS_EMULATOR_HOST,
  /**
   * Base the public avatar URL is built on: `${base}/${objectKey}`.
   *  - prod:  https://fruitscope-messenger.com  (LB path rule /avatars/* → CDN bucket)
   *  - local: http://localhost:4443/fruitscope-media  (fake-gcs public object path)
   */
  publicBase: (process.env.MEDIA_PUBLIC_BASE ?? `${APP_URL}`).replace(/\/+$/, ""),
};

export const usingGcsEmulator = Boolean(media.emulatorHost);
