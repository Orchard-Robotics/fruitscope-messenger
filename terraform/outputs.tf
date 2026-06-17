output "load_balancer_ip" {
  description = "Global anycast IP the apex A record points at"
  value       = google_compute_global_address.default.address
}

output "cloud_run_url" {
  description = "Direct Cloud Run URL (locked to the LB by ingress)"
  value       = google_cloud_run_v2_service.verdant.uri
}

output "url" {
  value = "https://${var.domain}"
}
