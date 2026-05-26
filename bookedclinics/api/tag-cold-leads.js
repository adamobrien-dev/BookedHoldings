// GET /api/tag-cold-leads
// Tags every pipeline contact without an upcoming appointment as "cold clinic lead"
// Default: dry run — ?apply=true to actually write tags

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const TAG = 'cold clinic lead';

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

  const pit = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';
  const dry = req.query.apply !== 'true';

  const oppsResult = await ghl('GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, null, pit);
  if (!oppsResult.ok) {
    return res.status(502).json({ error: 'GHL API error', status: oppsResult.status, detail: oppsResult.data });
  }

  const opps = (oppsResult.data?.opportunities || []).filter(o => o.status !== 'lost');

  const tagged = [];
  const skipped = [];

  for (const opp of opps) {
    const { id: contactId, name, phone } = opp.contact || {};
    if (!contactId) {
      skipped.push({ name, reason: 'no contact ID' });
      continue;
    }

    const hasAppt = await hasFutureAppointment(contactId, pit);
    if (hasAppt) {
      skipped.push({ name, phone, stage: opp.pipelineStageName, reason: 'has upcoming appointment' });
      continue;
    }

    const result = await addTag(contactId, pit, dry);
    tagged.push({ name, phone, stage: opp.pipelineStageName, tag: TAG, ...result });
  }

  res.status(200).json({
    dry,
    tag: TAG,
    summary: { tagged: tagged.length, skipped: skipped.length },
    tagged,
    skipped,
  });
};
