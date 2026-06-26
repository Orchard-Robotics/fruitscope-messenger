# Registering the messenger on the FruitScope OIDC provider

"Sign in with FruitScope" needs the messenger registered as a confidential client
on the OIDC provider (`login.fruitscope.com`, served by `cloud/oauth` in the
`fruitscope` repo, configured in `fruitscope-cluster-config`). The provider has
**no dynamic registration** — relying parties come from its `OAUTH_CLIENTS` env
(a JSON array), so this is a one-time config change.

The remaining step to make login live is the `fruitscope-cluster-config` change
(section 3) — until it lands, the messenger redirects to the provider but the
client is rejected.

## Secrets (already provisioned)

The shared client secret is **provisioned out-of-band** in Secret Manager
(project `braided-visitor-372321`) — the same convention as the other
`fruitscope-prod-oauth-*` secrets. Both already exist:

- **`verdant-oidc-client-secret`** — the raw client secret. The messenger's
  Cloud Run service references it for `OIDC_CLIENT_SECRET` (Terraform reads it by
  name via a data source; it does **not** generate or rotate it).
- **`fruitscope-prod-oauth-clients`** — the `OAUTH_CLIENTS` JSON array for the
  provider, embedding the same secret.

They were created with (recorded here for rotation / disaster recovery):

```bash
S=$(openssl rand -hex 32)
printf '%s' "$S" | gcloud secrets create verdant-oidc-client-secret \
  --data-file=- --replication-policy=automatic --project=braided-visitor-372321

OAUTH_CLIENTS=$(jq -nc --arg s "$S" '[{
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
  --data-file=- --replication-policy=automatic --project=braided-visitor-372321
```

To **rotate**: generate a new `S`, add a new version to *both* secrets
(`gcloud secrets versions add … --data-file=-`), then restart the messenger and
the OIDC provider so they pick up `latest`.

`first_party: true` auto-grants consent (no consent screen) — the messenger is a
first-party FruitScope property.

## Wire it into `fruitscope-cluster-config` (prod)

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
