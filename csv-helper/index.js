// Prospect CSV helper (rename + log + email)
// Runs automatically whenever a new CSV lands in the export bucket under exports/.
//   1. Sets the download name:  Database - <Event Name>.csv
//   2. Finds the BigQuery export job that wrote the file (who ran it, when, what)
//   3. Counts the real rows in the file
//   4. Adds one row to the permanent log table in BigQuery
//   5. Emails the admins through the Apps Script mail sender

const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const { BigQuery } = require('@google-cloud/bigquery');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PROJECT_ID = process.env.PROJECT_ID || 'your-gcp-project-id';
const BQ_LOCATION = process.env.BQ_LOCATION || 'US';
const JOBS_VIEW = process.env.JOBS_VIEW || '`region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT';
const LOG_TABLE = process.env.LOG_TABLE || `${PROJECT_ID}.prospect_agent_logs.generation_log`;
const MAIL_WEBHOOK_URL = process.env.MAIL_WEBHOOK_URL || '';
const MAIL_SECRET = process.env.MAIL_SECRET || '';
const ADMIN_EMAILS = process.env.ADMIN_EMAILS ||
  'admin-one@example.com,admin-two@example.com';
const TIMEZONE = 'Asia/Kolkata';
const LINK_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 1000; // just under the 7-day maximum

const storage = new Storage();
const bigquery = new BigQuery({ projectId: PROJECT_ID });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function friendlyName(objectName) {
  const fileName = objectName.split('/').pop() || 'Prospects.csv';
  const base = fileName
    .replace(/\.csv$/i, '')
    .replace(/_\d{12}$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = base.replace(/["\\\r\n]/g, '').slice(0, 150) || 'Prospects';
  return `Database - ${safe}.csv`;
}

function isFirstShard(objectName) {
  return /_0{12}\.csv$/i.test(objectName);
}

function nameFromEmail(email) {
  if (!email || !email.includes('@')) return email || 'Unknown user';
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatIST(date) {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
  return `${text.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase())} IST`;
}

// Counts CSV data rows, respecting quoted values that contain line breaks.
function countCsvRows(text) {
  let rows = 0;
  let inQuotes = false;
  let lineHasContent = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      lineHasContent = true;
    } else if (ch === '\n' && !inQuotes) {
      if (lineHasContent) rows += 1;
      lineHasContent = false;
    } else if (ch !== '\r') {
      lineHasContent = true;
    }
  }
  if (lineHasContent) rows += 1;
  return Math.max(0, rows - 1); // minus header
}

// Reads "-- META | key=value | key=value" from the export SQL.
function parseMeta(query) {
  const meta = {};
  const line = (query || '').split('\n').find((l) => /--\s*META\s*\|/i.test(l));
  if (line) {
    line
      .replace(/^.*?--\s*META\s*\|/i, '')
      .split('|')
      .forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          meta[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
        }
      });
  }
  if (!meta.requested) {
    const limits = [...(query || '').matchAll(/\bLIMIT\s+(\d+)/gi)];
    if (limits.length) meta.requested = limits[limits.length - 1][1];
  }
  return meta;
}

// ---------------------------------------------------------------------------
// BigQuery lookups
// ---------------------------------------------------------------------------
async function findExportJob(bucket, objectName) {
  const folder = `${bucket}/${objectName.split('/').slice(0, -1).join('/')}/`;
  const query = `
    SELECT job_id, user_email, creation_time, query
    FROM ${JOBS_VIEW}
    WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 HOUR)
      AND statement_type = 'EXPORT_DATA'
      AND STRPOS(query, @folder) > 0
    ORDER BY creation_time DESC
    LIMIT 1`;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const [rows] = await bigquery.query({ query, params: { folder }, location: BQ_LOCATION });
    if (rows.length) return rows[0];
    await sleep(5000);
  }
  return null;
}

async function insertLog(entry) {
  const query = `
    INSERT INTO \`${LOG_TABLE}\`
      (generated_at, user_email, user_name, event_name, solution, job_titles, location,
       requested_count, delivered_count, file_name, gcs_uri, bq_job_id)
    SELECT TIMESTAMP(@generated_at), @user_email, @user_name, @event_name, @solution, @job_titles, @location,
           @requested_count, @delivered_count, @file_name, @gcs_uri, @bq_job_id
    FROM UNNEST([1])
    WHERE NOT EXISTS (SELECT 1 FROM \`${LOG_TABLE}\` WHERE gcs_uri = @gcs_uri)`;

  await bigquery.query({
    query,
    location: BQ_LOCATION,
    params: entry,
    types: {
      generated_at: 'STRING',
      user_email: 'STRING',
      user_name: 'STRING',
      event_name: 'STRING',
      solution: 'STRING',
      job_titles: 'STRING',
      location: 'STRING',
      requested_count: 'INT64',
      delivered_count: 'INT64',
      file_name: 'STRING',
      gcs_uri: 'STRING',
      bq_job_id: 'STRING'
    }
  });
}

