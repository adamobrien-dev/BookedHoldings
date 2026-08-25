// POST /api/book-discovery-call  { name, phone, start_time }
//   — called by Aoife's book_discovery_call Retell tool, after check_availability has offered
//     real slots and the caller picked one. Upserts the caller as a GHL contact and books a
//     15-minute discovery call on the same calendar the /book page uses.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (shared with lead.js /
// check-availability.js).
//
// Always responds 200 with a `message` field on failure — handed straight to the LLM mid-call.

const GHL_API = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const CALENDAR_ID = 'hgIjFYqlXqgWBunrrOaO';
const CALL_MINUTES = 15;
const FALLBACK_MESSAGE = "I'm having trouble locking that time in right now — take the caller's name, number, and the time they wanted, and let them know the team will confirm it shortly.";

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
    console.error('book-discovery-call: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) {
    console.error('book-discovery-call: GHL_PIT_FLASHBOOKED not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  // Retell wraps function args as { name, call, args } by default — unwrap either shape.
  const params = req.body?.args || req.body || {};
  const { name, phone, start_time } = params;
  // A truthy check alone lets an obviously-incomplete number through (e.g. a caller cut off
  // mid-number). Require enough digits to plausibly be a real number.
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 7 || !start_time) {
    return res.status(200).json({ ok: false, message: 'Need the caller\'s full phone number and the exact time they picked before booking — ask again if either is missing or sounded incomplete.' });
  }

  const startDate = new Date(start_time);
  if (isNaN(startDate.getTime())) {
    return res.status(200).json({ ok: false, message: 'That time didn\'t match one of the available options — offer the caller the list again.' });
  }
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

    if (!upsert.ok) {
      console.error('book-discovery-call: GHL upsert failed', JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }
    const contactId = upsert.data?.contact?.id;
    if (!contactId) {
      console.error('book-discovery-call: GHL upsert returned no contact id', JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }

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

    if (!booking.ok) {
      console.error('book-discovery-call: GHL appointment creation failed', JSON.stringify(booking.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }

    return res.status(200).json({ ok: true, contactId, appointmentId: booking.data?.id, message: 'Discovery call booked.' });
  } catch (err) {
    console.error('book-discovery-call error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }
};
