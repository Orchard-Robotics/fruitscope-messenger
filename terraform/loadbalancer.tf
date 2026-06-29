# Global external HTTPS load balancer in front of the Cloud Run service.
# Handles WebSockets transparently; TLS via a Google-managed certificate.

resource "google_compute_global_address" "default" {
  name       = "verdant-ip"
  depends_on = [google_project_service.services]
}

resource "google_compute_region_network_endpoint_group" "serverless" {
  name                  = "verdant-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.verdant.name
  }
}

resource "google_compute_backend_service" "default" {
  name                  = "verdant-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTP"

  backend {
    group = google_compute_region_network_endpoint_group.serverless.id
  }
}

resource "google_compute_url_map" "default" {
  name = "verdant-urlmap"

  # Default: the static SPA on GCS + Cloud CDN.
  default_service = google_compute_backend_bucket.web.id

  host_rule {
    hosts        = ["*"]
    path_matcher = "main"
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_bucket.web.id

    # Dynamic paths → Cloud Run (REST + WebSockets).
    path_rule {
      paths   = ["/api", "/api/*", "/socket.io", "/socket.io/*", "/health"]
      service = google_compute_backend_service.default.id
    }

    # Uploaded media (profile pictures) → the CDN-backed media bucket, served
    # directly to the browser (never through Cloud Run).
    path_rule {
      paths   = ["/avatars/*"]
      service = google_compute_backend_bucket.media.id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "default" {
  name = "verdant-cert"

  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "default" {
  name             = "verdant-https-proxy"
  url_map          = google_compute_url_map.default.id
  ssl_certificates = [google_compute_managed_ssl_certificate.default.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "verdant-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.default.id
  ip_address            = google_compute_global_address.default.id
  port_range            = "443"
}

# Redirect HTTP → HTTPS.
resource "google_compute_url_map" "redirect" {
  name = "verdant-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "verdant-http-proxy"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "verdant-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.redirect.id
  ip_address            = google_compute_global_address.default.id
  port_range            = "80"
}
