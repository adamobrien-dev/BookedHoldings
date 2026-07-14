// GET /api/track-click-carlos?c=<ghlContactId>&campaign=<name>       — tags + logs the click, then redirects to the landing page
// GET /api/track-click-carlos?c=<ghlContactId>&campaign=<name>&to=<url> — redirect to an allowlisted destination instead
// GET /api/track-click-carlos?report=true[&campaign=<name>]           — list contacts who have clicked (JSON)
//
// Same pattern as track-click.js, scoped to Carlos Meneses' Escape Zero Gravity Massage
// sub-account so this campaign's click data stays separate from the agency's own tags.
// Independent of Wix/Carlos self-reporting — needed for the $50/sale billing arrangement.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const CARLOS_LOC = '927ajLYOikYcZ1uyhbTq';
const DEFAULT_DEST = 'https://escapezerogravitymassage.com/';
const DEFAULT_CAMPAIGN = 'escape-zero';

// Only ever redirect to Carlos's own domains — never trust an arbitrary `to` param (open-redirect risk).
// Add Escape Weight Loss / ThinnerWaist hostnames here once those campaigns start.
const ALLOWED_HOSTS = new Set([
  'escapezerogravitymassage.com',
  'www.escapezerogravitymassage.com',
]);

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

function clickTag(campaign) {
  return `clicked sms: ${campaign}`;
}

function resolveDest(rawTo, campaign) {
  let url;
  try {
    url = new URL(rawTo || DEFAULT_DEST);
  } catch {
    url = new URL(DEFAULT_DEST);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    url = new URL(DEFAULT_DEST);
  }
  url.searchParams.set('utm_source', 'sms');
  url.searchParams.set('utm_medium', 'sms');
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}

async function recordClick(contactId, campaign, dest, pit) {
  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [clickTag(campaign)] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Clicked "${campaign}" SMS link → ${dest} (${new Date().toISOString()})`,
    }, pit),
  ]);
}

async function report(pit, campaign, res) {
  const tag = clickTag(campaign);
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: CARLOS_LOC,
    filters: [{ field: 'tags', operator: 'contains', value: tag }],
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
  res.status(200).json({ tag, total: contacts.length, contacts });
}

module.exports = async function handler(req, res) {
  const pit = process.env.GHL_PIT_CARLOS;
  const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : DEFAULT_CAMPAIGN;

  if (req.query.report === 'true') {
    try {
      return await report(pit, campaign, res);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const contactId = typeof req.query.c === 'string' ? req.query.c : null;
  const dest = resolveDest(typeof req.query.to === 'string' ? req.query.to : null, campaign);

  if (contactId && pit) {
    try {
      await recordClick(contactId, campaign, dest, pit);
    } catch (err) {
      // Never block the redirect on a tagging failure — the click still needs to land.
      console.error('track-click-carlos: failed to record click', err.message);
    }
  }

  res.writeHead(302, { Location: dest });
  res.end();
};
