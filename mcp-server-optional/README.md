# MCP server (optional, not in use)

A Cloud Run MCP server exposing one tool, `generate_prospect_csv`, that queries BigQuery,
writes the CSV to Cloud Storage and returns a signed download link.

It was built and tested (500 of 500 records, 11 columns) but **cannot be connected to
Gemini Enterprise** in the 66degrees organisation, because the org policy
`constraints/discoveryengine.managed.disableCustomMcpServerConnector` blocks Custom MCP
data stores. The live solution uses BigQuery `EXPORT DATA` instead (see the main README).

Keep this folder in case the policy is lifted (for example, for larger exports or a
fully chat-free flow).

- `index.js`, `package.json`: the server (Streamable HTTP at `/mcp`)
- `deploy.sh`: creates the export bucket, permissions and the Cloud Run service `marketing-prospect-mcp`
- `test.sh`: calls the tool directly from Cloud Shell

Note: this version still filters the original seven tables through a wildcard and does not use the
`v_prospects_clean` view or the Solution field. Update it before reusing it.
