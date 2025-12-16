# Cloud Run Deployment – `global-proxy`

The Rust rewrite of `cmux-proxy` can run on Cloud Run for automatic scaling and zero‑downtime rollouts. The container listens on the port Cloud Run injects through `$PORT`, so no code changes are required beyond setting the proper environment variables.

## 1. Prerequisites

- Google Cloud CLI (`gcloud`) configured with the correct project.
- Artifact Registry repository (or Container Registry) for images.
- Docker or Cloud Build privileges to build/push images.
- The `global-proxy` binary requires these environment variables:
  - `GLOBAL_PROXY_BACKEND_SCHEME=https`
  - `GLOBAL_PROXY_MORPH_DOMAIN_SUFFIX=.http.cloud.morph.so`
  - `GLOBAL_PROXY_WORKSPACE_DOMAIN_SUFFIX=.vm.freestyle.sh`
  - (Optional) `GLOBAL_PROXY_BACKEND_HOST` when targeting a custom backend; defaults are fine for production.

## 2. Build & Push Container Image

From `apps/global-proxy`:

```bash
# Configure Artifact Registry authentication (once per machine)
gcloud auth configure-docker REGION-docker.pkg.dev

# Build and push the Docker image
docker build -t REGION-docker.pkg.dev/PROJECT_ID/cmux/global-proxy:$(git rev-parse --short HEAD) .
docker push REGION-docker.pkg.dev/PROJECT_ID/cmux/global-proxy:$(git rev-parse --short HEAD)
```

> Replace `REGION` (for example `us-central1`) and `PROJECT_ID` with your real values.

## 3. Deploy to Cloud Run

```bash
gcloud run deploy global-proxy \
  --project=PROJECT_ID \
  --region=us-central1 \
  --platform=managed \
  --image=REGION-docker.pkg.dev/PROJECT_ID/cmux/global-proxy:COMMIT_HASH \
  --allow-unauthenticated \
  --port=8080 \
  --max-instances=20 \
  --set-env-vars=GLOBAL_PROXY_BACKEND_SCHEME=https,GLOBAL_PROXY_MORPH_DOMAIN_SUFFIX=.http.cloud.morph.so,GLOBAL_PROXY_WORKSPACE_DOMAIN_SUFFIX=.vm.freestyle.sh
```

### Notes

- Cloud Run performs **zero-downtime** rollouts by spinning up the new revision before shifting traffic.
- Use `--traffic` flags to do gradual rollouts if desired.
- If routing custom domains (e.g. `*.cmux.sh`), configure Cloud Run domain mappings and SSL certificates.
- For private deployments behind a load balancer, disable `--allow-unauthenticated` and front with Cloud CDN/Edge if needed.

## 4. Post-Deployment Checks

1. Validate health:  
   `curl "https://SERVICE_URL/health"`

2. Smoke test a proxied path:  
   `curl -H "Host: port-39378-uopbmezr.cmux.sh" "https://SERVICE_URL/"`

3. Inspect logs:  
   `gcloud logs tail --project=PROJECT_ID --region=us-central1 --service=global-proxy`

Cloud Run keeps previous revisions, so you can instantly roll back with `gcloud run services update-traffic --to-revisions`.
