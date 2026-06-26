variable "project_id" {
  type    = string
  default = "braided-visitor-372321"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "domain" {
  type    = string
  default = "fruitscope-messenger.com"
}

variable "dns_zone_name" {
  type        = string
  description = "Existing Cloud DNS managed zone for the domain"
  default     = "fruitscope-messenger"
}

variable "service_name" {
  type    = string
  default = "verdant"
}

variable "db_tier" {
  type    = string
  default = "db-f1-micro"
}

variable "container_image" {
  type        = string
  description = "Full image reference to deploy (set by CI to the built SHA tag)"
}

variable "oidc_issuer" {
  type        = string
  description = "FruitScope OIDC provider (issuer URL)"
  default     = "https://login.fruitscope.com"
}

variable "oidc_client_id" {
  type        = string
  description = "Registered confidential client id on the OIDC provider"
  default     = "fruitscope-messenger"
}