async function monthTotals(userEmail) {
  const query = `
    SELECT COUNT(*) AS downloads, IFNULL(SUM(delivered_count), 0) AS records
    FROM \`${LOG_TABLE}\`
    WHERE user_email = @user_email
      AND DATE(generated_at, '${TIMEZONE}') >= DATE_TRUNC(CURRENT_DATE('${TIMEZONE}'), MONTH)`;
  const [rows] = await bigquery.query({
    query,
    location: BQ_LOCATION,
    params: { user_email: userEmail }
  });
  return {
    downloads: Number(rows[0]?.downloads || 0),
    records: Number(rows[0]?.records || 0)
  };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
async function sendAdminEmail(data) {
  if (!MAIL_WEBHOOK_URL || !MAIL_SECRET) {
    console.warn('Mail sender not configured; skipping email.');
    return;
  }
  const response = await fetch(MAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: MAIL_SECRET, to: ADMIN_EMAILS, data }),
    redirect: 'follow'
  });
  const text = await response.text();
  console.log(`Mail sender responded ${response.status}: ${text.slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
functions.cloudEvent('setDownloadName', async (cloudEvent) => {
  const data = cloudEvent.data || {};
  const bucket = data.bucket;
  const name = data.name || '';

  if (!bucket || !name.startsWith('exports/') || !name.toLowerCase().endsWith('.csv')) {
    return;
  }

  const file = storage.bucket(bucket).file(name);
  const downloadName = friendlyName(name);

  // 1. Download name (always)
  await file.setMetadata({
    contentDisposition: `attachment; filename="${downloadName}"`,
    contentType: 'text/csv; charset=utf-8',
    cacheControl: 'no-store'
  });
  console.log(`Set download name for gs://${bucket}/${name} -> ${downloadName}`);

  // Log and email only once per export (first file of the export)
  if (!isFirstShard(name)) return;

  try {
    // 2. Who ran it
    const job = await findExportJob(bucket, name);
    const meta = parseMeta(job?.query);
    const userEmail = job?.user_email || 'unknown';
    const generatedAt = job?.creation_time?.value
      ? new Date(job.creation_time.value)
      : new Date(data.timeCreated || Date.now());

    // 3. Real row count
    const [buffer] = await file.download();
    const delivered = countCsvRows(buffer.toString('utf8'));

    const eventName = meta.event || downloadName.replace(/^Database - /, '').replace(/\.csv$/, '');
    const requested = Number.parseInt(meta.requested, 10);

    // 4. Permanent log
    await insertLog({
      generated_at: generatedAt.toISOString(),
      user_email: userEmail,
      user_name: nameFromEmail(userEmail),
      event_name: eventName,
      solution: meta.solution || 'None',
      job_titles: meta.titles || '',
      location: meta.location || '',
      requested_count: Number.isFinite(requested) ? requested : delivered,
      delivered_count: delivered,
      file_name: downloadName,
      gcs_uri: `gs://${bucket}/${name}`,
      bq_job_id: job?.job_id || ''
    });

    // 5. Email
    const totals = await monthTotals(userEmail);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + LINK_MS
    });

    await sendAdminEmail({
      userName: nameFromEmail(userEmail),
      userEmail,
      timestamp: formatIST(generatedAt),
      delivered,
      requested: Number.isFinite(requested) ? requested : delivered,
      eventName,
      solution: meta.solution || 'None',
      jobTitles: meta.titles || '—',
      location: meta.location || '—',
      fileName: downloadName,
      downloadUrl: signedUrl,
      monthRecords: totals.records,
      monthDownloads: totals.downloads,
      monthLabel: new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, month: 'long', year: 'numeric' }).format(new Date())
    });

    console.log(`Logged and emailed: ${userEmail}, ${delivered} rows, ${eventName}`);
  } catch (error) {
    console.error('Logging or email failed (file rename already done):', error);
  }
});

module.exports = { friendlyName, parseMeta, countCsvRows, nameFromEmail, formatIST, isFirstShard };
