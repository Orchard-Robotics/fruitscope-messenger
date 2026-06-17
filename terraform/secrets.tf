locals {
  # Prisma over the Cloud SQL unix socket mounted by Cloud Run at /cloudsql.
  database_url = "postgresql://${google_sql_user.verdant.name}:${random_password.db.result}@localhost/${google_sql_database.verdant.name}?host=/cloudsql/${google_sql_database_instance.verdant.connection_name}&schema=public"
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "verdant-database-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = local.database_url
}
