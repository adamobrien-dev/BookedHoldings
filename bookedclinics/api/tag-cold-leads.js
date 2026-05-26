const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const TAG = 'follow up needed';

async function ghl(method, path, body, pit) {
  const r = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
}

async function hasFutureAppointment(contactId, pit) {
  const { data } = await ghl('GET', `/contacts/${contactId}/appointments`, null, pit);
  const now = Date.now();
  return (data?.events || []).some(e => {
    const t = new Date(e.startTime || e.endTime).getTime();
    return !isNaN(t) && t > now;
  });
}

async function addTag(contactId, pit, dry) {
  if (dry) return { dry: true };
  const { ok, status, data } = await ghl('POST', `/contacts/${contactId}/tags`, { tags: [TAG] }, pit);
  return { ok, status, error: ok ? null : JSON.stringify(data).slice(0, 200) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pitRead  = process.env.GHL_PIT_AGENCY   || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
  const pitWrite = process.env.GHL_PIT_CONTACTS || pitRead;
  const dry = req.query.apply !== 'true';

  const oppsResult = await ghl('GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, null, pitRead);
  if (!oppsResult.ok) {
    return res.status(502).json({ error: 'GHL API error', status: oppsResult.status, detail: oppsResult.data });
  }

  const opps = (oppsResult.data?.opportunities || []).filter(o => o.status !== 'lost');

  // Check all appointments in parallel, then tag in parallel
  const results = await Promise.all(opps.map(async opp => {
    const { id: contactId, name, phone } = opp.contact || {};
    if (!contactId) return { skip: true, entry: { name, reason: 'no contact ID' } };

    const hasAppt = await hasFutureAppointment(contactId, pitRead);
    if (hasAppt) return { skip: true, entry: { name, phone, stage: opp.pipelineStageName, reason: 'has upcoming appointment' } };

    const result = await addTag(contactId, pitWrite, dry);
    return { skip: false, entry: { name, phone, stage: opp.pipelineStageName, tag: TAG, ...result } };
  }));

  const tagged  = results.filter(r => !r.skip).map(r => r.entry);
  const skipped = results.filter(r =>  r.skip).map(r => r.entry);

  res.status(200).json({
    dry,
    tag: TAG,
    summary: { tagged: tagged.length, skipped: skipped.length },
    tagged,
    skipped,
  });
};
