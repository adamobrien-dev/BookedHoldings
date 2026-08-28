// POST /api/contact  { name, email?, phone?, message, company? (honeypot) }
//   — public website contact form (flashbooked.com homepage). Upserts the sender as a GHL
//     contact in the FlashBooked location, tags them, and logs their message as a note.
//
// `company` is a honeypot field, hidden from real visitors via CSS — any bot that fills it
// gets silently accepted (200) but never written to GHL, so it doesn't tip off the scraper.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const CONTACT_TAG = 'website contact form';

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
  res.setHeader('Access-Control-Allow-Origin', 'https://flashbooked.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { name, email, phone, message, company } = req.body || {};

  // Honeypot: a real visitor never sees or fills this field. Accept silently, write nothing.
  if (company) return res.status(200).json({ ok: true });

  if (!name || !message || (!email && !phone)) {
    return res.status(400).json({ ok: false, error: 'Name, message, and an email or phone number are required.' });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) {
    console.error('contact: GHL_PIT_FLASHBOOKED not configured');
    return res.status(500).json({ ok: false, error: 'Something went wrong on our end — please email adam@bookedjobs.ca directly.' });
  }

  try {
    const [firstName, ...rest] = String(name).trim().split(/\s+/).filter(Boolean);
    const upsert = await ghl('POST', '/contacts/upsert', {
      locationId: LOCATION_ID,
      ...(firstName ? { firstName } : {}),
      ...(rest.length ? { lastName: rest.join(' ') } : {}),
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      source: 'FlashBooked Website Contact Form',
    }, pit);

    if (!upsert.ok) {
      console.error('contact: GHL upsert failed', upsert.status, JSON.stringify(upsert.data));
      return res.status(500).json({ ok: false, error: 'Something went wrong on our end — please email adam@bookedjobs.ca directly.' });
    }
    const contactId = upsert.data?.contact?.id;
    if (!contactId) {
      console.error('contact: GHL upsert returned no contact id', JSON.stringify(upsert.data));
      return res.status(500).json({ ok: false, error: 'Something went wrong on our end — please email adam@bookedjobs.ca directly.' });
    }

    await ghl('POST', `/contacts/${contactId}/tags`, { tags: [CONTACT_TAG] }, pit);
    await ghl('POST', `/contacts/${contactId}/notes`, {
      body: `Website contact form message:\n${message}\n\nSubmitted ${new Date().toISOString()}`,
    }, pit);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact error', err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong on our end — please email adam@bookedjobs.ca directly.' });
  }
};
