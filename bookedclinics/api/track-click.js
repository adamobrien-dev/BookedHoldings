// GET /api/track-click?c=<ghlContactId>                              — tags + logs the click, redirects to /testimonials/ (agency/Ziani)
// GET /api/track-click?c=<ghlContactId>&to=/path                     — redirect to a different path instead
// GET /api/track-click?report=true                                   — list agency contacts who have clicked (JSON)
//
// GET /api/track-click?client=carlos&c=<id>&campaign=<name>          — Escape Zero campaign: tags + logs click, redirects to Carlos's site
// GET /api/track-click?client=carlos&c=<id>&campaign=<name>&to=<url> — redirect to an allowlisted Escape domain instead
// GET /api/track-click?client=carlos&report=true[&campaign=<name>]   — list Carlos contacts who have clicked (JSON)
// GET /api/track-click?client=carlos&report=purchases                — list Carlos contacts tagged as purchased (server-verified, JSON)
// GET /api/track-click?client=carlos&report=purchases-unverified      — list contacts tagged from the client-side page ping (JSON)
//
// GET /api/track-click?client=carlos&event=purchase&c=<id>&campaign=<name>&amount=<n>&product=<name>
//   — no-secret purchase ping for plain (non-Velo) Wix sites where a shared secret can't be kept
//     out of browser-visible page code. Tags the contact `purchased - escape (self-reported)` —
//     deliberately a different tag from the POST webhook's `purchased - escape`, since this one
//     is trivially spoofable (anyone can load the thank-you URL without paying). Treat it as a
//     signal to reconcile against Wix's own orders before invoicing, not proof of payment.
//
// POST /api/track-click  { client: 'carlos', contactId?, email?, phone?, campaign?, amount?, product? }
//   — server-side purchase webhook (Wix Automations, or a Velo backend function). Auth: header
//     x-webhook-secret must match the client's webhook secret env var (CARLOS_WEBHOOK_SECRET).
//     Only use this from somewhere the secret stays server-side — never from a page <script>.
//
// Kept as one file (not split per client) to stay under Vercel Hobby's 12-serverless-function
// cap per deployment — api/ was already sitting at the limit before this campaign was added.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const SITE = 'https://www.bookedclinics.ca';
const DEFAULT_DEST = '/testimonials/';
const CLICK_TAG = 'clicked testimonial sms';

const CLIENTS = {
  carlos: {
    locationId: '927ajLYOikYcZ1uyhbTq',
    pitEnv: 'GHL_PIT_CARLOS',
    webhookSecretEnv: 'CARLOS_WEBHOOK_SECRET',
    defaultDest: 'https://escapezerogravitymassage.com/',
    defaultCampaign: 'escape-zero',
    // Only ever redirect to Carlos's own domains — never trust an arbitrary `to` param (open-redirect risk).
    allowedHosts: new Set(['escapezerogravitymassage.com', 'www.escapezerogravitymassage.com']),
    purchaseTag: 'purchased - escape',
    selfReportedPurchaseTag: 'purchased - escape (self-reported)',
  },
};

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

function listByTag(data) {
  return (data?.contacts || [])
    .map(c => ({
      name: c.contactName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      phone: c.phone,
      dateUpdated: c.dateUpdated,
    }))
    .sort((a, b) => new Date(b.dateUpdated) - new Date(a.dateUpdated));
}

// ---- Agency (default) click tracking — unchanged behavior ----

async function recordAgencyClick(contactId, dest, pit) {
  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [CLICK_TAG] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Clicked testimonial SMS link → ${dest} (${new Date().toISOString()})`,
    }, pit),
  ]);
}

async function agencyReport(pit, res) {
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: AGENCY_LOC,
    filters: [{ field: 'tags', operator: 'contains', value: CLICK_TAG }],
    pageLimit: 100,
  }, pit);
  if (!ok) return res.status(502).json({ error: 'GHL search error', status });
  const contacts = listByTag(data);
  res.status(200).json({ tag: CLICK_TAG, total: contacts.length, contacts });
}

// ---- Per-client click tracking (e.g. Carlos / Escape Zero) ----

function clickTag(campaign) {
  return `clicked sms: ${campaign}`;
}

function resolveClientDest(client, rawTo, campaign) {
  let url;
  try {
    url = new URL(rawTo || client.defaultDest);
  } catch {
    url = new URL(client.defaultDest);
  }
  if (!client.allowedHosts.has(url.hostname)) url = new URL(client.defaultDest);
  url.searchParams.set('utm_source', 'sms');
  url.searchParams.set('utm_medium', 'sms');
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}

async function recordClientClick(contactId, campaign, dest, pit) {
  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [clickTag(campaign)] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Clicked "${campaign}" SMS link → ${dest} (${new Date().toISOString()})`,
    }, pit),
  ]);
}

async function clientClickReport(client, pit, campaign, res) {
  const tag = clickTag(campaign);
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: client.locationId,
    filters: [{ field: 'tags', operator: 'contains', value: tag }],
    pageLimit: 100,
  }, pit);
  if (!ok) return res.status(502).json({ error: 'GHL search error', status });
  const contacts = listByTag(data);
  res.status(200).json({ tag, total: contacts.length, contacts });
}

// ---- Per-client purchase webhook ----

async function findClientContact(client, email, phone, pit) {
  const filters = [];
  if (email) filters.push({ field: 'email', operator: 'eq', value: email });
  if (phone) filters.push({ field: 'phone', operator: 'eq', value: phone });
  if (!filters.length) return null;
  const { ok, data } = await ghl('POST', '/contacts/search', { locationId: client.locationId, filters, pageLimit: 1 }, pit);
  if (!ok) return null;
  return data?.contacts?.[0]?.id || null;
}

