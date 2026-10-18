/**
 * Prospect Database Agent — admin email sender
 *
 * Receives a log entry from the Cloud Run helper and emails the admins
 * a designed HTML notification.
 *
 * Setup:
 *   1. The secret below must match the one used in deploy_logging.sh.
 *   2. Run "sendTestEmail" once to authorise and preview the email.
 *   3. Deploy > New deployment > Web app
 *        Execute as: Me
 *        Who has access: Anyone
 */

const SHARED_SECRET = 'PASTE_YOUR_SECRET_HERE';
const SENDER_NAME = 'Prospect Database Agent';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    sendLogEmail_(body.to, body.data);
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  }
}

function sendLogEmail_(to, d) {
  const subject =
    '🔔 Prospect Database Generated — ' + d.userName + ' — ' + fmt_(d.delivered) + ' records';
  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: buildHtml_(d),
    body: buildText_(d),
    name: SENDER_NAME
  });
}

/* ------------------------------------------------------------------ */
/* Email design                                                        */
/* ------------------------------------------------------------------ */

function buildHtml_(d) {
  const shortfall = Number(d.delivered) < Number(d.requested);
  const heavy = Number(d.monthRecords) >= 10000;
  const FONT = "font-family:'Lexend',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const INK = '#000000';

  const badge =
    '<span style="display:inline-block;background:#10B981;color:#FFFFFF;border-radius:999px;padding:6px 14px;font-size:12px;font-weight:500;">✨ New download</span>';

  const stat = function (label, value, last, size) {
    return (
      '<td width="33%" align="center" style="padding:14px 6px;' + (last ? '' : 'border-right:1px solid #E5E7EB;') + '">' +
      '<div style="font-size:12px;color:' + INK + ';font-weight:400;">' + esc_(label) + '</div>' +
      '<div style="font-size:' + (size || 18) + 'px;font-weight:500;color:' + INK + ';margin-top:6px;">' + value + '</div>' +
      '</td>'
    );
  };

  const field = function (label, value) {
    return (
      '<tr>' +
      '<td style="padding:8px 0;font-size:14px;color:' + INK + ';font-weight:400;width:110px;vertical-align:top;">' + esc_(label) + '</td>' +
      '<td style="padding:8px 0;font-size:14px;color:' + INK + ';font-weight:500;vertical-align:top;">' + value + '</td>' +
      '</tr>'
    );
  };

  const initials = String(d.userName || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(function (p) { return p.charAt(0).toUpperCase(); })
    .join('');

  const usageNote = heavy
    ? esc_(d.userName) + ' has taken more than 10,000 prospect records this month. Review whether this volume is expected for their events.'
    : 'Usage is within the normal monthly range.';

  return (
    '<!DOCTYPE html><html><head>' +
    '<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500&display=swap" rel="stylesheet">' +
    '</head><body style="margin:0;padding:0;background:#EFEEEA;' + FONT + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFEEEA;padding:20px 12px;' + FONT + 'color:' + INK + ';">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;' + FONT + '">' +

    // Header
    '<tr><td style="background:#0B101E;padding:18px 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="30%"></td>' +
    '<td width="40%" align="center" style="color:#FFFFFF;font-size:20px;font-weight:500;letter-spacing:-0.3px;' + FONT + '">66degrees</td>' +
    '<td width="30%" align="right">' + badge + '</td>' +
    '</tr></table>' +
    '</td></tr>' +

    // Stats row
    '<tr><td style="border-bottom:1px solid #E5E7EB;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    stat('Records delivered', fmt_(d.delivered), false) +
    stat('Requested', fmt_(d.requested) + (shortfall ? ' ⚠' : ''), false) +
    stat('Generated', esc_(d.timestamp), true, 13) +
    '</tr></table>' +
    '</td></tr>' +

    // User block
    '<tr><td style="padding:20px 24px 4px 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="width:44px;height:44px;border-radius:22px;background:#E6EEF8;color:' + INK + ';font-size:15px;font-weight:500;text-align:center;vertical-align:middle;">' + esc_(initials) + '</td>' +
    '<td style="padding-left:12px;">' +
    '<div style="font-size:16px;color:' + INK + ';font-weight:500;">' + esc_(d.userName) + '</div>' +
    '<div style="font-size:12px;color:' + INK + ';font-weight:400;margin-top:2px;">Prospect database download · Marketing Database Agent</div>' +
    '</td>' +
    '</tr></table>' +
    '</td></tr>' +

    // Fields
    '<tr><td style="padding:10px 24px 2px 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    field('Email', '<a href="mailto:' + esc_(d.userEmail) + '" style="color:' + INK + ';font-weight:500;">' + esc_(d.userEmail) + '</a>') +
    field('Event', esc_(d.eventName)) +
    field('Solution', esc_(d.solution)) +
    field('Job titles', esc_(d.jobTitles)) +
    field('Location', esc_(d.location)) +
    '</table>' +
    '</td></tr>' +

    // File
    '<tr><td style="padding:14px 24px 0 24px;">' +
    '<div style="background:#F6F7F9;border-radius:10px;padding:14px 16px;">' +
    '<div style="font-size:12px;color:' + INK + ';font-weight:400;">File</div>' +
    '<div style="font-size:14px;line-height:20px;color:' + INK + ';font-weight:500;margin-top:4px;">' + esc_(d.fileName) + '</div>' +
    '<div style="margin-top:12px;">' +
    '<a href="' + esc_(d.downloadUrl) + '" style="display:inline-block;background:#0B101E;color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:500;padding:8px 14px;border-radius:7px;' + FONT + '">Download a copy</a>' +
    '<span style="font-size:12px;color:' + INK + ';font-weight:400;margin-left:10px;">Link valid for 7 days</span>' +
    '</div>' +
    '</div>' +
    '</td></tr>' +

    // Monthly usage
    '<tr><td style="padding:14px 24px 0 24px;">' +
    '<div style="background:#F1EEFD;border:1px solid #D9D2F7;border-radius:10px;padding:14px 16px;">' +
    '<div style="font-size:14px;color:' + INK + ';font-weight:500;">Monthly usage</div>' +
    '<div style="font-size:12px;color:' + INK + ';font-weight:400;margin-top:2px;">' + esc_(d.userName) + ' · ' + esc_(d.monthLabel) + '</div>' +
    '<div style="font-size:14px;color:' + INK + ';font-weight:500;margin-top:10px;">' +
    fmt_(d.monthRecords) + ' records across ' + fmt_(d.monthDownloads) + ' download' + (Number(d.monthDownloads) === 1 ? '' : 's') +
    '</div>' +
    '<div style="font-size:13px;line-height:20px;color:' + INK + ';font-weight:400;margin-top:4px;">' + usageNote + '</div>' +
    '</div>' +
    '</td></tr>' +
    '<tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>' +

    // Footer
    '<tr><td align="center" style="background:#B6C0C8;padding:14px 24px;font-size:12px;color:' + INK + ';font-weight:400;">© 66degrees. All rights reserved.</td></tr>' +

    '</table></td></tr></table></body></html>'
  );
}

function buildText_(d) {
  return [
    'New prospect database generated',
    '',
    'User name: ' + d.userName + ' (' + d.userEmail + ')',
    'Time stamp: ' + d.timestamp,
    'Database Count: ' + fmt_(d.delivered) + ' delivered (' + fmt_(d.requested) + ' requested)',
    '',
    'Event name: ' + d.eventName,
    'Solution: ' + d.solution,
    'Job titles: ' + d.jobTitles,
    'Location: ' + d.location,
    'File: ' + d.fileName,
    'Download (7 days): ' + d.downloadUrl,
    '',
    d.userName + "'s total this month: " + fmt_(d.monthRecords) + ' records (' + fmt_(d.monthDownloads) + ' downloads)'
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function esc_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt_(n) {
  const num = Number(n);
  return isFinite(num) ? num.toLocaleString('en-US') : esc_(n);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Run this once from the editor to authorise and preview the email.   */
/* ------------------------------------------------------------------ */
function sendTestEmail() {
  sendLogEmail_('admin-one@example.com,admin-two@example.com', {
    userName: 'Elaine Smith',
    userEmail: 'elaine.smith@example.com',
    timestamp: '18 Oct 2026, 10:28 AM IST',
    delivered: 5000,
    requested: 5000,
    eventName: 'Engineering the Agentic Enterprise – Atlanta',
    solution: 'Agentic AI',
    jobTitles: 'CMO, VP Marketing',
    location: 'Any, Georgia, United States',
    fileName: 'Database - Engineering the Agentic Enterprise Atlanta.csv',
    downloadUrl: 'https://storage.cloud.google.com/',
    monthRecords: 12500,
    monthDownloads: 4,
    monthLabel: 'October 2026'
  });
}
