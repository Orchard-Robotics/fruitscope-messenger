# CanaryCode read-only developer tools (Phase 2: GitHub + Linear).
#
# CanaryCode is the Orchard-Robotics-only dev assistant. Its tools are strictly
# read-only. GitHub access uses an ORG-OWNED GitHub App (the credential belongs to
# the Orchard-Robotics organization, not a person): the app is granted read-only
# permissions and installed on the org, and the server mints short-lived
# installation tokens from the app's private key. Both the App permissions and the
# GET-only tool layer keep it read-only (defense in depth).
#
# What's secret vs. not:
#   - GITHUB_APP_ID / installation id: not secret -> plain Terraform variables.
#   - the App private key (PEM): secret -> Secret Manager (canarycode-github-app-key).
#   - Linear personal API key: secret -> Secret Manager (canarycode-linear-key).
#
# Each secret is seeded with an "unset" placeholder so the Cloud Run deploy never
# breaks, and the tool stays dormant ("not configured") until a real value lands:
#
#   # GitHub App private key (download the .pem from the App settings):
#   gcloud secrets versions add canarycode-github-app-key \
#     --project=<project> --data-file=./canarycode.private-key.pem
#
#   # Linear API key:
#   printf '%s' "<key>" | gcloud secrets versions add canarycode-linear-key \
#     --project=<project> --data-file=-
#
# Then set var.github_app_id (below) to the App's numeric ID and redeploy. Cloud
# Run resolves `latest` at deploy time; Terraform ignores the secret data so it
# never clobbers the value you set.

variable "github_app_id" {
  type        = string
  default     = ""
  description = "Numeric App ID of the org-owned CanaryCode GitHub App (not secret)."
}

variable "github_app_installation_id" {
  type        = string
  default     = ""
  description = "Optional: the App's installation id on the org. Auto-discovered when blank."
}

# --- Org-owned GitHub App: private key (PEM) ---

resource "google_secret_manager_secret" "canarycode_github_app_key" {
  secret_id = "canarycode-github-app-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "canarycode_github_app_key" {
  secret      = google_secret_manager_secret.canarycode_github_app_key.id
  secret_data = "unset"

  # The real private key is set out of band; don't overwrite it on apply.
  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_canarycode_github_app_key" {
  secret_id = google_secret_manager_secret.canarycode_github_app_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Optional static-token fallback (a PAT), if ever preferred over the App ---

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

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_canarycode_github_token" {
  secret_id = google_secret_manager_secret.canarycode_github_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Linear personal API key ---

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
