// Marketing Prospect MCP Server
// Exposes one MCP tool, generate_prospect_csv, over Streamable HTTP at /mcp.
// The tool queries BigQuery, builds the CSV, stores it in Cloud Storage and
// returns a short-lived download link. Prospect rows never pass through chat.

import express from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PROJECT_ID = process.env.PROJECT_ID || 'your-gcp-project-id';
const DATASET_ID = process.env.DATASET_ID || 'raw_marketing_vendor_database';
const TABLE_PREFIX = process.env.TABLE_PREFIX || 'Marketing_Database_';
const BQ_LOCATION = process.env.BQ_LOCATION || 'US';
const BUCKET = process.env.EXPORT_BUCKET || `${PROJECT_ID}-prospect-exports`;
const MAX_RECORDS = Number(process.env.MAX_RECORDS || 5000);
const LINK_HOURS = Number(process.env.LINK_HOURS || 24);
const PORT = Number(process.env.PORT || 8080);

const bigquery = new BigQuery({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });

// Output schema: exact column order of the delivered CSV.
const OUTPUT_COLUMNS = [
  'Company Name',
  'Website',
  'First Name',
  'Last Name',
  'Job Title',
  'Email ID',
  'Industry',
  'Prospect LinkedIn',
  'City',
  'State',
  'Country'
];

// ---------------------------------------------------------------------------
// Job-title matching
// Each requested title becomes a group of word-boundary regexes that must ALL
// match (any order). Groups are OR-ed. Word boundaries stop "CTO" from
// matching "Director".
// ---------------------------------------------------------------------------
const WHOLE_TITLE_ALIASES = {
  ceo: ['ceo', 'chief executive officer'],
  cfo: ['cfo', 'chief financial officer'],
  coo: ['coo', 'chief operating officer'],
  cmo: ['cmo', 'chief marketing officer'],
  cio: ['cio', 'chief information officer'],
  cto: ['cto', 'chief technology officer', 'chief technical officer'],
  cdo: ['cdo', 'chief data officer', 'chief digital officer'],
  ciso: ['ciso', 'chief information security officer'],
  cso: ['cso', 'chief security officer', 'chief strategy officer'],
  cro: ['cro', 'chief revenue officer'],
  cpo: ['cpo', 'chief product officer', 'chief people officer'],
  chro: ['chro', 'chief human resources officer', 'chief people officer'],
  caio: ['caio', 'chief ai officer', 'chief artificial intelligence officer']
};

const TOKEN_ALIASES = {
  vp: ['vp', 'vice president', 'svp', 'evp', 'avp'],
  svp: ['svp', 'senior vice president'],
  evp: ['evp', 'executive vice president'],
  avp: ['avp', 'assistant vice president'],
  dir: ['dir', 'director'],
  director: ['director', 'dir'],
  sr: ['sr', 'senior'],
  senior: ['senior', 'sr'],
  mgr: ['mgr', 'manager'],
  manager: ['manager', 'mgr'],
  it: ['it', 'information technology'],
  hr: ['hr', 'human resources'],
  ai: ['ai', 'artificial intelligence'],
  ml: ['ml', 'machine learning'],
  eng: ['eng', 'engineering'],
  engineering: ['engineering', 'eng'],
  mktg: ['mktg', 'marketing'],
  marketing: ['marketing', 'mktg'],
  ops: ['ops', 'operations'],
  operations: ['operations', 'ops'],
  bd: ['bd', 'business development'],
  infosec: ['infosec', 'information security']
};

const STOP_WORDS = new Set(['of', 'and', 'the', 'for', 'in', 'at', '&']);

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(options) {
  const parts = options.map(o =>
    o.trim().split(/\s+/).map(escapeRegex).join('\\s+')
  );
  return `\\b(?:${parts.join('|')})\\b`;
}

function normaliseTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleToRegexGroup(rawTitle) {
  const title = normaliseTitle(rawTitle);
  if (!title) return null;

  if (WHOLE_TITLE_ALIASES[title]) {
    return [alternation(WHOLE_TITLE_ALIASES[title])];
  }

  const tokens = title.split(' ').filter(t => t && !STOP_WORDS.has(t));
  if (tokens.length === 0) return null;

  return tokens.map(token => {
    if (WHOLE_TITLE_ALIASES[token]) return alternation(WHOLE_TITLE_ALIASES[token]);
    if (TOKEN_ALIASES[token]) return alternation(TOKEN_ALIASES[token]);
    return alternation([token]);
  });
}

