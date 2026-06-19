# Static SPA hosting: a public GCS bucket fronted by Cloud CDN. Terraform owns
# the bucket (created + made public + website-configured here); CI uploads the
# built client to it. The load balancer serves it as the default backend and
# routes only /api, /socket.io and /health to Cloud Run.

resource "google_storage_bucket" "web" {
  name                        = "${var.project_id}-verdant-web"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  website {
    main_page_suffix = "index.html"
    # SPA deep links (e.g. /channels/x) resolve to the app shell.
    not_found_page = "index.html"
  }

  depends_on = [google_project_service.services]
}

# Public read — this is a public website's static assets.
resource "google_storage_bucket_iam_member" "web_public" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_compute_backend_bucket" "web" {
  name        = "verdant-web-backend"
  bucket_name = google_storage_bucket.web.name
  enable_cdn  = true

  cdn_policy {
    cache_mode         = "CACHE_ALL_STATIC"
    client_ttl         = 3600
    default_ttl        = 3600
    max_ttl            = 86400
    request_coalescing = true
  }

  # Brotli/gzip at the edge.
  compression_mode = "AUTOMATIC"
}
