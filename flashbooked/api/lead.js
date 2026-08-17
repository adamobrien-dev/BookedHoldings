// POST /api/lead  { name?, phone?, address?, issue?, urgency?, notes? }
//   — called by the Aoife Retell agent (demo line, +353 1 964 0379) mid-call via a custom
//     function tool. Since there's no real business or calendar behind the demo, "booking"
//     just means: upsert the caller as a GHL contact in the FlashBooked location, tag them,
//     and log what Aoife heard as a note — so a serious demo caller becomes a real lead Adam
//     can follow up with, rather than the call just... ending.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (Retell sends this as a
// custom header configured on the tool).
//
// Always responds 200 with a `message` field, even on failure — this response is handed
// straight to the LLM mid-call, so a raw error status/JSON would surface as confusing text
// to a live caller. Real failures are logged server-side for debugging instead.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const LEAD_TAG = 'aoife demo call';
const FALLBACK_MESSAGE = "I'm having a bit of trouble saving that on my end — let the caller know you'll take their number and have the team call them back.";

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
    console.error('lead: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) {
    console.error('lead: GHL_PIT_FLASHBOOKED not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const { name, phone, address, issue, urgency, notes } = req.body || {};
  if (!phone) return res.status(200).json({ ok: false, message: 'Ask the caller for a callback phone number before saving their details.' });

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

    if (!ok) {
      console.error('lead: GHL upsert failed', status, JSON.stringify(data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }
    const contactId = data?.contact?.id;
    if (!contactId) {
      console.error('lead: GHL upsert returned no contact id', JSON.stringify(data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }

    await ghl('POST', `/contacts/${contactId}/tags`, { tags: [LEAD_TAG] }, pit);

    const noteLines = [
      address ? `Address: ${address}` : null,
      issue ? `Issue: ${issue}` : null,
      urgency ? `Urgency: ${urgency}` : null,
      notes ? `Notes: ${notes}` : null,
      `Captured by Aoife (demo line) — ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');
    await ghl('POST', `/contacts/${contactId}/notes`, { body: noteLines }, pit);

    return res.status(200).json({ ok: true, message: 'Lead captured — the team will follow up shortly.' });
  } catch (err) {
    console.error('lead error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }
};
