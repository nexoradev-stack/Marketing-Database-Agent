#!/usr/bin/env bash
# Calls the deployed MCP tool directly from Cloud Shell and prints the result.
#   bash test.sh
set -euo pipefail

REGION="us-central1"
SERVICE="marketing-prospect-mcp"
URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"
TOKEN="$(gcloud auth print-identity-token)"

curl -sS "${URL}/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "generate_prospect_csv",
      "arguments": {
        "event_name": "Engineering the Agentic Enterprise - Atlanta",
        "count": 500,
        "job_titles": "CMO, VP Marketing, Director of Marketing",
        "city": "Any",
        "state": "Any",
        "country": "United States"
      }
    }
  }'
echo ""
