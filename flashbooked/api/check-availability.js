// POST /api/check-availability  {}
//   — called by Aoife's check_availability Retell tool. Returns real open slots on the same
//     GHL calendar the /book page uses (hgIjFYqlXqgWBunrrOaO), so she can offer a caller who
//     wants to talk to the FlashBooked team a genuine discovery-call time instead of an
//     invented one.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (shared with lead.js /
// book-discovery-call.js — all three are Aoife-triggered, same trust boundary).
//
// Always responds 200 with a `message` field on failure — handed straight to the LLM mid-call.

const GHL_API = 'https://services.leadconnectorhq.com';
const CALENDAR_ID = 'hgIjFYqlXqgWBunrrOaO';
const TIMEZONE = 'Europe/Dublin';
const MAX_SLOTS_RETURNED = 6;
const FALLBACK_MESSAGE = "I'm having trouble pulling up the calendar right now — take the caller's name and number and let them know the team will follow up to find a time.";

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    console.error('check-availability: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) {
    console.error('check-availability: GHL_PIT_FLASHBOOKED not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

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
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
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
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }
};
