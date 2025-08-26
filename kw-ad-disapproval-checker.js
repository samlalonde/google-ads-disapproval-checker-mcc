/******************************************************************************************
 * @name ⚠ Disapprovals — Ads, Keywords, Extensions (MCC-Level Alert)
 *
 * @overview
 * Scans client accounts under a Google Ads Manager (MCC) for disapproved Ads, Keywords,
 * and Assets/Extensions. Groups accounts by label and emails a per-label report to the
 * assigned recipient(s). Supports multiple labels and multiple recipients, making it ideal
 * for agencies or large in-house teams with several account managers. Always emails a
 * summary—even when zero disapprovals are found—and includes policy reasons when available.
 *
 * @instructions
 * 1) In your MCC: Tools & Settings → Bulk Actions → Scripts → New Script.
 * 2) Paste this file. Review the CONFIG section:
 *    - DEFAULT_TO: fallback email.
 *    - LABEL_RECIPIENTS: map account labels to recipient(s).
 *      Example: { label: 'Managed by Sam', to: 'sam@samlalonde.com', cc: '' }
 *    - SUBJECT_PREFIX and scheduling cadence (recommended: daily).
 * 3) Authorize and Preview to verify logs and sample output.
 * 4) Schedule (e.g., daily) so managers get regular alerts.
 *
 * @author Sam Lalonde — https://www.linkedin.com/in/samlalonde/ — sam@samlalonde.com
 *
 * @license
 * MIT — Free to use, modify, and distribute. See https://opensource.org/licenses/MIT
 *
 * @version
 * 2.0
 *
 * @changelog
 * - v1.0
 *   - Initial release
 * - v2.0
 *   - Label → recipient routing with support for multiple labels/people.
 *   - Always sends an email, even when there are zero disapprovals (clear “NONE” summary).
 *   - Subject line summarizes counts per type for quick triage.
 ******************************************************************************************/

// ===============================
// CONFIG
// ===============================
var CONFIG = {
  DEFAULT_TO: 'reports@example.com',         // Fallback if a group has no `to`
  FROM_NAME: 'Disapproval Monitor',
  SUBJECT_PREFIX: '⚠ Disapprovals',
  LABEL_RECIPIENTS: [
    { label: 'Managed by Sam', to: 'sam@example.com', cc: '' },
    // { label: 'Managed by Sam', to: 'someone@example.com', cc: 'lead@example.com' },
    // you can add many lines to cover many labels and emails.
  ],
  MAX_ROWS_PER_SECTION: 5000,
  INCLUDE_ZERO_ROW_SECTIONS: true,
  LOG_SUMMARY: true
};

var PREVIEW = AdWordsApp.getExecutionInfo().isPreview();

// ENTRY
function main() {
  if (!CONFIG.LABEL_RECIPIENTS || !CONFIG.LABEL_RECIPIENTS.length) {
    throw new Error('CONFIG.LABEL_RECIPIENTS is empty — add at least one {label, to}.');
  }
  for (var i = 0; i < CONFIG.LABEL_RECIPIENTS.length; i++) {
    processGroup(CONFIG.LABEL_RECIPIENTS[i]);
  }
}

