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

# --- OIDC client registration (for the FruitScope provider side) ---

output "oidc_client_id" {
  description = "Client id to register on the OIDC provider"
  value       = var.oidc_client_id
}

output "oidc_redirect_uri" {
  description = "Redirect URI to register on the OIDC provider"
  value       = "https://${var.domain}/api/auth/callback"
}

output "oidc_client_secret" {
  description = "Confidential client secret — register the SAME value in the provider's OAUTH_CLIENTS"
  value       = random_password.oidc_client_secret.result
  sensitive   = true
}
