// GET /api/sync-reply-tags           — sync tags by conversation reply state
// GET /api/sync-reply-tags?mode=appt — sync tags by upcoming-appointment state
// Default: dry run. Add ?apply=true to commit writes.

const GHL_API  = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC  = 'NKpzhLv8iNQ0c9Ge3QAR';

async function ghl(method, path, body, pit) {
  const r = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
}

async function setTags(contactId, addTags, removeTags, pit, dry) {
  if (dry) return { dry: true };
  const results = {};
  if (removeTags.length) {
    const r = await ghl('DELETE', `/contacts/${contactId}/tags`, { tags: removeTags }, pit);
    results.removed = { ok: r.ok, status: r.status };
  }
  if (addTags.length) {
    const r = await ghl('POST', `/contacts/${contactId}/tags`, { tags: addTags }, pit);
    results.added = { ok: r.ok, status: r.status };
  }
  return results;
}

async function syncByReplies(opps, pitRead, pitWrite, dry) {
  const convosResult = await ghl('GET', `/conversations/search?locationId=${AGENCY_LOC}&limit=100`, null, pitRead);
  if (!convosResult.ok) throw new Error(`GHL convos error: ${convosResult.status}`);

  const convoByContact = {};
  for (const c of convosResult.data?.conversations || []) {
    if (c.contactId) convoByContact[c.contactId] = c;
  }

  return Promise.all(opps.map(async opp => {
    const contactId = opp.contact?.id;
    const name = opp.contact?.name || 'Unknown';
    if (!contactId) return { name, action: 'skip', reason: 'no contact ID' };

    const hasReply = convoByContact[contactId]?.unreadCount > 0;
    const add    = hasReply ? ['replied']          : ['follow up needed'];
    const remove = hasReply ? ['follow up needed'] : ['replied'];
    const tagResult = await setTags(contactId, add, remove, pitWrite, dry);
    return { name, phone: opp.contact?.phone, stage: opp.pipelineStageName, hasReply, add, remove, ...tagResult };
  }));
}

async function syncByAppointments(opps, pitRead, pitWrite, dry) {
  const now = Date.now();
  return Promise.all(opps.map(async opp => {
    const contactId = opp.contact?.id;
    const name = opp.contact?.name || 'Unknown';
    if (!contactId) return { name, action: 'skip', reason: 'no contact ID' };

    const { data } = await ghl('GET', `/contacts/${contactId}/appointments`, null, pitRead);
    const hasAppt = (data?.events || []).some(e => {
      const t = new Date(e.startTime || e.endTime).getTime();
      return !isNaN(t) && t > now;
    });
    if (hasAppt) return { name, phone: opp.contact?.phone, action: 'skip', reason: 'has upcoming appointment' };

    const tagResult = await setTags(contactId, ['follow up needed'], [], pitWrite, dry);
    return { name, phone: opp.contact?.phone, stage: opp.pipelineStageName, tagged: true, ...tagResult };
  }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pitRead  = process.env.GHL_PIT_AGENCY   || 'pit-e4f008f0-1bf3-47d6-b22e-2cbca0390d82';
  const pitWrite = process.env.GHL_PIT_CONTACTS || pitRead;
  const dry  = req.query.apply !== 'true';
  const mode = req.query.mode === 'appt' ? 'appt' : 'replies';

  try {
    const oppsResult = await ghl('GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, null, pitRead);
    if (!oppsResult.ok) return res.status(502).json({ error: 'GHL opps error', status: oppsResult.status });

    const opps = (oppsResult.data?.opportunities || []).filter(o => o.status !== 'lost');
    const results = mode === 'appt'
      ? await syncByAppointments(opps, pitRead, pitWrite, dry)
      : await syncByReplies(opps, pitRead, pitWrite, dry);

    res.status(200).json({ dry, mode, total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
