# Point the apex domain at the load balancer IP, in the existing Cloud DNS zone.
resource "google_dns_record_set" "apex" {
  name         = "${var.domain}."
  managed_zone = var.dns_zone_name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.default.address]
}

# Media subdomain → the same load balancer (host-routed to the media CDN bucket).
resource "google_dns_record_set" "media" {
  name         = "media.${var.domain}."
  managed_zone = var.dns_zone_name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.default.address]
}