function splitTitles(jobTitles) {
  const list = Array.isArray(jobTitles) ? jobTitles : String(jobTitles || '').split(/[,;\n]+/);
  return list.map(t => String(t).trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Location matching
// ---------------------------------------------------------------------------
const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi',
  mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina',
  nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington',
  wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia'
};

const COUNTRY_ALIASES = [
  ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
  ['united kingdom', 'uk', 'u k', 'great britain', 'britain', 'england'],
  ['united arab emirates', 'uae', 'u a e'],
  ['india', 'in', 'bharat'],
  ['canada', 'ca'],
  ['australia', 'au'],
  ['germany', 'de', 'deutschland'],
  ['netherlands', 'nl', 'holland', 'the netherlands'],
  ['singapore', 'sg']
];

function isAny(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === '' || v === 'any' || v === 'all' || v === 'n/a' || v === 'none';
}

function cleanLocation(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stateVariants(value) {
  const v = cleanLocation(value);
  const variants = new Set([v]);
  if (US_STATES[v]) variants.add(US_STATES[v]);
  for (const [abbr, name] of Object.entries(US_STATES)) {
    if (name === v) variants.add(abbr);
  }
  return [...variants];
}

function countryVariants(value) {
  const v = cleanLocation(value);
  const group = COUNTRY_ALIASES.find(g => g.includes(v));
  return group ? [...group] : [v];
}

// ---------------------------------------------------------------------------
// BigQuery
// ---------------------------------------------------------------------------
function buildQuery({ titleGroups, hasCity, hasState, hasCountry }) {
  const titleClause = titleGroups
    .map((group, gi) =>
      '(' + group.map((_, ti) => `REGEXP_CONTAINS(LOWER(job_title), @t${gi}_${ti})`).join(' AND ') + ')'
    )
    .join(' OR ');

  return `
    WITH base AS (
      SELECT
        TRIM(Company) AS company,
        TRIM(CAST(Website AS STRING)) AS website,
        TRIM(CAST(First_Name AS STRING)) AS first_name,
        TRIM(CAST(Last_Name AS STRING)) AS last_name,
        TRIM(CAST(Job_Title AS STRING)) AS job_title,
        LOWER(TRIM(Email)) AS email,
        TRIM(CAST(Industry AS STRING)) AS industry,
        TRIM(CAST(Prospect_Linkedin AS STRING)) AS linkedin,
        COALESCE(NULLIF(TRIM(CAST(City AS STRING)), ''), NULLIF(TRIM(CAST(Person_City AS STRING)), ''), NULLIF(TRIM(CAST(Company_City AS STRING)), '')) AS city,
        COALESCE(NULLIF(TRIM(CAST(State AS STRING)), ''), NULLIF(TRIM(CAST(Person_State AS STRING)), ''), NULLIF(TRIM(CAST(Company_State AS STRING)), '')) AS state,
        COALESCE(NULLIF(TRIM(CAST(Country AS STRING)), ''), NULLIF(TRIM(CAST(Person_Country AS STRING)), ''), NULLIF(TRIM(CAST(Company_Country AS STRING)), '')) AS country
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PREFIX}*\`
      WHERE Email IS NOT NULL
        AND TRIM(Email) != ''
        AND LOWER(TRIM(Email)) != 'email'
        AND REGEXP_CONTAINS(TRIM(Email), r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        AND Company IS NOT NULL AND TRIM(Company) != ''
        AND LOWER(IFNULL(CAST(Do_Not_Email AS STRING), '')) NOT IN ('true', '1', 'yes')
        AND LOWER(IFNULL(CAST(Opted_Out AS STRING), '')) NOT IN ('true', '1', 'yes')
    ),
    matched AS (
      SELECT *
      FROM base
      WHERE job_title IS NOT NULL
        AND (${titleClause})
        ${hasCity ? 'AND LOWER(TRIM(REPLACE(city, ".", " "))) = @city' : ''}
        ${hasState ? 'AND LOWER(TRIM(REPLACE(state, ".", " "))) IN UNNEST(@states)' : ''}
        ${hasCountry ? 'AND LOWER(TRIM(REPLACE(country, ".", " "))) IN UNNEST(@countries)' : ''}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY company) = 1
    ),
    picked AS (
      SELECT *, COUNT(*) OVER () AS total_matches
      FROM matched
      ORDER BY FARM_FINGERPRINT(email)
      LIMIT @limit
    )
    SELECT * FROM picked
    ORDER BY company, last_name, first_name
  `;
}

async function searchProspects({ jobTitles, city, state, country, count }) {
  const titles = splitTitles(jobTitles);
  const titleGroups = titles.map(titleToRegexGroup).filter(Boolean);
  if (titleGroups.length === 0) {
    throw new Error('At least one job title is required.');
  }

  const params = { limit: count };
  const types = { limit: 'INT64' };
  titleGroups.forEach((group, gi) =>
    group.forEach((regex, ti) => {
      params[`t${gi}_${ti}`] = regex;
    })
  );

  const hasCity = !isAny(city);
  const hasState = !isAny(state);
  const hasCountry = !isAny(country);
  if (hasCity) params.city = cleanLocation(city);
  if (hasState) {
    params.states = stateVariants(state);
    types.states = ['STRING'];
  }
  if (hasCountry) {
    params.countries = countryVariants(country);
    types.countries = ['STRING'];
  }

  const query = buildQuery({ titleGroups, hasCity, hasState, hasCountry });
  const [rows] = await bigquery.query({ query, params, types, location: BQ_LOCATION });
  const totalMatches = rows.length ? Number(rows[0].total_matches) : 0;
  return { rows, totalMatches, titles };
}

// ---------------------------------------------------------------------------
// CSV + Cloud Storage
// ---------------------------------------------------------------------------
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const lines = [OUTPUT_COLUMNS.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([
      r.company, r.website, r.first_name, r.last_name, r.job_title, r.email,
      r.industry, r.linkedin, r.city, r.state, r.country
    ].map(csvEscape).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function slug(text, maxLength = 60) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '_')
    .slice(0, maxLength)
    .replace(/_+$/, '');
}

function buildFileName({ eventName, titles, city, state, country, actual }) {
  const location = [city, state, country].filter(v => !isAny(v)).join(' ') || 'All_Locations';
  const parts = [
    slug(eventName, 50) || 'Prospects',
    slug(titles.join(' '), 40),
    slug(location, 30),
    String(actual)
  ].filter(Boolean);
  return `${parts.join('_')}.csv`;
}

async function uploadAndSign(fileName, csv) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const objectPath = `exports/${stamp}_${Math.random().toString(36).slice(2, 8)}/${fileName}`;
  const file = storage.bucket(BUCKET).file(objectPath);

  await file.save(csv, {
    resumable: false,
    contentType: 'text/csv; charset=utf-8',
    metadata: { cacheControl: 'no-store' }
  });

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + LINK_HOURS * 60 * 60 * 1000,
    responseDisposition: `attachment; filename="${fileName}"`,
    responseType: 'text/csv'
  });
  return url;
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------
function buildMcpServer() {
  const server = new McpServer({ name: 'marketing-prospect-export', version: '1.0.0' });

  server.registerTool(
    'generate_prospect_csv',
    {
      title: 'Generate prospect CSV',
      description:
        'Searches the 66degrees marketing prospect database (BigQuery) by job titles and location, ' +
        'removes duplicates and opted-out contacts, and returns a download link to a CSV file with ' +
        'these columns: Company Name, Website, First Name, Last Name, Job Title, Email ID, Industry, ' +
        'Prospect LinkedIn, City, State, Country. Call this once all details are collected. ' +
        'Pass "Any" for any location field that should not be filtered.',
      inputSchema: {
        event_name: z.string().min(1).describe('Event or campaign name, used in the file name.'),
        count: z.number().int().min(1).max(MAX_RECORDS).describe(`Number of prospects requested (1 to ${MAX_RECORDS}).`),
        job_titles: z.string().min(1).describe('Comma-separated job titles, e.g. "CMO, VP Marketing, Director of Marketing".'),
        city: z.string().optional().describe('City, or "Any".'),
        state: z.string().optional().describe('State (full name or abbreviation), or "Any".'),
        country: z.string().optional().describe('Country, or "Any".')
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ event_name, count, job_titles, city, state, country }) => {
      try {
        const { rows, totalMatches, titles } = await searchProspects({
          jobTitles: job_titles, city, state, country, count
        });

        const locationText = [city, state, country].map(v => (isAny(v) ? 'Any' : v)).join(', ');

        if (rows.length === 0) {
          return {
            content: [{
              type: 'text',
              text:
                `No matching prospects found for ${event_name}.\n` +
                `Job titles: ${titles.join(', ')}\nLocation: ${locationText}\n` +
                'No CSV was created. Try broader job titles or set City/State to Any.'
            }]
          };
        }

        const fileName = buildFileName({ eventName: event_name, titles, city, state, country, actual: rows.length });
        const url = await uploadAndSign(fileName, toCsv(rows));

        const lines = [
          `Prospect list ready: ${event_name}`,
          `Records: ${rows.length} of ${count} requested`,
          `Job titles: ${titles.join(', ')}`,
          `Location: ${locationText}`,
          `Download CSV: [${fileName}](${url})`,
          `The link expires in ${LINK_HOURS} hours.`
        ];
        if (rows.length < count) {
          lines.splice(2, 0, `Only ${totalMatches} matching records were found.`);
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        console.error('generate_prospect_csv failed:', error);
        return {
          isError: true,
          content: [{ type: 'text', text: `CSV export failed: ${error.message}` }]
        };
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP (stateless Streamable HTTP transport)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'marketing-prospect-mcp', mcp_endpoint: '/mcp' });
});

app.post('/mcp', async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
});

const methodNotAllowed = (_req, res) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(PORT, () => {
  console.log(`marketing-prospect-mcp listening on port ${PORT}`);
});

// Exported for local tests only.
export { titleToRegexGroup, stateVariants, countryVariants, buildQuery, toCsv, buildFileName };
