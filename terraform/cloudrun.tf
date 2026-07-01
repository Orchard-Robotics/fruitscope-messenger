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
      # built as ${MEDIA_PUBLIC_BASE}/<key>, served from the dedicated media
      # subdomain's CDN bucket. No GCS_EMULATOR_HOST in prod → real GCS.
      env {
        name  = "GCS_MEDIA_BUCKET"
        value = google_storage_bucket.media.name
      }

      env {
        name  = "MEDIA_PUBLIC_BASE"
        value = "https://media.${var.domain}"
      }

      # LLM provider keys (admin-created bots). Same secrets as FarmAgent; pi-ai's
      # google provider reads GEMINI_API_KEY, so the Google key is bound there.
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.openai_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.google_api_key.secret_id
            version = "latest"
          }
        }
      }

      # CanaryCode read-only dev tools (GitHub + Linear). Dormant until real,
      # read-only credentials are added; the app treats "unset"/blank as absent.
      # GitHub auth is an org-owned GitHub App: id (not secret) + private key.
      env {
        name  = "GITHUB_APP_ID"
        value = var.github_app_id
      }

      env {
        name  = "GITHUB_APP_INSTALLATION_ID"
        value = var.github_app_installation_id
      }

      env {
        name = "GITHUB_APP_PRIVATE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.canarycode_github_app_key.secret_id
            version = "latest"
          }
        }
      }

      # Optional static-token fallback (a PAT), if ever preferred over the App.
      env {
        name = "GITHUB_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.canarycode_github_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LINEAR_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.canarycode_linear_key.secret_id
            version = "latest"
          }
        }
      }

      # PostHog read-only (errors_recent): host + project are not secret; key is.
      env {
        name  = "POSTHOG_HOST"
        value = var.posthog_host
      }

      env {
        name  = "POSTHOG_PROJECT_ID"
        value = var.posthog_project_id
      }

      env {
        name = "POSTHOG_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.canarycode_posthog_key.secret_id
            version = "latest"
          }
        }
      }

      # Shared FruitScope DB (read-only). Reached over the Cloud SQL socket mounted
      # below; connection name / user / default db are not secret, the password is.
      env {
        name  = "FRUITSCOPE_DB_INSTANCE"
        value = var.fruitscope_db_instance
      }

      env {
        name  = "FRUITSCOPE_DB_USER"
        value = var.fruitscope_db_user
      }

      env {
        name  = "FRUITSCOPE_DB_DEFAULT"
        value = var.fruitscope_db_default
      }

      env {
        name = "FRUITSCOPE_DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.canarycode_fruitscope_db_password.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        # The app's own DB (verdant) + the shared FruitScope DB (read-only, for
        # CanaryCode's db_query_readonly). Both reached via the mounted socket.
        instances = [
          google_sql_database_instance.verdant.connection_name,
          var.fruitscope_db_instance,
        ]
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.runtime_db_url,
    google_secret_manager_secret_iam_member.runtime_oidc_secret,
    google_secret_manager_secret_iam_member.runtime_anthropic_key,
    google_secret_manager_secret_iam_member.runtime_openai_key,
    google_secret_manager_secret_iam_member.runtime_google_key,
    google_secret_manager_secret_version.canarycode_github_app_key,
    google_secret_manager_secret_version.canarycode_github_token,
    google_secret_manager_secret_version.canarycode_linear_key,
    google_secret_manager_secret_version.canarycode_posthog_key,
    google_secret_manager_secret_version.canarycode_fruitscope_db_password,
    google_secret_manager_secret_iam_member.runtime_canarycode_github_app_key,
    google_secret_manager_secret_iam_member.runtime_canarycode_github_token,
    google_secret_manager_secret_iam_member.runtime_canarycode_linear_key,
    google_secret_manager_secret_iam_member.runtime_canarycode_posthog_key,
    google_secret_manager_secret_iam_member.runtime_canarycode_fruitscope_db_password,
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
