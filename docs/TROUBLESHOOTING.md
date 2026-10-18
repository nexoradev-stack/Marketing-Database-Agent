# Troubleshooting

Real issues hit while building this, and their fixes.

| Symptom | Cause | Fix |
|---|---|---|
| Agent shows a table but no file / says "query results were truncated" | Gemini Enterprise tools don't share data; the file tool can't read BigQuery results | Solved by design: the agent uses BigQuery `EXPORT DATA` so BigQuery writes the CSV itself |
| `EXPORT DATA statement cannot reference meta tables in the queries` | `EXPORT DATA` can't read wildcard tables (`Marketing_Database_*`) | Export from the view `v_prospects_clean` (see `bigquery/setup_auto_view.sh`) |
| New table not appearing in results | The view refreshes hourly | Run `CALL ...refresh_prospect_view()` or wait up to an hour |
| Custom MCP data store: `Operation denied by org policy ... disableCustomMcpServerConnector` | 66degrees org policy blocks Custom MCP connectors | Needs an org admin override. The live solution doesn't use MCP |
| `Permission 'orgpolicy.policies.create' denied` | Project Owner can't change org policies | Ask a Google Cloud org admin |
| `Service account service-…@gs-project-accounts… does not exist` | Cloud Storage service agent not created yet | `gsutil kms serviceaccount -p <project>`, then retry for a few minutes |
| `--set-env-vars: Bad syntax for dict arg` | A custom delimiter clashed with `@` in email addresses | Use `--env-vars-file=env.yaml` (current `deploy_logging.sh`) |
| `bq`: `Unknown command line flag ' META | event'` | `bq` treats a query starting with `--` as a flag | Pass the SQL through stdin (heredoc), as in `test_logging.sh` |
| Log row has `generated_at = NULL` | Timestamp parameter type mismatch (older helper version) | Fixed: helper inserts `TIMESTAMP(@generated_at)` |
| Download needs 2–3 clicks (old flow) | Gemini's built-in file card | Solved: users now get a direct Cloud Storage link |
| Email looks bold/heavy in Gmail | Gmail can't load the Lexend web font | Expected. Lighter weights are used so the fallback font looks clean |
| No admin email | Apps Script URL/secret mismatch, or web app not set to "Anyone" | Check `MAIL_WEBHOOK_URL` / `MAIL_SECRET` in the function's env vars and the `SHARED_SECRET` in `Code.gs`. See function logs: `gcloud functions logs read prospect-csv-rename --region=us-central1` |
| Colleague gets "permission denied" | They lack BigQuery or bucket access | Grant BigQuery Job User + Data Viewer and object create/read on the export bucket |
