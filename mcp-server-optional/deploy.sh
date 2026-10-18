#!/usr/bin/env bash
# Deploys the Marketing Prospect MCP server to Cloud Run.
# Run from Cloud Shell inside the folder that contains index.js and package.json:
#   bash deploy.sh
set -euo pipefail

PROJECT_ID="your-gcp-project-id"
PROJECT_NUMBER="YOUR_PROJECT_NUMBER"
REGION="us-central1"
SERVICE="marketing-prospect-mcp"
BUCKET="${PROJECT_ID}-prospect-exports"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
GEMINI_SA="service-${PROJECT_NUMBER}@gcp-sa-discoveryengine.iam.gserviceaccount.com"

echo "==> 1/7 Selecting project"
gcloud config set project "${PROJECT_ID}"

echo "==> 2/7 Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  storage.googleapis.com \
  bigquery.googleapis.com

echo "==> 3/7 Creating export bucket (skipped if it already exists)"
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

echo "==> 4/7 Auto-deleting exported CSVs after 7 days"
cat > /tmp/prospect-lifecycle.json <<'JSON'
{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 7 } } ] }
JSON
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file=/tmp/prospect-lifecycle.json

echo "==> 5/7 Granting the runtime service account storage + URL-signing access"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectAdmin" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" >/dev/null

echo "==> 6/7 Deploying Cloud Run service ${SERVICE}"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --service-account "${RUNTIME_SA}" \
  --no-allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 5 \
  --set-env-vars "PROJECT_ID=${PROJECT_ID},DATASET_ID=raw_marketing_vendor_database,BQ_LOCATION=US,EXPORT_BUCKET=${BUCKET},MAX_RECORDS=5000,LINK_HOURS=24"

echo "==> 7/7 Allowing Gemini Enterprise to call the service"
gcloud run services add-iam-policy-binding "${SERVICE}" \
  --region "${REGION}" \
  --member="serviceAccount:${GEMINI_SA}" \
  --role="roles/run.invoker" >/dev/null

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"
echo ""
echo "Done."
echo "MCP Server URL for Gemini Enterprise: ${URL}/mcp"
