# Examples

Worked examples of how the Marketing Database Agent behaves, end to end.
All names, companies and emails on this page are **fictional**.

---

## 1. First message: the agent always asks for the details

Whatever the user types first, the agent replies only with the template.

**User:**
```
hi
```

**Agent:**
```
👋 Welcome! Please fill in the details below to generate your prospect database:

Event Name:
Solution: (e.g. Agentic AI, Data & AI, Cloud, Security — or "None")
Database Count: (maximum 5000)
Job Title(s):
City: (or "Any")
State: (or "Any")
Country: (or "Any")
```

A partial request keeps what the user already gave:

**User:**
```
I need 10 prospects for my Atlanta event
```

**Agent:** the same template, with `Database Count: 10` already filled in. It asks only for the missing fields.

---

## 2. Standard request

**User** (or click **🎯 Build a Prospect Database** and fill it in):
```
Event Name: Cloud Leaders Summit – Texas
Solution: Data & AI
Database Count: 300
Job Title(s): CIO, CTO
City: Any
State: Texas
Country: United States
```

The user clicks **Send** on the BigQuery confirmation box.

**Agent:**
```
✅ Prospect database ready — Cloud Leaders Summit – Texas
Records: 300 of 300 requested
Job titles: CIO, CTO
Location: Any, Texas, United States
📥 Download CSV
✅ All set! Your prospect database is ready. Download your CSV and start prospecting!
```

The file downloads as **`Database - Cloud Leaders Summit Texas.csv`**.

---

## 3. Solution fills a shortfall

The user's titles alone can't reach the count, so senior titles related to the
Solution fill the gap. The user's own titles always come first in the file.

**User:**
```
Event Name: Engineering the Agentic Enterprise – Atlanta
Solution: Agentic AI
Database Count: 2500
Job Title(s): CMO
City: Any
State: Any
Country: United States
```

**Agent:**
```
✅ Prospect database ready — Engineering the Agentic Enterprise – Atlanta
Records: 2500 of 2500 requested
Job titles: CMO
Location: Any, Any, United States
📥 Download CSV
Your job titles matched 433. Added 2067 senior Agentic AI-related prospects to reach the count.
✅ All set! Your prospect database is ready. Download your CSV and start prospecting!
```

Extra titles for **Agentic AI** look like: *Chief AI Officer, VP Engineering, Director of
Digital Transformation, Head of Automation, CTO, CIO*.

| Solution | Keywords used to find related senior titles |
|---|---|
| Agentic AI | ai, machine learning, automation, innovation, digital transformation, technology, engineering, data |
| Data & AI | data, analytics, ai, machine learning, business intelligence, data science, insights |
| Cloud | cloud, infrastructure, it, devops, platform, architecture, engineering |
| Security | security, cybersecurity, infosec, information security, risk |
| Marketing | marketing, demand generation, growth, brand, digital |
| Sales | sales, revenue, business development, commercial |

Seniority is always required: chief / VP / SVP / EVP / head / director (or a C-level abbreviation).

---

## 4. Fewer matches than requested

**User:** asks for 2,000 *Director of IT* in *Boise, Idaho* with `Solution: None`.

**Agent:**
```
✅ Prospect database ready — Idaho IT Roundtable
Records: 186 of 2000 requested
...
Only 186 matching records were available.
✅ All set! ...
```

---

## 5. No matches

**Agent:**
```
No matching prospects were found for these criteria.
Job titles: Chief Happiness Officer · Solution: None · Location: Any, Vermont, United States
```
No file is created and no email is sent.

---

## 6. Job title matching

Titles use word-boundary matching, so short titles never match inside other words.

| Requested | ✅ Matches | ❌ Does not match |
|---|---|---|
| CTO | Chief Technology Officer, CTO & Co-founder | **Director** (contains "cto") |
| CMO | Chief Marketing Officer, CMO | Director of Marketing |
| VP Marketing | Vice President of Marketing, SVP Marketing, VP, Product Marketing | Director of Marketing |
| Director of IT | Director of Information Technology, IT Director | Director of Finance, Director of Digital Marketing |
| Director of Marketing | Senior Director, Product Marketing; Marketing Director | Director of Finance |

---

## 7. The CSV

11 columns, always in this order. Sample with fictional data:
[`sample_output.csv`](sample_output.csv)

| Company Name | Website | First Name | Last Name | Job Title | Email ID | Industry | Prospect LinkedIn | City | State | Country |
|---|---|---|---|---|---|---|---|---|---|---|
| Acme Analytics | http://www.acme-analytics.example | Jordan | Lee | Chief Marketing Officer | jordan.lee@acme-analytics.example | computer software | http://www.linkedin.com/in/example-jordan-lee | Atlanta | Georgia | United States |

Rules applied before export:
- valid email format only, one row per email (duplicates across tables removed),
- `Do_Not_Email` and `Opted_Out` contacts excluded,
- City / State / Country fall back to the Person, then Company, columns when blank,
- values are copied exactly from the source (State may appear as "GA" or "Georgia").

---

## 8. The SQL the agent runs (filled-in example)

For `Job Title(s): CIO, CTO`, `State: Texas`, `Country: United States`, `Solution: Data & AI`, `Count: 300`:

