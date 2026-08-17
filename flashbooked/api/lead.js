// POST /api/lead  { name?, phone?, address?, issue?, urgency?, notes? }
//   — called by the Aoife Retell agent (demo line, +353 1 964 0379) mid-call via a custom
//     function tool. Since there's no real business or calendar behind the demo, "booking"
//     just means: upsert the caller as a GHL contact in the FlashBooked location, tag them,
//     and log what Aoife heard as a note — so a serious demo caller becomes a real lead Adam
//     can follow up with, rather than the call just... ending.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (Retell sends this as a
// custom header configured on the tool).

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const LEAD_TAG = 'aoife demo call';

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) return res.status(500).json({ error: 'GHL_PIT_FLASHBOOKED not configured' });

  const { name, phone, address, issue, urgency, notes } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const [firstName, ...rest] = (name || '').trim().split(/\s+/).filter(Boolean);
    const { ok, status, data } = await ghl('POST', '/contacts/upsert', {
      locationId: LOCATION_ID,
      ...(firstName ? { firstName } : {}),
      ...(rest.length ? { lastName: rest.join(' ') } : {}),
      ...(name ? { name } : {}),
      phone,
      source: 'Aoife Demo Call',
    }, pit);

    if (!ok) return res.status(502).json({ error: 'GHL upsert failed', status, detail: data });
    const contactId = data?.contact?.id;
    if (!contactId) return res.status(502).json({ error: 'GHL upsert returned no contact id', detail: data });

    await ghl('POST', `/contacts/${contactId}/tags`, { tags: [LEAD_TAG] }, pit);

    const noteLines = [
      address ? `Address: ${address}` : null,
      issue ? `Issue: ${issue}` : null,
      urgency ? `Urgency: ${urgency}` : null,
      notes ? `Notes: ${notes}` : null,
      `Captured by Aoife (demo line) — ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');
    await ghl('POST', `/contacts/${contactId}/notes`, { body: noteLines }, pit);

    return res.status(200).json({ ok: true, contactId, message: 'Lead captured — the team will follow up shortly.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
