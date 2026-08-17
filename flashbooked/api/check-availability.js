// POST /api/check-availability  {}
//   — called by Aoife's check_availability Retell tool. Returns real open slots on the same
//     GHL calendar the /book page uses (hgIjFYqlXqgWBunrrOaO), so she can offer a caller who
//     wants to talk to the FlashBooked team a genuine discovery-call time instead of an
//     invented one.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (shared with lead.js /
// book-discovery-call.js — all three are Aoife-triggered, same trust boundary).

const GHL_API = 'https://services.leadconnectorhq.com';
const CALENDAR_ID = 'hgIjFYqlXqgWBunrrOaO';
const TIMEZONE = 'Europe/Dublin';
const MAX_SLOTS_RETURNED = 6;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) return res.status(500).json({ error: 'GHL_PIT_FLASHBOOKED not configured' });

  const startDate = Date.now();
  const endDate = startDate + 7 * 24 * 60 * 60 * 1000;

  try {
    const url = `${GHL_API}/calendars/${CALENDAR_ID}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(TIMEZONE)}`;
    const ghlRes = await fetch(url, {
      headers: { Authorization: `Bearer ${pit}`, Version: '2021-04-15' },
    });
    const data = await ghlRes.json();
    if (!ghlRes.ok) return res.status(502).json({ error: 'GHL free-slots error', detail: data });

    const slots = [];
    for (const day of Object.values(data)) {
      if (!day?.slots) continue;
      for (const iso of day.slots) {
        slots.push(iso);
        if (slots.length >= MAX_SLOTS_RETURNED * 4) break; // grab plenty before spacing out below
      }
    }

    // Spread picks across different days/times rather than dumping the first N (which would
    // all be the same morning) — take roughly every Nth slot up to MAX_SLOTS_RETURNED.
    const step = Math.max(1, Math.floor(slots.length / MAX_SLOTS_RETURNED));
    const picked = slots.filter((_, i) => i % step === 0).slice(0, MAX_SLOTS_RETURNED);

    const options = picked.map(iso => {
      const d = new Date(iso);
      const label = d.toLocaleString('en-IE', {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE,
      });
      return { start_time: iso, label: `${label} (Dublin time)` };
    });

    if (!options.length) {
      return res.status(200).json({ ok: true, options: [], message: 'No open slots found in the next 7 days.' });
    }
    return res.status(200).json({ ok: true, options });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
