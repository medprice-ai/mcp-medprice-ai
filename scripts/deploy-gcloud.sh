#!/bin/bash
# Deploy the MCP server to Google Cloud Run pulling from Artifact Registry.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated: gcloud auth login
#   2. Project set: gcloud config set project YOUR_PROJECT_ID
#   3. Artifact Registry repo exists at us-central1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-medprice-ai
#
# Usage:
#   ./scripts/deploy-gcloud.sh

set -euo pipefail

REGION="us-central1"
SERVICE_NAME="mcp-server"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
GRPC_HOST="api.medprice.ai:443"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: PROJECT_ID is not set and gcloud has no active project" >&2
  exit 1
fi

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/mcp-medprice-ai/mcp-medprice-ai:latest"

gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --update-env-vars GRPC_HOST="$GRPC_HOST"