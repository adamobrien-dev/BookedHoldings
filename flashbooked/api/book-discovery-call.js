// POST /api/book-discovery-call  { name, phone, start_time }
//   — called by Aoife's book_discovery_call Retell tool, after check_availability has offered
//     real slots and the caller picked one. Upserts the caller as a GHL contact and books a
//     15-minute discovery call on the same calendar the /book page uses.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (shared with lead.js /
// check-availability.js).

const GHL_API = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const CALENDAR_ID = 'hgIjFYqlXqgWBunrrOaO';
const CALL_MINUTES = 15;

async function ghl(method, path, body, pit, version = '2021-07-28') {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: version, 'Content-Type': 'application/json' },
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

  const { name, phone, start_time } = req.body || {};
  if (!phone || !start_time) return res.status(400).json({ error: 'phone and start_time required' });

  const startDate = new Date(start_time);
  if (isNaN(startDate.getTime())) return res.status(400).json({ error: 'invalid start_time' });
  const endTime = new Date(startDate.getTime() + CALL_MINUTES * 60 * 1000).toISOString();

  try {
    const [firstName, ...rest] = (name || '').trim().split(/\s+/).filter(Boolean);
    const upsert = await ghl('POST', '/contacts/upsert', {
      locationId: LOCATION_ID,
      ...(firstName ? { firstName } : {}),
      ...(rest.length ? { lastName: rest.join(' ') } : {}),
      ...(name ? { name } : {}),
      phone,
      source: 'Aoife Demo Call - Discovery Booking',
    }, pit);

    if (!upsert.ok) return res.status(502).json({ error: 'GHL upsert failed', detail: upsert.data });
    const contactId = upsert.data?.contact?.id;
    if (!contactId) return res.status(502).json({ error: 'GHL upsert returned no contact id', detail: upsert.data });

    await ghl('POST', `/contacts/${contactId}/tags`, { tags: ['booked via aoife demo'] }, pit);

    const booking = await ghl('POST', '/calendars/events/appointments', {
      calendarId: CALENDAR_ID,
      locationId: LOCATION_ID,
      contactId,
      startTime: startDate.toISOString(),
      endTime,
      title: `Discovery Call — ${name || 'FlashBooked prospect'} (booked via Aoife)`,
      appointmentStatus: 'confirmed',
    }, pit, 'v3');

    if (!booking.ok) return res.status(502).json({ error: 'GHL appointment creation failed', detail: booking.data });

    return res.status(200).json({ ok: true, contactId, appointmentId: booking.data?.id, message: 'Discovery call booked.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
