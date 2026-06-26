# Registering the messenger on the FruitScope OIDC provider

"Sign in with FruitScope" needs the messenger registered as a confidential client
on the OIDC provider (`login.fruitscope.com`, served by `cloud/oauth` in the
`fruitscope` repo, configured in `fruitscope-cluster-config`). The provider has
**no dynamic registration** — relying parties come from its `OAUTH_CLIENTS` env
(a JSON array), so this is a one-time config change.

This is the **only remaining step** to make login live; until it lands, the
messenger redirects to the provider but the client is rejected.

## 1. Shared client secret

Terraform (this repo) generates the secret and stores it in Secret Manager as
`verdant-oidc-client-secret` (same GCP project as the cluster,
`braided-visitor-372321`). After the messenger deploys:

```bash
SECRET=$(gcloud secrets versions access latest \
  --secret=verdant-oidc-client-secret --project=braided-visitor-372321)
```

## 2. Create the provider-side secret (`fruitscope-prod-oauth-clients`)

The provider reads `OAUTH_CLIENTS` from a GCP secret via External Secrets. Build
the JSON array (embedding the shared secret) and store it:

```bash
OAUTH_CLIENTS=$(jq -nc --arg s "$SECRET" '[{
  client_id: "fruitscope-messenger",
  client_secret: $s,
  grant_types: ["authorization_code"],
  response_types: ["code"],
  redirect_uris: ["https://fruitscope-messenger.com/api/auth/callback"],
  token_endpoint_auth_method: "client_secret_basic",
  scope: "openid profile email phone fruitscope",
  first_party: true
}]')

printf '%s' "$OAUTH_CLIENTS" | gcloud secrets create fruitscope-prod-oauth-clients \
  --data-file=- --project=braided-visitor-372321
# (if it already exists, use: gcloud secrets versions add fruitscope-prod-oauth-clients --data-file=-)
```

`first_party: true` auto-grants consent (no consent screen) — the messenger is a
first-party FruitScope property.

## 3. Wire it into `fruitscope-cluster-config` (prod)

**`environments/prod/secrets.yaml`** — add the key to the `fruitscope-oauth`
External Secret:

```yaml
  - name: fruitscope-oauth
    data:
      - secretKey: OAUTH_JWKS
        remoteKey: fruitscope-prod-oauth-jwks
      - secretKey: OAUTH_COOKIE_KEYS
        remoteKey: fruitscope-prod-oauth-cookie-keys
      - secretKey: OAUTH_CLIENTS              # add
        remoteKey: fruitscope-prod-oauth-clients
```

**`environments/prod/services/fruitscope-oauth.yaml`** — replace the
"OAUTH_CLIENTS: set once a real relying party is registered" comment with:

```yaml
  # Registered relying parties (JSON array), held in GCP secret
  # fruitscope-prod-oauth-clients (see environments/prod/secrets.yaml).
  # Currently: fruitscope-messenger (confidential, first-party).
  OAUTH_CLIENTS:
    valueFrom:
      secretKeyRef:
        name: fruitscope-oauth
        key: OAUTH_CLIENTS
```

ArgoCD syncs the change and the provider picks up the client.

## Contract (must match)

| Field | Value |
|---|---|
| `client_id` | `fruitscope-messenger` (messenger `OIDC_CLIENT_ID`) |
| `client_secret` | `verdant-oidc-client-secret` (messenger `OIDC_CLIENT_SECRET`) |
| `redirect_uris` | `https://fruitscope-messenger.com/api/auth/callback` |
| auth method | `client_secret_basic` |
| `scope` | `openid profile email phone fruitscope` |
| `first_party` | `true` |

The messenger keys off the `fruitscope` claim built in `cloud/server/oidc_claims.py`:
`fruitscope.primary_orchard` (the landing orchard), `fruitscope.is_admin` (super
admin → orchard-robotics + workspace switcher), `fruitscope.orchards[]`.
