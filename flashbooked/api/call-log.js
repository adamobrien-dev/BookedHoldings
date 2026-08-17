// POST /api/call-log?secret=...
//   — Retell's post-call webhook (call_analyzed event) for the Aoife agent. Logs every call —
//     summary, sentiment, outcome, transcript, recording link — as a note on a GHL contact
//     keyed by the caller's number, so reviewing calls is "open GHL" instead of digging
//     through Retell's dashboard. Matches the playbook's own Week 1 process: "listen to every
//     single call, iterate the prompt daily."
//
// Auth: ?secret= query param must match FLASHBOOKED_CALL_LOG_SECRET (Retell's webhook config
// doesn't support custom headers per-call the way our other tools do, so the secret lives in
// the configured webhook_url itself instead of a header).

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked (formerly Sandy / My Adult Primary Care)
const CALL_LOG_TAG = 'aoife call log';

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

  if (!process.env.FLASHBOOKED_CALL_LOG_SECRET || req.query.secret !== process.env.FLASHBOOKED_CALL_LOG_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};
  // Retell fires call_started / call_ended / call_analyzed at this same URL — only the last
  // one has call_analysis (summary/sentiment/outcome), so that's the one worth logging.
  if (body.event !== 'call_analyzed') return res.status(200).json({ ok: true, skipped: body.event });

  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) {
    console.error('call-log: GHL_PIT_FLASHBOOKED not configured');
    return res.status(200).json({ ok: false });
  }

  const call = body.call || {};
  const phone = call.from_number;
  if (!phone) return res.status(200).json({ ok: true, skipped: 'no from_number' });

  const analysis = call.call_analysis || {};
  const duration = call.start_timestamp && call.end_timestamp
    ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
    : null;

  try {
    const { ok, data } = await ghl('POST', '/contacts/upsert', {
      locationId: LOCATION_ID,
      phone,
      source: 'Aoife Call Log',
    }, pit);
    if (!ok) return res.status(200).json({ ok: false, detail: data });

    const contactId = data?.contact?.id;
    if (!contactId) return res.status(200).json({ ok: false, detail: data });

    await ghl('POST', `/contacts/${contactId}/tags`, { tags: [CALL_LOG_TAG] }, pit);

    const noteLines = [
      `Call summary: ${analysis.call_summary || 'n/a'}`,
      analysis.user_sentiment ? `Sentiment: ${analysis.user_sentiment}` : null,
      analysis.call_successful != null ? `Successful: ${analysis.call_successful}` : null,
      duration != null ? `Duration: ${duration}s` : null,
      call.disconnection_reason ? `Ended: ${call.disconnection_reason}` : null,
      call.recording_url ? `Recording: ${call.recording_url}` : null,
      `Call ID: ${call.call_id || 'n/a'} — ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');
    await ghl('POST', `/contacts/${contactId}/notes`, { body: noteLines }, pit);

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    console.error('call-log error', err.message);
    return res.status(200).json({ ok: false });
  }
};
