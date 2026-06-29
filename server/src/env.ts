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

/**
 * The namespace super admins are registered into. Regular users land on their
 * `primary_orchard`; super admins always land here and can switch elsewhere.
 */
export const superAdminOrchard = {
  code: process.env.SUPERADMIN_ORCHARD_CODE ?? "orchard-robotics",
  name: process.env.SUPERADMIN_ORCHARD_NAME ?? "Orchard Robotics",
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
