// POST /api/capi  { email?, phone?, eventName?, eventSourceUrl? }
//   — server-side Meta Conversions API relay. Called from a GHL "appointment booked" workflow
//     webhook so a Schedule event reaches Meta even if the visitor's browser blocked the Pixel.
//     Auth: header x-webhook-secret must match FLASHBOOKED_CAPI_SECRET.
//
// This does NOT replace the client-side Pixel Schedule event on book/index.html — both fire.
// There's no shared event_id between them yet, so Meta may see two Schedule events per real
// booking when the client pixel isn't blocked. Meta's user-data matching usually collapses
// these in reporting, but this isn't guaranteed dedup — worth revisiting if double-counting
// shows up in Ads Manager.

const crypto = require('crypto');

const PIXEL_ID = '1684133989338134';
const GRAPH_API = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email) {
  return sha256(email.trim().toLowerCase());
}

function normalizePhone(phone) {
  // Meta expects E.164 digits only (no +), hashed. Best-effort: strip everything but digits.
  const digits = phone.replace(/\D/g, '');
  return sha256(digits);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_CAPI_SECRET || secret !== process.env.FLASHBOOKED_CAPI_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) return res.status(500).json({ error: 'META_SYSTEM_TOKEN not configured' });

  const { email, phone, eventName, eventSourceUrl } = req.body || {};
  if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });

  const user_data = {};
  if (email) user_data.em = [normalizeEmail(email)];
  if (phone) user_data.ph = [normalizePhone(phone)];

  const payload = {
    data: [{
      event_name: eventName || 'Schedule',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'system_generated',
      event_source_url: eventSourceUrl || 'https://flashbooked.com/book/',
      user_data,
    }],
    access_token: token,
  };

  try {
    const metaRes = await fetch(GRAPH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await metaRes.json();
    if (!metaRes.ok) return res.status(502).json({ error: 'Meta CAPI error', detail: data });
    return res.status(200).json({ ok: true, metaResponse: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
