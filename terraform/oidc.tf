# "Sign in with FruitScope" — confidential OIDC client credentials.
#
# The messenger is a confidential relying party of the FruitScope OIDC provider
# (https://login.fruitscope.com). The client secret is generated here and stored
# in Secret Manager; the SAME value must be registered on the provider side in
# its OAUTH_CLIENTS for the client_id below. After `apply`, read it with:
#
#   terraform output -raw oidc_client_secret
#
# and place it in the provider's `fruitscope-prod-oauth-clients` secret.

resource "random_password" "oidc_client_secret" {
  length  = 48
  special = false # keep it URL/JSON-safe for the OAUTH_CLIENTS config
}

resource "google_secret_manager_secret" "oidc_client_secret" {
  secret_id = "verdant-oidc-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "oidc_client_secret" {
  secret      = google_secret_manager_secret.oidc_client_secret.id
  secret_data = random_password.oidc_client_secret.result
}

resource "google_secret_manager_secret_iam_member" "runtime_oidc_secret" {
  secret_id = google_secret_manager_secret.oidc_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