// GROUP PIPELINE
function processGroup(group) {
  var recipient = (group && group.to) ? String(group.to).trim() : (CONFIG.DEFAULT_TO || '');
  if (!recipient) {
    Logger.log('Skipping label "%s" because no recipient is configured.', group && group.label);
    return;
  }

  var label = group.label || '(Unnamed Label)';
  if (CONFIG.LOG_SUMMARY) {
    Logger.log('[%s] Executing scan for accounts labeled: %s', label, label);
  }

  var labelEscaped = label.replace(/'/g, "\\'");
  var acctSelector = MccApp
    .accounts()
    .withCondition("LabelNames CONTAINS_ANY ['" + labelEscaped + "']");

  // Pass context as a string—don’t rely on globals inside parallel runs.
  var ctx = JSON.stringify({
    label: label,
    to: recipient,
    cc: (group && group.cc) ? String(group.cc).trim() : ''
  });

  acctSelector.executeInParallel('getStats', 'generateOutput', ctx);
}

// PER-ACCOUNT WORKER
function getStats() {
  var out = {
    account: AdWordsApp.currentAccount().getName() + ' (' + AdWordsApp.currentAccount().getCustomerId() + ')',
    ads: [],
    keywords: [],
    assets: [],
    totals: { ads: 0, keywords: 0, assets: 0 }
  };

  // ADS
  // IMPORTANT: Do NOT filter by policy fields in the selector; filter in code.
  try {
    var adIter = AdsApp.ads()
      // Optional generic scoping (kept loose to avoid missing issues)
      // .withCondition("CampaignStatus IN [ENABLED, PAUSED]") // uncomment if you want
      .withLimit(CONFIG.MAX_ROWS_PER_SECTION)
      .get();

    while (adIter.hasNext()) {
      var ad = adIter.next();
      var polStatus = safeCall_(ad.getPolicyApprovalStatus, ad); // APPROVED, DISAPPROVED, etc.
      if (String(polStatus) === 'APPROVED') continue; // filter here

      var pol = extractPolicyInfo_(ad);
      out.ads.push({
        type: ad.getType && ad.getType(),
        campaign: ad.getCampaign() && ad.getCampaign().getName(),
        adGroup: ad.getAdGroup && ad.getAdGroup().getName ? ad.getAdGroup().getName() : null,
        status: polStatus,
        topics: pol.topics,
        reasons: pol.reasons
      });
    }
    out.totals.ads = out.ads.length;
  } catch (e1) {
    Logger.log('Ad scan error: %s', e1);
  }

  // KEYWORDS
  try {
    var kwIter = AdsApp.keywords()
      // Again, don’t filter on policy fields in the selector; get all and filter in code
      .withLimit(CONFIG.MAX_ROWS_PER_SECTION)
      .get();

    while (kwIter.hasNext()) {
      var kw = kwIter.next();
      var kwStatus = safeCall_(kw.getApprovalStatus, kw);
      if (String(kwStatus) === 'APPROVED') continue;

      var pol2 = extractPolicyInfo_(kw);
      out.keywords.push({
        text: kw.getText(),
        matchType: kw.getMatchType && kw.getMatchType(),
        campaign: kw.getCampaign() && kw.getCampaign().getName(),
        adGroup: kw.getAdGroup && kw.getAdGroup().getName ? kw.getAdGroup().getName() : null,
        status: kwStatus,
        topics: pol2.topics,
        reasons: pol2.reasons
      });
    }
    out.totals.keywords = out.keywords.length;
  } catch (e2) {
    Logger.log('Keyword scan error: %s', e2);
  }

  // ---- ASSETS (best-effort)
  try {
    var assetIterator = AdsApp.assets()
      .withLimit(CONFIG.MAX_ROWS_PER_SECTION)
      .get();

    while (assetIterator.hasNext()) {
      var asset = assetIterator.next();
      var aStatus = safeCall_(asset.getPolicyApprovalStatus, asset);
      if (!aStatus || String(aStatus) === 'APPROVED') continue;

      var pol3 = extractPolicyInfo_(asset);
      out.assets.push({
        assetType: safeCall_(asset.getType, asset),
        name: safeCall_(asset.getName, asset),
        status: aStatus,
        topics: pol3.topics,
        reasons: pol3.reasons
      });
    }
    out.totals.assets = out.assets.length;
  } catch (e3) {
    // Runtime may not expose asset policy; ignore silently.
  }

  return JSON.stringify(out);
}

// COMBINE + EMAIL
function generateOutput(results, contextStr) {
  var ctx = {};
  try { ctx = JSON.parse(contextStr || '{}'); } catch (e) {}

  var recipient = (ctx && ctx.to) ? String(ctx.to).trim() : (CONFIG.DEFAULT_TO || '');
  if (!recipient) {
    throw new Error('Failed to send email: no recipient');
  }

  var cc = (ctx && ctx.cc) ? String(ctx.cc).trim() : '';
  var labelName = (ctx && ctx.label) ? ctx.label : '(Unlabeled Group)';

  var merged = {
    label: labelName,
    rows: [],
    totals: { ads: 0, keywords: 0, assets: 0, accounts: 0 }
  };

  for (var i = 0; i < results.length; i++) {
    var res = results[i];
    if (!res.getReturnValue) continue;
    var payload = parseSafe_(res.getReturnValue());
    if (!payload) continue;

    merged.totals.accounts++;
    merged.totals.ads += (payload.totals && payload.totals.ads) || 0;
    merged.totals.keywords += (payload.totals && payload.totals.keywords) || 0;
    merged.totals.assets += (payload.totals && payload.totals.assets) || 0;

    merged.rows.push({
      account: payload.account,
      ads: payload.ads || [],
      keywords: payload.keywords || [],
      assets: payload.assets || []
    });
  }

  var totalIssues = merged.totals.ads + merged.totals.keywords + merged.totals.assets;

  var html = [];
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;">');
  html.push('<h2 style="margin:0 0 8px 0;">' + escHtml_(CONFIG.SUBJECT_PREFIX) + ' — ' + escHtml_(labelName) + '</h2>');
  html.push('<p style="margin:4px 0 12px 0;">' +
            'Accounts scanned: <b>' + merged.totals.accounts + '</b> | ' +
            'Ads: <b>' + merged.totals.ads + '</b> | ' +
            'Keywords: <b>' + merged.totals.keywords + '</b> | ' +
            'Assets: <b>' + merged.totals.assets + '</b>' +
            '</p>');

  if (merged.rows.length === 0) {
    html.push('<p>No accounts matched the label "<b>' + escHtml_(labelName) + '</b>".</p>');
  } else {
    for (var r = 0; r < merged.rows.length; r++) {
      var row = merged.rows[r];
      html.push('<h3 style="margin:16px 0 6px 0;">' + escHtml_(row.account) + '</h3>');

      // ADS
      if (row.ads.length || CONFIG.INCLUDE_ZERO_ROW_SECTIONS) {
        html.push(sectionHeader_('Ads', row.ads.length));
        if (row.ads.length) {
          html.push('<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;">');
          html.push('<thead><tr style="background:#f7f7f7"><th align="left">Type</th><th align="left">Campaign</th><th align="left">Ad group</th><th align="left">Status</th><th align="left">Policy topics</th><th align="left">Reasons</th></tr></thead>');
          html.push('<tbody>');
          for (var a = 0; a < row.ads.length; a++) {
            var ad = row.ads[a];
            html.push('<tr style="border-top:1px solid #eee;">' +
              td_(ad.type) + td_(ad.campaign) + td_(ad.adGroup) + td_(ad.status) +
              td_(ad.topics && ad.topics.join(', ')) + td_(ad.reasons && ad.reasons.join('; ')) +
              '</tr>');
          }
          html.push('</tbody></table>');
        } else {
          html.push(emptyNote_());
        }
      }

      // KEYWORDS
      if (row.keywords.length || CONFIG.INCLUDE_ZERO_ROW_SECTIONS) {
        html.push(sectionHeader_('Keywords', row.keywords.length));
        if (row.keywords.length) {
          html.push('<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;">');
          html.push('<thead><tr style="background:#f7f7f7"><th align="left">Text</th><th align="left">Match</th><th align="left">Campaign</th><th align="left">Ad group</th><th align="left">Status</th><th align="left">Policy topics</th><th align="left">Reasons</th></tr></thead>');
          html.push('<tbody>');
          for (var k = 0; k < row.keywords.length; k++) {
            var kw = row.keywords[k];
            html.push('<tr style="border-top:1px solid #eee;">' +
              td_(kw.text) + td_(kw.matchType) + td_(kw.campaign) + td_(kw.adGroup) + td_(kw.status) +
              td_(kw.topics && kw.topics.join(', ')) + td_(kw.reasons && kw.reasons.join('; ')) +
              '</tr>');
          }
          html.push('</tbody></table>');
        } else {
          html.push(emptyNote_());
        }
      }

      // ASSETS (best-effort)
      if (row.assets.length || CONFIG.INCLUDE_ZERO_ROW_SECTIONS) {
        html.push(sectionHeader_('Assets / Extensions (best-effort)', row.assets.length));
        if (row.assets.length) {
          html.push('<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;">');
          html.push('<thead><tr style="background:#f7f7f7"><th align="left">Type</th><th align="left">Name</th><th align="left">Status</th><th align="left">Policy topics</th><th align="left">Reasons</th></tr></thead>');
          html.push('<tbody>');
          for (var s = 0; s < row.assets.length; s++) {
            var as = row.assets[s];
            html.push('<tr style="border-top:1px solid #eee;">' +
              td_(as.assetType) + td_(as.name) + td_(as.status) +
              td_(as.topics && as.topics.join(', ')) + td_(as.reasons && as.reasons.join('; ')) +
              '</tr>');
          }
          html.push('</tbody></table>');
        } else {
          html.push(emptyNote_());
        }
      }
    }
  }

  html.push('<p style="margin-top:18px;color:#666;font-size:12px;">Sent ' +
            new Date().toLocaleString() +
            (PREVIEW ? ' (PREVIEW MODE – no changes applied)' : '') +
            '</p>');
  html.push('</div>');

  var subject = buildSubject_(labelName, totalIssues, merged.totals);
  var mailOptions = { name: CONFIG.FROM_NAME || undefined, htmlBody: html.join('') };
  if (cc) mailOptions.cc = cc;

  if (CONFIG.LOG_SUMMARY) {
    Logger.log('[%s] Emailing "%s" to: %s%s',
      labelName, subject, recipient, (cc ? (' (cc ' + cc + ')') : ''));
  }

  if (!PREVIEW) {
    MailApp.sendEmail(recipient, subject, stripHtml_(html.join('')), mailOptions);
  } else {
    Logger.log('[PREVIEW] Skipped sending email.');
  }
}

// HELPERS
function buildSubject_(labelName, total, totals) {
  var statusFlag = total > 0 ? 'FOUND' : 'NONE';
  return (CONFIG.SUBJECT_PREFIX || 'Disapprovals') + ' — ' +
         labelName + ' — ' + statusFlag +
         ' (Ads:' + totals.ads + ', KW:' + totals.keywords + ', Assets:' + totals.assets + ')';
}
function sectionHeader_(title, count) {
  return '<h4 style="margin:12px 0 6px 0;">' + escHtml_(title) +
         ' <span style="font-weight:normal;color:#555">(' + count + ')</span></h4>';
}
function emptyNote_() {
  return '<div style="padding:8px 10px;border:1px dashed #ddd;background:#fafafa;color:#777;">None</div>';
}
function td_(v) {
  return '<td style="vertical-align:top;border-top:1px solid #eee;">' + escHtml_(v) + '</td>';
}
function escHtml_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function stripHtml_(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseSafe_(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function extractPolicyInfo_(entity) {
  var topicsOut = [], reasonsOut = [];
  try {
    if (typeof entity.getPolicyTopics === 'function') {
      var topics = entity.getPolicyTopics() || [];
      for (var i = 0; i < topics.length; i++) {
        var t = topics[i], name = null;
        try { if (t.getTopic) name = t.getTopic(); } catch (e1) {}
        if (!name) { try { if (t.getId) name = t.getId(); } catch (e2) {} }
        if (!name && typeof t.topic !== 'undefined') name = t.topic;
        if (!name && typeof t.id !== 'undefined') name = t.id;
        topicsOut.push(name || 'Unspecified Policy Topic');

        try {
          var evidences = (t.getEvidences && t.getEvidences()) || t.evidences || [];
          for (var j = 0; j < evidences.length; j++) {
            var ev = evidences[j];
            if (ev && ev.text) reasonsOut.push(ev.text);
            else if (ev && ev.getText) { try { reasonsOut.push(ev.getText()); } catch (e3) {} }
          }
        } catch (e4) {}
      }
    }
  } catch (e) {}
  return { topics: normalizeReasons_(topicsOut), reasons: normalizeReasons_(reasonsOut) };
}
function normalizeReasons_(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = String(arr[i] || '').trim();
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  }
  return out;
}
function safeCall_(fn, ctx) { try { if (typeof fn === 'function') return fn.call(ctx); } catch (e) {} return null; }
