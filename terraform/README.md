# Verdant infrastructure

Standalone GCP deployment for `fruitscope-messenger.com` — **not** part of the
fruitscope.com GKE/ArgoCD setup.

```
GitHub Actions ──(WIF, keyless)──▶ Terraform ──▶ GCP
                                                  ├─ Cloud Run (verdant)   single instance, WS-tuned
                                                  ├─ Cloud SQL (Postgres 16)
                                                  ├─ Secret Manager (DATABASE_URL)
                                                  └─ Global HTTPS LB ─▶ apex A record (Cloud DNS)
```

## Pipeline

- **Open a PR** → `terraform plan` runs (shows the diff). No changes are applied.
- **Merge to `main`** → the image is built & pushed to Artifact Registry and
  `terraform apply` runs. **That is the production deploy.**

The image is tagged with the commit SHA and passed to Terraform via
`-var container_image=…`, so each deploy pins an immutable image.

## One-time bootstrap

Run once by a project owner (creates only free resources — state bucket, the
Artifact Registry repo, a deploy service account, and Workload Identity
Federation, plus the repo's Actions variables):

```bash
bash terraform/bootstrap.sh
```

After that, the GitHub Actions workflow authenticates to GCP with no JSON key.

## Notes

- **First deploy**: the Google-managed TLS cert provisions only after the apex
  A record resolves to the LB IP — allow ~15–60 min for HTTPS to go green.
- **Single instance** (`min=max=1`): Socket.IO presence/typing is in-memory.
  Scaling out means adding Memorystore (Redis) + `@socket.io/redis-adapter`.
- **State** lives in `gs://fruitscope-messenger-tfstate` (versioned).
- **DB access**: Cloud Run reaches Cloud SQL over the IAM-authenticated Cloud
  SQL connector (unix socket at `/cloudsql`), not a public network path.

## Manual run (rarely needed)

```bash
cd terraform
terraform init
terraform plan  -var "container_image=us-central1-docker.pkg.dev/braided-visitor-372321/verdant/verdant:latest"
terraform apply -var "container_image=…"
```
