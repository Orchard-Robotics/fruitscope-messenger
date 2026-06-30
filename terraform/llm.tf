# LLM access for admin-created bots. We reuse the SAME provider API keys as the
# sibling FarmAgent app (already provisioned in this project as Secret Manager
# secrets), so the messenger gets identical access to Anthropic / OpenAI / Google
# models via @earendil-works/pi-ai. The runtime service account is granted read
# on each; the keys are injected as the env vars pi-ai's providers expect
# (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY → Google).

data "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "farmagent-anthropic-api-key"
}

data "google_secret_manager_secret" "openai_api_key" {
  secret_id = "farmagent-openai-api-key"
}

data "google_secret_manager_secret" "google_api_key" {
  secret_id = "farmagent-google-api-key"
}

resource "google_secret_manager_secret_iam_member" "runtime_anthropic_key" {
  secret_id = data.google_secret_manager_secret.anthropic_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_openai_key" {
  secret_id = data.google_secret_manager_secret.openai_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_google_key" {
  secret_id = data.google_secret_manager_secret.google_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
