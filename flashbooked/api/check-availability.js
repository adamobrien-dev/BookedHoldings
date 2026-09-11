// POST /api/check-availability  {}                          — check_availability tool
// POST /api/check-availability  { name, phone, start_time }  — book_discovery_call tool
//   — both called by Aoife's Retell tools, folded into one file to stay under Vercel's
//     12-serverless-function cap (see numbers-dashboard.js, folded in the same way earlier).
//     Branches on whether `start_time` is present: absent → return open slots on the same GHL
//     calendar the /book page uses (hgIjFYqlXqgWBunrrOaO); present → book that slot. The
//     book_discovery_call Retell tool's webhook URL was repointed here from the old
//     /api/book-discovery-call (now removed) — same request/response contract, just merged
//     under this file so check_availability's own URL didn't need to change too.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (shared with lead.js — all
// Aoife-triggered tools use the same trust boundary).
//
// Always responds 200 with a `message` field on failure — handed straight to the LLM mid-call.

const GHL_API = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const CALENDAR_ID = 'hgIjFYqlXqgWBunrrOaO';
const TIMEZONE = 'Europe/Dublin';
const MAX_SLOTS_RETURNED = 6;
const CALL_MINUTES = 15;
const FALLBACK_MESSAGE_AVAILABILITY = "I'm having trouble pulling up the calendar right now — take the caller's name and number and let them know the team will follow up to find a time.";
const FALLBACK_MESSAGE_BOOKING = "I'm having trouble locking that time in right now — take the caller's name, number, and the time they wanted, and let them know the team will confirm it shortly.";

async function ghl(method, path, body, pit, version = '2021-07-28') {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: version, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function checkAvailability(req, res, pit) {
  const startDate = Date.now();
  const endDate = startDate + 7 * 24 * 60 * 60 * 1000;

  try {
    const url = `${GHL_API}/calendars/${CALENDAR_ID}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(TIMEZONE)}`;
    const ghlRes = await fetch(url, {
      headers: { Authorization: `Bearer ${pit}`, Version: '2021-04-15' },
    });
    const data = await ghlRes.json();
    if (!ghlRes.ok) {
      console.error('check-availability: GHL free-slots error', JSON.stringify(data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_AVAILABILITY });
    }

    // The calendar's raw free-slots span all hours (including the middle of the night in
    // Dublin, presumably for other timezones) — filter down to reasonable calling hours
    // before offering anything to a caller.
    const MIN_HOUR = 9;
    const MAX_HOUR = 23;
    const hourOf = iso => Number(new Date(iso).toLocaleString('en-IE', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));

    // Pick per-day, not from one pooled/truncated list — otherwise a busy first day can eat
    // the whole cap and later days barely show up. Take a small spread from each day (early,
    // mid, late in the eligible window) and walk forward through days until we have enough.
    const perDay = Object.entries(data)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, day]) => (day?.slots || []).filter(iso => {
        const h = hourOf(iso);
        return h >= MIN_HOUR && h < MAX_HOUR;
      }))
      .filter(daySlots => daySlots.length > 0);

    const picked = [];
    const perDayTake = 2;
    for (const daySlots of perDay) {
      if (picked.length >= MAX_SLOTS_RETURNED) break;
      const idxs = perDayTake === 1 ? [0] : [0, daySlots.length - 1];
      const chosen = [...new Set(idxs)].map(i => daySlots[i]);
      for (const iso of chosen) {
        if (picked.length >= MAX_SLOTS_RETURNED) break;
        picked.push(iso);
      }
    }

    const options = picked.map(iso => {
      const d = new Date(iso);
      const label = d.toLocaleString('en-IE', {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE,
      });
      return { start_time: iso, label: `${label} (Dublin time)` };
    });

    if (!options.length) {
      return res.status(200).json({ ok: true, options: [], message: 'No open slots in the next 7 days — take the caller\'s details and let them know the team will follow up to find a time.' });
    }
    return res.status(200).json({ ok: true, options });
  } catch (err) {
    console.error('check-availability error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_AVAILABILITY });
  }
}

async function bookDiscoveryCall(req, res, pit, params) {
  const { name, phone, start_time } = params;
  // A truthy check alone lets an obviously-incomplete number through (e.g. a caller cut off
  // mid-number). Require enough digits to plausibly be a real number.
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 7) {
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
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_BOOKING });
    }
    const contactId = upsert.data?.contact?.id;
    if (!contactId) {
      console.error('book-discovery-call: GHL upsert returned no contact id', JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_BOOKING });
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
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_BOOKING });
    }

    return res.status(200).json({ ok: true, contactId, appointmentId: booking.data?.id, message: 'Discovery call booked.' });
  } catch (err) {
    console.error('book-discovery-call error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_BOOKING });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    console.error('check-availability: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_AVAILABILITY });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) {
    console.error('check-availability: GHL_PIT_FLASHBOOKED not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE_AVAILABILITY });
  }

  // Retell wraps function args as { name, call, args } by default — unwrap either shape.
  const params = req.body?.args || req.body || {};
  if (params.start_time) return bookDiscoveryCall(req, res, pit, params);
  return checkAvailability(req, res, pit);
};
