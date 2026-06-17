resource "random_password" "db" {
  length  = 24
  special = false # keep it URL-safe for the connection string
}

resource "google_sql_database_instance" "verdant" {
  name                = "verdant-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = false

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE" # shared-core tiers (db-f1-micro) require ENTERPRISE, not ENTERPRISE_PLUS
    availability_type = "ZONAL"
    disk_size         = 10
    disk_autoresize   = true

    backup_configuration {
      enabled = true
    }

    ip_configuration {
      # Public IP, but reachable only through the Cloud Run Cloud SQL connector
      # (IAM-authenticated). No authorized networks are opened.
      ipv4_enabled = true
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "verdant" {
  name     = "verdant"
  instance = google_sql_database_instance.verdant.name
}

resource "google_sql_user" "verdant" {
  name     = "verdant"
  instance = google_sql_database_instance.verdant.name
  password = random_password.db.result
}
