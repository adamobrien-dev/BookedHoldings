// Bland.ai calls this endpoint after every call completes.
// Logs the outcome back to GHL: tags the contact and adds a call summary note.
//
// Required env vars:
//   RTB_PIT — GHL private integration token for RTB sub-account

const GHL_API     = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const RTB_PIT = process.env.RTB_PIT || 'FILL_IN_RTB_PIT';

async function ghlPost(path, body) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RTB_PIT}`,
        Version: GHL_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

function outcomeTag(status, transcript = '') {
  const t = (transcript || '').toLowerCase();
  if (status === 'no-answer' || status === 'voicemail')    return 'ai-call-no-answer';
  if (t.includes('booked') || t.includes('you are all set')) return 'ai-call-booked';
  if (t.includes('think about it') || t.includes('not interested')) return 'ai-call-not-interested';
  return 'ai-call-completed';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const data = req.body || {};

  const contactId  = data.metadata?.contact_id;
  const callId     = data.call_id;
  const status     = data.status || 'unknown';
  const duration   = data.call_length ? `${Math.round(data.call_length)}s` : 'unknown';
  const transcript = data.concatenated_transcript || data.transcript || '';
  const summary    = data.summary || '';
  const recording  = data.recording_url || null;

  if (!contactId) {
    // No contact to update — still return 200 so Bland.ai doesn't retry
    return res.status(200).json({ ok: true, skipped: 'no contact_id in metadata' });
  }

  const tag  = outcomeTag(status, transcript + ' ' + summary);
  const note = [
    `AI Call (Bland.ai) — ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`,
    `Status: ${status} | Duration: ${duration}`,
    summary ? `Summary: ${summary}` : null,
    recording ? `Recording: ${recording}` : null,
    `Call ID: ${callId}`,
  ].filter(Boolean).join('\n');

  await Promise.all([
    ghlPost(`/contacts/${contactId}/tags`,  { tags: [tag] }),
    ghlPost(`/contacts/${contactId}/notes`, { body: note }),
  ]);

  return res.status(200).json({ ok: true, tag });
};
