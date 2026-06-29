resource "google_cloud_run_v2_service" "verdant" {
  name     = var.service_name
  location = var.region

  # Only reachable through the external HTTPS load balancer (and internal),
  # not via the default *.run.app URL.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "3600s"
    max_instance_request_concurrency = 1000
    session_affinity                 = true

    # Single instance: Socket.IO presence/typing is in-memory. Scaling out
    # later means adding Redis (@socket.io/redis-adapter) + presence in Redis.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = var.container_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = false # CPU always allocated (keeps sockets + timers alive)
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      # "Sign in with FruitScope" (OIDC). Public origin drives the redirect URI,
      # post-login redirects and the session-cookie Secure flag.
      env {
        name  = "APP_URL"
        value = "https://${var.domain}"
      }

      env {
        name  = "OIDC_ISSUER"
        value = var.oidc_issuer
      }

      env {
        name  = "OIDC_CLIENT_ID"
        value = var.oidc_client_id
      }

      env {
        name  = "OIDC_REDIRECT_URI"
        value = "https://${var.domain}/api/auth/callback"
      }

      env {
        name = "OIDC_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.oidc_client_secret.secret_id
            version = "latest"
          }
        }
      }

      # Profile pictures: upload to the media bucket (via ADC); the public URL is
      # built as ${MEDIA_PUBLIC_BASE}/<key>, served by the CDN under /avatars/*.
      # No GCS_EMULATOR_HOST in prod → real GCS.
      env {
        name  = "GCS_MEDIA_BUCKET"
        value = google_storage_bucket.media.name
      }

      env {
        name  = "MEDIA_PUBLIC_BASE"
        value = "https://${var.domain}"
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.verdant.connection_name]
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.runtime_db_url,
    google_secret_manager_secret_iam_member.runtime_oidc_secret,
    google_storage_bucket_iam_member.media_writer,
  ]
}

# Public can invoke (network path is still restricted to the LB by ingress).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.verdant.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