async function recordClientPurchase(client, contactId, { campaign, amount, product }, pit) {
  const details = [
    product ? `Product: ${product}` : null,
    amount != null ? `Amount: $${amount}` : null,
    `Campaign: ${campaign}`,
    new Date().toISOString(),
  ].filter(Boolean).join(' · ');
  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [client.purchaseTag] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, { body: `Purchased (webhook) → ${details}` }, pit),
  ]);
}

async function clientPurchaseReport(client, pit, res) {
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: client.locationId,
    filters: [{ field: 'tags', operator: 'contains', value: client.purchaseTag }],
    pageLimit: 100,
  }, pit);
  if (!ok) return res.status(502).json({ error: 'GHL search error', status });
  const contacts = listByTag(data);
  res.status(200).json({ tag: client.purchaseTag, total: contacts.length, contacts });
}

// ---- Per-client self-reported purchase ping (no-secret, for plain Wix page code) ----

async function recordClientSelfReportedPurchase(client, contactId, { campaign, amount, product }, pit) {
  const details = [
    product ? `Product: ${product}` : null,
    amount != null ? `Amount: $${amount}` : null,
    `Campaign: ${campaign}`,
    new Date().toISOString(),
  ].filter(Boolean).join(' · ');
  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [client.selfReportedPurchaseTag] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Reported purchase (client-side page ping, unverified) → ${details}`,
    }, pit),
  ]);
}

async function clientSelfReportedPurchaseReport(client, pit, res) {
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: client.locationId,
    filters: [{ field: 'tags', operator: 'contains', value: client.selfReportedPurchaseTag }],
    pageLimit: 100,
  }, pit);
  if (!ok) return res.status(502).json({ error: 'GHL search error', status });
  const contacts = listByTag(data);
  res.status(200).json({ tag: client.selfReportedPurchaseTag, total: contacts.length, contacts });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const clientKey = typeof req.query.client === 'string' ? req.query.client : null;
  if (clientKey && !CLIENTS[clientKey]) {
    return res.status(400).json({ error: `unknown client "${clientKey}"` });
  }
  const client = clientKey ? CLIENTS[clientKey] : null;

  // ---- POST: purchase webhook (client-scoped only) ----
  if (req.method === 'POST') {
    const body = req.body || {};
    const targetKey = clientKey || body.client;
    const target = targetKey ? CLIENTS[targetKey] : null;
    if (!target) return res.status(400).json({ error: 'client required for purchase webhook' });

    const secret = req.headers['x-webhook-secret'];
    if (!process.env[target.webhookSecretEnv] || secret !== process.env[target.webhookSecretEnv]) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const pit = process.env[target.pitEnv];
    const { contactId, email, phone, campaign, amount, product } = body;
    try {
      const resolvedId = contactId || await findClientContact(target, email, phone, pit);
      if (!resolvedId) return res.status(404).json({ error: 'contact not found', email, phone });
      await recordClientPurchase(target, resolvedId, { campaign: campaign || 'unknown', amount, product }, pit);
      return res.status(200).json({ ok: true, contactId: resolvedId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  const contactId = typeof req.query.c === 'string' ? req.query.c : null;

  // ---- GET: reports ----
  if (req.query.report === 'true') {
    if (client) {
      const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : client.defaultCampaign;
      try { return await clientClickReport(client, process.env[client.pitEnv], campaign, res); }
      catch (err) { return res.status(500).json({ error: err.message }); }
    }
    try { return await agencyReport(process.env.GHL_PIT_AGENCY, res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }
  if (req.query.report === 'purchases') {
    if (!client) return res.status(400).json({ error: 'client required for purchases report' });
    try { return await clientPurchaseReport(client, process.env[client.pitEnv], res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }
  if (req.query.report === 'purchases-unverified') {
    if (!client) return res.status(400).json({ error: 'client required for purchases report' });
    try { return await clientSelfReportedPurchaseReport(client, process.env[client.pitEnv], res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ---- GET: no-secret self-reported purchase ping (plain Wix thank-you-page code) ----
  if (client && req.query.event === 'purchase') {
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : client.defaultCampaign;
    const amount = typeof req.query.amount === 'string' ? req.query.amount : null;
    const product = typeof req.query.product === 'string' ? req.query.product : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    const phone = typeof req.query.phone === 'string' ? req.query.phone : null;
    const pit = process.env[client.pitEnv];
    try {
      const resolvedId = contactId || await findClientContact(client, email, phone, pit);
      if (!resolvedId) return res.status(200).json({ ok: false, reason: 'contact not found' });
      await recordClientSelfReportedPurchase(client, resolvedId, { campaign, amount, product }, pit);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // ---- GET: click tracking + redirect ----
  if (client) {
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : client.defaultCampaign;
    const dest = resolveClientDest(client, typeof req.query.to === 'string' ? req.query.to : null, campaign);
    const pit = process.env[client.pitEnv];
    if (contactId && pit) {
      try { await recordClientClick(contactId, campaign, dest, pit); }
      catch (err) { console.error('track-click: failed to record client click', err.message); }
    }
    res.writeHead(302, { Location: dest });
    return res.end();
  }

  const pit = process.env.GHL_PIT_AGENCY;
  const rawDest = typeof req.query.to === 'string' ? req.query.to : DEFAULT_DEST;
  const dest = rawDest.startsWith('/') ? rawDest : DEFAULT_DEST;
  if (contactId && pit) {
    try { await recordAgencyClick(contactId, `${SITE}${dest}`, pit); }
    catch (err) { console.error('track-click: failed to record click', err.message); }
  }
  res.writeHead(302, { Location: `${SITE}${dest}` });
  res.end();
};