```sql
-- META | event=Cloud Leaders Summit – Texas | solution=Data & AI | titles=CIO, CTO | location=Any, Texas, United States | requested=300
EXPORT DATA OPTIONS(
  uri='gs://your-gcp-project-id-prospect-exports/exports/20261018063012/Cloud_Leaders_Summit_Texas_*.csv',
  format='CSV', overwrite=true, header=true
) AS
SELECT Company_Name AS `Company Name`, Website, First_Name AS `First Name`, Last_Name AS `Last Name`,
       Job_Title AS `Job Title`, Email_ID AS `Email ID`, Industry, Prospect_LinkedIn AS `Prospect LinkedIn`,
       City, State, Country
FROM (
  SELECT *,
    IFNULL(REGEXP_CONTAINS(LOWER(Job_Title), r'\b(cio|chief information officer)\b')
        OR REGEXP_CONTAINS(LOWER(Job_Title), r'\b(cto|chief technology officer|chief technical officer)\b'), FALSE) AS is_primary
  FROM `your-gcp-project-id.raw_marketing_vendor_database.v_prospects_clean`
  WHERE TRUE
    AND LOWER(State) IN ('texas', 'tx')
    AND LOWER(Country) IN ('united states', 'united states of america', 'usa', 'us')
    AND ( IFNULL(REGEXP_CONTAINS(LOWER(Job_Title), r'\b(cio|chief information officer)\b')
              OR REGEXP_CONTAINS(LOWER(Job_Title), r'\b(cto|chief technology officer|chief technical officer)\b'), FALSE)
          OR IFNULL(REGEXP_CONTAINS(LOWER(Job_Title), r'\b(chief|cio|cto|cdo|ciso|cmo|cro|caio|vp|vice president|svp|evp|head|director)\b')
                AND REGEXP_CONTAINS(LOWER(Job_Title), r'\b(data|analytics|ai|artificial intelligence|machine learning|ml|business intelligence|bi|data science|insights|cdo|caio)\b'), FALSE) )
  ORDER BY IF(is_primary, 0, 1), FARM_FINGERPRINT(Email_ID)
  LIMIT 300
)
ORDER BY `Company Name`, `Last Name`, `First Name`
```

The `-- META` line is read by the helper to fill the admin email and log. It is never shown to users.

---

## 9. The admin email

Sent to both admins about 30 seconds after every generation. See
[`../docs/admin-email-preview.png`](../docs/admin-email-preview.png).

**Subject:** `🔔 Prospect Database Generated — Jordan Lee — 2,500 records`

Contents: records delivered / requested / generated time, user name and email, event,
solution, job titles, location, file name, a **Download a copy** button (7-day link) and the
user's **monthly usage** (adds a review note above 10,000 records in a month).

---

## 10. The log table

`your-gcp-project-id.prospect_agent_logs.generation_log`, one row per generation:

| generated_at (IST) | user_email | event_name | solution | job_titles | location | requested | delivered | file_name |
|---|---|---|---|---|---|---|---|---|
| 18 Oct 2026 10:28 AM | jordan.lee@example.com | Engineering the Agentic Enterprise – Atlanta | Agentic AI | CMO | Any, Any, United States | 2500 | 2500 | Database - Engineering the Agentic Enterprise Atlanta.csv |
| 18 Oct 2026 12:02 PM | priya.shah@example.com | Cloud Leaders Summit – Texas | Data & AI | CIO, CTO | Any, Texas, United States | 300 | 300 | Database - Cloud Leaders Summit Texas.csv |

### Admin questions you can answer with SQL

How much did each user take this month?
```sql
SELECT user_email, COUNT(*) AS downloads, SUM(delivered_count) AS records
FROM `your-gcp-project-id.prospect_agent_logs.generation_log`
WHERE DATE(generated_at, 'Asia/Kolkata') >= DATE_TRUNC(CURRENT_DATE('Asia/Kolkata'), MONTH)
GROUP BY user_email ORDER BY records DESC;
```

Which events pulled the most data?
```sql
SELECT event_name, COUNT(*) AS downloads, SUM(delivered_count) AS records
FROM `your-gcp-project-id.prospect_agent_logs.generation_log`
GROUP BY event_name ORDER BY records DESC;
```

Daily activity for the last 30 days:
```sql
SELECT DATE(generated_at, 'Asia/Kolkata') AS day, COUNT(*) AS downloads, SUM(delivered_count) AS records
FROM `your-gcp-project-id.prospect_agent_logs.generation_log`
WHERE generated_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day ORDER BY day DESC;
```

Requests where the database could not fill the count:
```sql
SELECT generated_at, user_email, event_name, requested_count, delivered_count
FROM `your-gcp-project-id.prospect_agent_logs.generation_log`
WHERE delivered_count < requested_count
ORDER BY generated_at DESC;
```

---

## 11. Adding a new source table

1. Load the new table into `raw_marketing_vendor_database` (any name). It needs at least
   `Email` and `Company` columns. Other columns are optional (missing ones become blank).
2. Wait up to an hour, or rebuild the view now:
   ```sql
   CALL `your-gcp-project-id.raw_marketing_vendor_database.refresh_prospect_view`();
   ```
3. The agent searches the new table automatically. No change to the agent is needed.
