# Runtime identity for the Cloud Run service.
resource "google_service_account" "runtime" {
  account_id   = "verdant-run"
  display_name = "Verdant Cloud Run runtime"
}

resource "google_project_iam_member" "runtime_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Read-only Cloud Logging access for CanaryCode's logs tool (GKE/prod logs).
resource "google_project_iam_member" "runtime_logging_viewer" {
  project = var.project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_db_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
