#!/usr/bin/env bash
#
# One-time bootstrap for the Verdant deploy pipeline. Creates everything the
# GitHub Actions workflow needs to run Terraform keylessly:
#   - enabled APIs
#   - a GCS bucket for Terraform state
#   - the Artifact Registry repo (so CI can push images before the first apply)
#   - a deploy service account with the roles Terraform needs
#   - a Workload Identity Federation pool/provider trusting this GitHub repo
#   - the repo Actions variables the workflow reads
#
# Everything here is free / negligible. The billable infrastructure is created
# later by `terraform apply` (i.e. when a PR is merged to main).
#
# Requires: gcloud (authenticated as a project owner) and gh (repo admin).
# Usage: bash terraform/bootstrap.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-braided-visitor-372321}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-Orchard-Robotics/fruitscope-messenger}"
STATE_BUCKET="${STATE_BUCKET:-fruitscope-messenger-tfstate}"

DEPLOY_SA="verdant-deployer"
DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="github-pool"
PROVIDER="github-provider"

echo "▶ Enabling APIs…"
gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  compute.googleapis.com dns.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com --project "$PROJECT_ID"

echo "▶ Terraform state bucket…"
gcloud storage buckets create "gs://${STATE_BUCKET}" \
  --project "$PROJECT_ID" --location "$REGION" --uniform-bucket-level-access 2>/dev/null \
  || echo "  (bucket already exists)"
gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning >/dev/null

echo "▶ Artifact Registry repo…"
gcloud artifacts repositories create verdant \
  --repository-format=docker --location="$REGION" --project "$PROJECT_ID" \
  --description="Verdant container images" 2>/dev/null || echo "  (repo already exists)"

echo "▶ Deploy service account…"
gcloud iam service-accounts create "$DEPLOY_SA" --project "$PROJECT_ID" \
  --display-name "Verdant GHA deployer" 2>/dev/null || echo "  (SA already exists)"

for role in \
  roles/run.admin \
  roles/cloudsql.admin \
  roles/artifactregistry.admin \
  roles/secretmanager.admin \
  roles/compute.admin \
  roles/dns.admin \
  roles/iam.serviceAccountAdmin \
  roles/iam.serviceAccountUser \
  roles/resourcemanager.projectIamAdmin \
  roles/serviceusage.serviceUsageAdmin \
  roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOY_SA_EMAIL}" --role "$role" --condition=None >/dev/null
done

echo "▶ Workload Identity Federation…"
gcloud iam workload-identity-pools create "$POOL" --project "$PROJECT_ID" \
  --location global --display-name "GitHub Actions" 2>/dev/null || echo "  (pool exists)"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL" \
  --display-name "GitHub" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition "assertion.repository_owner=='Orchard-Robotics'" \
  --issuer-uri "https://token.actions.githubusercontent.com" 2>/dev/null || echo "  (provider exists)"

POOL_NAME="$(gcloud iam workload-identity-pools describe "$POOL" \
  --project "$PROJECT_ID" --location global --format='value(name)')"
PROVIDER_NAME="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL" \
  --format='value(name)')"

echo "▶ Allowing ${REPO} to impersonate the deploy SA…"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --project "$PROJECT_ID" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${REPO}" >/dev/null

echo "▶ Setting GitHub Actions variables on ${REPO}…"
gh variable set GCP_PROJECT_ID  --repo "$REPO" --body "$PROJECT_ID"
gh variable set GCP_REGION      --repo "$REPO" --body "$REGION"
gh variable set GCP_DEPLOY_SA   --repo "$REPO" --body "$DEPLOY_SA_EMAIL"
gh variable set GCP_WIF_PROVIDER --repo "$REPO" --body "$PROVIDER_NAME"

echo "✅ Bootstrap complete."
echo "   WIF provider: $PROVIDER_NAME"
echo "   Deploy SA:    $DEPLOY_SA_EMAIL"
