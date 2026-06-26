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

# The client secret is provisioned out-of-band in Secret Manager
# (verdant-oidc-client-secret) and shared with the OIDC provider's OAUTH_CLIENTS;
# Terraform only references it, so it is not a Terraform output. Read it with:
#   gcloud secrets versions access latest --secret=verdant-oidc-client-secret
