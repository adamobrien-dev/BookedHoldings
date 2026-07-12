// GET /api/track-click?c=<ghlContactId>          — tags + logs the click, then redirects to /testimonials/
// GET /api/track-click?c=<ghlContactId>&to=/path  — redirect to a different path instead
// GET /api/track-click?report=true                — list contacts who have clicked (JSON)
//
// Used to see who actually opens a link sent via SMS/email campaigns (starting with the
// Ziani testimonial blast). Tags the GHL contact so it's filterable in the pipeline, and
// leaves a note with the timestamp + destination for an audit trail.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const SITE = 'https://www.bookedclinics.ca';
const DEFAULT_DEST = '/testimonials/';
const CLICK_TAG = 'clicked testimonial sms';

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function recordClick(contactId, dest, pit) {
  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [CLICK_TAG] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Clicked testimonial SMS link → ${dest} (${new Date().toISOString()})`,
    }, pit),
  ]);
}

async function report(pit, res) {
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: AGENCY_LOC,
    filters: [{ field: 'tags', operator: 'contains', value: CLICK_TAG }],
    pageLimit: 100,
  }, pit);
  if (!ok) return res.status(502).json({ error: 'GHL search error', status });

  const contacts = (data?.contacts || [])
    .map(c => ({
      name: c.contactName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      phone: c.phone,
      dateUpdated: c.dateUpdated,
    }))
    .sort((a, b) => new Date(b.dateUpdated) - new Date(a.dateUpdated));
  res.status(200).json({ tag: CLICK_TAG, total: contacts.length, contacts });
}

module.exports = async function handler(req, res) {
  const pit = process.env.GHL_PIT_AGENCY;

  if (req.query.report === 'true') {
    try {
      return await report(pit, res);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const contactId = typeof req.query.c === 'string' ? req.query.c : null;
  const rawDest = typeof req.query.to === 'string' ? req.query.to : DEFAULT_DEST;
  const dest = rawDest.startsWith('/') ? rawDest : DEFAULT_DEST;

  if (contactId && pit) {
    try {
      await recordClick(contactId, dest, pit);
    } catch (err) {
      // Never block the redirect on a tagging failure — the click still needs to land.
      console.error('track-click: failed to record click', err.message);
    }
  }

  res.writeHead(302, { Location: `${SITE}${dest}` });
  res.end();
};
