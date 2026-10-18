#!/usr/bin/env bash
# Runs a small export exactly like the agent does, then shows the new log row.
# An email should also arrive for both admins.
#   bash test_logging.sh
set -euo pipefail

BUCKET="your-gcp-project-id-prospect-exports"
RUN_ID="$(date +%Y%m%d%H%M%S)"
SLUG="Logging_Test_Event"

echo "==> Exporting 25 test rows"
bq query --location=US --use_legacy_sql=false >/dev/null <<SQL
-- META | event=Logging Test Event | solution=Agentic AI | titles=CMO | location=Any, Any, United States | requested=25
EXPORT DATA OPTIONS(
  uri='gs://${BUCKET}/exports/${RUN_ID}/${SLUG}_*.csv',
  format='CSV', overwrite=true, header=true
) AS
SELECT Company_Name AS \`Company Name\`, Email_ID AS \`Email ID\`, Job_Title AS \`Job Title\`
FROM \`your-gcp-project-id.raw_marketing_vendor_database.v_prospects_clean\`
WHERE REGEXP_CONTAINS(LOWER(Job_Title), r'\b(cmo|chief marketing officer)\b')
LIMIT 25
SQL

echo "==> Waiting 45 seconds for the helper to log and email"
sleep 45

echo "==> Latest log rows:"
bq query --location=US --use_legacy_sql=false --format=pretty "
SELECT FORMAT_TIMESTAMP('%d %b %Y %I:%M %p', generated_at, 'Asia/Kolkata') AS time_ist,
       user_email, event_name, solution, requested_count, delivered_count, file_name
FROM \`your-gcp-project-id.prospect_agent_logs.generation_log\`
ORDER BY generated_at DESC
LIMIT 5"

echo ""
echo "Now check your inbox for: Prospect Database Generated — ... — 25 records"
