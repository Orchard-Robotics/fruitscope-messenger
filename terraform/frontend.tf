# Static SPA hosting: a public GCS bucket fronted by Cloud CDN. The built client
# is uploaded by CI (gcloud storage rsync); the load balancer serves it as the
# default backend, routing only /api, /socket.io and /health to Cloud Run.
#
# The bucket itself is created once by bootstrap (so the first CI run has a
# target to upload to before the LB flips); declared here as data so Terraform
# manages the CDN wiring without owning the bucket's lifecycle.

data "google_storage_bucket" "web" {
  name = "${var.project_id}-verdant-web"
}

resource "google_compute_backend_bucket" "web" {
  name        = "verdant-web-backend"
  bucket_name = data.google_storage_bucket.web.name
  enable_cdn  = true

  cdn_policy {
    cache_mode  = "CACHE_ALL_STATIC"
    client_ttl  = 3600
    default_ttl = 3600
    max_ttl     = 86400

    # Collapse concurrent edge-fill requests into one origin request.
    request_coalescing = true
  }

  # Brotli/gzip at the edge.
  compression_mode = "AUTOMATIC"
}
