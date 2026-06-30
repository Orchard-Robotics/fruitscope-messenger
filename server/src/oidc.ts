import { createHmac, timingSafeEqual } from "node:crypto";

import * as client from "openid-client";
import { z } from "zod";

import { APP_URL, oidc, oidcAllowInsecure, SESSION_SECRET } from "./env";

/* ------------------------------------------------------------------ */
/* Provider discovery (memoised)                                        */
/* ------------------------------------------------------------------ */

let configPromise: Promise<client.Configuration> | null = null;

/**
 * Discover the FruitScope OIDC provider and build a confidential-client config
 * (authorization-code + PKCE, client_secret_basic). Memoised so discovery runs
 * once; on failure the promise is cleared so the next request retries.
 */
export function getOidcConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    const options = oidcAllowInsecure
      ? { execute: [client.allowInsecureRequests] }
      : undefined;
    configPromise = client
      .discovery(
        new URL(oidc.issuer),
        oidc.clientId,
        oidc.clientSecret,
        client.ClientSecretBasic(oidc.clientSecret),
        options,
      )
      .then((config) => {
        // Permit plain-http token/JWKS calls when pointing at a local provider.
        if (oidcAllowInsecure) client.allowInsecureRequests(config);
        return config;
      })
      .catch((err: unknown) => {
        configPromise = null;
        throw err;
      });
  }
  return configPromise;
}

/* ------------------------------------------------------------------ */
/* The `fruitscope` claim — the orchard + role carrier.                */
/* Shape mirrors cloud/server/oidc_claims.py (build_oidc_account).     */
/* ------------------------------------------------------------------ */

const fruitscopeClaimSchema = z
  .object({
    is_admin: z.boolean().optional(),
    role: z.string().nullish(),
    // Short-lived (24h) bearer that lets a relying party act as this user against
    // the FruitScope API — presented as the `auth_jwt` cookie. We hold it
    // server-side to drive the Canary AI assistant.
    session_jwt: z.string().nullish(),
    session_jwt_expires_in: z.number().nullish(),
    primary_orchard: z
      .object({
        orchard_code: z.string(),
        orchard_name: z.string().nullish(),
      })
      .nullish(),
    orchards: z.array(z.string()).optional(),
  })
  .passthrough();

export interface FruitscopeIdentity {
  sub: string;
  displayName: string | undefined;
  preferredUsername: string | undefined;
  email: string | undefined;
  isSuperAdmin: boolean;
  /** The user's primary orchard (code + name), if the claim carries one. */
  primaryOrchard: { code: string; name: string } | undefined;
  /** Every orchard code the user has permissions on (drives the switcher). */
  orchardCodes: string[];
  /**
   * The FruitScope `session_jwt`: a bearer token (presented as the `auth_jwt`
   * cookie) that lets us call the FruitScope API as this user — the credential
   * behind the Canary assistant. Held server-side only. Undefined when the claim
   * doesn't carry one. `authJwtTtlSeconds` is its lifetime (default 24h).
   */
  authJwt: string | undefined;
  authJwtTtlSeconds: number | undefined;
}

/** Extract the identity we provision from, from the verified ID-token claims. */
export function identityFromClaims(claims: client.IDToken): FruitscopeIdentity {
  const parsed = fruitscopeClaimSchema.safeParse(claims.fruitscope ?? {});
  const fs = parsed.success ? parsed.data : undefined;

  const primary = fs?.primary_orchard ?? undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  return {
    sub: String(claims.sub),
    displayName: str(claims.name),
    preferredUsername: str(claims.preferred_username),
    email: str(claims.email),
    isSuperAdmin: fs?.is_admin === true,
    primaryOrchard: primary
      ? { code: primary.orchard_code, name: str(primary.orchard_name) ?? primary.orchard_code }
      : undefined,
    orchardCodes: fs?.orchards ?? [],
    authJwt: str(fs?.session_jwt),
    authJwtTtlSeconds:
      typeof fs?.session_jwt_expires_in === "number" ? fs.session_jwt_expires_in : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* OIDC transaction (PKCE verifier + state + nonce)                    */
/* Carried across the redirect in a signed, httpOnly cookie.           */
/* ------------------------------------------------------------------ */

export interface OidcTx {
  codeVerifier: string;
  state: string;
  nonce: string;
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

/** `base64url(json).signature` — tamper-evident, opaque to the browser. */
export function encodeTx(tx: OidcTx): string {
  const body = Buffer.from(JSON.stringify(tx)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeTx(raw: string | undefined): OidcTx | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare; lengths must match for timingSafeEqual.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OidcTx;
    if (!parsed.codeVerifier || !parsed.state || !parsed.nonce) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Flow steps                                                          */
/* ------------------------------------------------------------------ */

/** Build the authorization-request URL and the transaction to stash. */
export async function beginLogin(): Promise<{ url: string; tx: OidcTx }> {
  const config = await getOidcConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const tx: OidcTx = {
    codeVerifier,
    state: client.randomState(),
    nonce: client.randomNonce(),
  };

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidc.redirectUri,
    scope: oidc.scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: tx.state,
    nonce: tx.nonce,
  });

  return { url: url.href, tx };
}

/** Exchange the authorization code and return the verified ID-token claims. */
export async function completeLogin(
  originalUrl: string,
  tx: OidcTx,
): Promise<FruitscopeIdentity> {
  const config = await getOidcConfig();
  // Reconstruct the absolute callback URL (with ?code&state) the AS redirected
  // to. APP_URL is authoritative — behind the load balancer the inbound host
  // header is the internal one.
  const currentUrl = new URL(originalUrl, APP_URL);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: tx.codeVerifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error("No ID token in token response");
  return identityFromClaims(claims);
}
