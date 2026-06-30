# Uploaded media (profile pictures): a dedicated public GCS bucket fronted by its
# own Cloud CDN, on its own subdomain (media.<domain>).
#
# The browser reads avatars STRAIGHT from the CDN — the load balancer host-routes
# media.<domain> to this backend bucket (see loadbalancer.tf), never to Cloud Run.
# The Cloud Run service only writes objects here (it never serves image bytes).

resource "google_storage_bucket" "media" {
  name                        = "${var.project_id}-verdant-media"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  depends_on = [google_project_service.services]
}

# Public read — avatars are public images served via the CDN.
resource "google_storage_bucket_iam_member" "media_public" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# The Cloud Run runtime SA uploads + deletes avatar objects (server-side upload).
resource "google_storage_bucket_iam_member" "media_writer" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_compute_backend_bucket" "media" {
  name        = "verdant-media-backend"
  bucket_name = google_storage_bucket.media.name
  enable_cdn  = true

  # Avatars are public images served on a different origin (media.<domain>) than
  # the app (<domain>). Add CORS + cross-origin-resource-policy at the CDN edge so
  # the browser can use them cross-origin (crossorigin <img>, canvas / session
  # replay, fetch). STATIC headers — safe to cache and origin-agnostic (the bytes
  # are public, so `*` is correct), avoiding the Vary-on-Origin caching pitfalls
  # of bucket-level CORS behind a CDN.
  custom_response_headers = [
    "Access-Control-Allow-Origin: *",
    "Cross-Origin-Resource-Policy: cross-origin",
    "Access-Control-Allow-Methods: GET, HEAD, OPTIONS",
    "Access-Control-Max-Age: 3600",
  ]

  cdn_policy {
    cache_mode = "CACHE_ALL_STATIC"
    client_ttl = 3600
    # Object keys are unique per upload and written with immutable Cache-Control,
    # so a changed avatar is a new URL — cache aggressively.
    default_ttl        = 86400
    max_ttl            = 604800
    request_coalescing = true
  }

  compression_mode = "AUTOMATIC"
}
