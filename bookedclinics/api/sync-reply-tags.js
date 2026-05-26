// Syncs tags based on conversation replies:
//   - Has unread reply → remove "follow up needed", add "replied"
//   - No reply        → ensure "follow up needed" tag is present
// Default: dry run. ?apply=true to write tags.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pitRead  = process.env.GHL_PIT_AGENCY   || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
  const pitWrite = process.env.GHL_PIT_CONTACTS || pitRead;
  const dry = req.query.apply !== 'true';

  const [oppsResult, convosResult] = await Promise.all([
    ghl('GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, null, pitRead),
    ghl('GET', `/conversations/search?locationId=${AGENCY_LOC}&limit=100`, null, pitRead),
  ]);

  if (!oppsResult.ok)  return res.status(502).json({ error: 'GHL opps error',   status: oppsResult.status });
  if (!convosResult.ok) return res.status(502).json({ error: 'GHL convos error', status: convosResult.status });

  const opps   = (oppsResult.data?.opportunities  || []).filter(o => o.status !== 'lost');
  const convos =  convosResult.data?.conversations || [];

  const convoByContact = {};
  for (const c of convos) {
    if (c.contactId) convoByContact[c.contactId] = c;
  }

  const results = await Promise.all(opps.map(async opp => {
    const contactId = opp.contact?.id;
    const name      = opp.contact?.name || 'Unknown';
    if (!contactId) return { name, action: 'skip', reason: 'no contact ID' };

    const convo    = convoByContact[contactId];
    const hasReply = convo && convo.unreadCount > 0;

    const add    = hasReply ? ['replied']           : ['follow up needed'];
    const remove = hasReply ? ['follow up needed']  : ['replied'];

    const tagResult = await setTags(contactId, add, remove, pitWrite, dry);
    return { name, phone: opp.contact?.phone, stage: opp.pipelineStageName, hasReply, add, remove, ...tagResult };
  }));

  const replied    = results.filter(r => r.hasReply);
  const noReply    = results.filter(r => !r.hasReply && r.action !== 'skip');

  res.status(200).json({
    dry,
    summary: { replied: replied.length, noReply: noReply.length, total: results.length },
    replied,
    noReply,
  });
};
