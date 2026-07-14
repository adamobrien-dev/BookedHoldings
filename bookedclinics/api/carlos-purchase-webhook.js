// POST /api/carlos-purchase-webhook
// Wix (via Automations "Send an HTTP request") calls this when a purchase/booking completes
// on Carlos Meneses' Escape Zero Gravity Massage site, so the sale gets attributed back to a
// specific SMS/email campaign — independent of Wix/Carlos self-reporting. This is the source
// of truth for the $50/sale billing arrangement.
//
// Auth: header `x-webhook-secret` must match CARLOS_WEBHOOK_SECRET (set in Vercel env).
//
// Body (JSON):
//   contactId  string? — GHL contact ID, if it was carried through the funnel as a URL param (?c=)
//   email      string? — fallback lookup if contactId is missing
//   phone      string? — fallback lookup if contactId is missing
//   campaign   string? — e.g. "escape-zero", defaults to "unknown"
//   amount     number? — sale amount in dollars
//   product    string? — e.g. "Couples Massage Membership"
//
// GET /api/carlos-purchase-webhook?report=true — list contacts tagged as purchased (JSON)

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const CARLOS_LOC = '927ajLYOikYcZ1uyhbTq';
const PURCHASE_TAG = 'purchased - escape';

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function findContact(email, phone, pit) {
  const filters = [];
  if (email) filters.push({ field: 'email', operator: 'eq', value: email });
  if (phone) filters.push({ field: 'phone', operator: 'eq', value: phone });
  if (!filters.length) return null;

  const { ok, data } = await ghl('POST', '/contacts/search', {
    locationId: CARLOS_LOC,
    filters,
    pageLimit: 1,
  }, pit);
  if (!ok) return null;
  return data?.contacts?.[0]?.id || null;
}

async function recordPurchase(contactId, { campaign, amount, product }, pit) {
  const details = [
    product ? `Product: ${product}` : null,
    amount != null ? `Amount: $${amount}` : null,
    `Campaign: ${campaign}`,
    new Date().toISOString(),
  ].filter(Boolean).join(' · ');

  await Promise.all([
    ghl('POST', `/contacts/${contactId}/tags`, { tags: [PURCHASE_TAG] }, pit),
    ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Purchased (Escape Zero webhook) → ${details}`,
    }, pit),
  ]);
}

async function report(pit, res) {
  const { ok, status, data } = await ghl('POST', '/contacts/search', {
    locationId: CARLOS_LOC,
    filters: [{ field: 'tags', operator: 'contains', value: PURCHASE_TAG }],
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
  res.status(200).json({ tag: PURCHASE_TAG, total: contacts.length, contacts });
}

module.exports = async function handler(req, res) {
  const pit = process.env.GHL_PIT_CARLOS;

  if (req.method === 'GET' && req.query.report === 'true') {
    try {
      return await report(pit, res);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.CARLOS_WEBHOOK_SECRET || secret !== process.env.CARLOS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { contactId, email, phone, campaign, amount, product } = req.body || {};

  try {
    const resolvedId = contactId || await findContact(email, phone, pit);
    if (!resolvedId) {
      return res.status(404).json({ error: 'contact not found', email, phone });
    }
    await recordPurchase(resolvedId, { campaign: campaign || 'unknown', amount, product }, pit);
    return res.status(200).json({ ok: true, contactId: resolvedId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
