# CanaryCode read-only developer tools (Phase 2: GitHub + Linear).
#
# CanaryCode is the Orchard-Robotics-only dev assistant. Its tools are strictly
# read-only; the tokens below MUST be scoped read-only at the source too (defense
# in depth): a fine-grained GitHub PAT with read-only repo permissions, and a
# Linear personal API key.
#
# Each secret is created with a placeholder version so the Cloud Run deploy never
# breaks, and the tool stays dormant ("not configured") until a real value is
# added. To activate a tool, add a new secret version out of band, e.g.:
#
#   printf '%s' "<token>" | gcloud secrets versions add canarycode-github-token \
#     --project=<project> --data-file=-
#   printf '%s' "<key>"   | gcloud secrets versions add canarycode-linear-key \
#     --project=<project> --data-file=-
#
# Cloud Run resolves `latest` at deploy time, so re-run the deploy (push to main)
# after adding the value. Terraform ignores the secret data so it never clobbers
# the value you set.

resource "google_secret_manager_secret" "canarycode_github_token" {
  secret_id = "canarycode-github-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "canarycode_github_token" {
  secret      = google_secret_manager_secret.canarycode_github_token.id
  secret_data = "unset"

  # The real (read-only) token is set out of band; don't overwrite it on apply.
  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_canarycode_github_token" {
  secret_id = google_secret_manager_secret.canarycode_github_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret" "canarycode_linear_key" {
  secret_id = "canarycode-linear-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "canarycode_linear_key" {
  secret      = google_secret_manager_secret.canarycode_linear_key.id
  secret_data = "unset"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_canarycode_linear_key" {
  secret_id = google_secret_manager_secret.canarycode_linear_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
