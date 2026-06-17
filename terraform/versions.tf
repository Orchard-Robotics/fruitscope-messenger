terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in a GCS bucket created by bootstrap.sh.
  backend "gcs" {
    bucket = "fruitscope-messenger-tfstate"
    prefix = "verdant"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
