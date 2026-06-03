const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

async function ghlFetch(path, pit) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

function classifyStage(stageName = '') {
  const s = stageName.toLowerCase();
  if (s.includes('sc') && s.includes('upcoming')) return 'SC_UPCOMING';
  if (s.includes('dc') && s.includes('no show')) return 'DC_NOSHOW';
  return 'OTHER';
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

async function getUnsignedContracts() {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY || '0c7c0852c085eeeb45c29567517edd91fe42cde48870c1d3bf0971dda88e6f11';
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  try {
    const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=100', {
      headers: { Authorization: auth },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.signature_requests || [])
      .filter(sr => !sr.is_complete && !sr.is_declined)
      .map(sr => ({
        name:         sr.signatures?.[0]?.signer_name || 'Unknown',
        email:        sr.signatures?.[0]?.signer_email_address || null,
        title:        sr.title,
        daysSinceSent: Math.floor((Date.now() - sr.created_at * 1000) / 86400000),
      }))
      .sort((a, b) => b.daysSinceSent - a.daysSinceSent);
  } catch { return []; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pit = process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';

  const [oppsData, unsignedContracts] = await Promise.all([
    ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, pit),
    getUnsignedContracts(),
  ]);
  const opps = oppsData?.opportunities || [];

  const now = new Date();

  // ── SC: Upcoming ──────────────────────────────────────────────────────────
  const scOpps = opps.filter(o => classifyStage(o.pipelineStageName) === 'SC_UPCOMING');

  const scResults = await Promise.all(scOpps.map(async o => {
    const apData = await ghlFetch(`/contacts/${o.contact.id}/appointments`, pit);
    const future = (apData?.events || []).filter(e => new Date(e.startTime || e.endTime) > now);
    const sorted = future.sort((a, b) => new Date(a.startTime || a.endTime) - new Date(b.startTime || b.endTime));
    return {
      name:             o.contact.name || 'Unknown',
      phone:            o.contact.phone || null,
      contactId:        o.contact.id,
      hasFutureAppt:    future.length > 0,
      nextAppt:         sorted[0]?.startTime || null,
      daysInStage:      daysSince(o.lastStageChangeAt),
      lastStageChangeAt: o.lastStageChangeAt,
    };
  }));

  const scNoCall    = scResults.filter(r => !r.hasFutureAppt).sort((a, b) => b.daysInStage - a.daysInStage);
  const scConfirmed = scResults.filter(r =>  r.hasFutureAppt).sort((a, b) => new Date(a.nextAppt) - new Date(b.nextAppt));

  // ── DC: No-Show ───────────────────────────────────────────────────────────
  const dcNoShows = opps
    .filter(o => classifyStage(o.pipelineStageName) === 'DC_NOSHOW')
    .map(o => ({
      name:             o.contact.name || 'Unknown',
      phone:            o.contact.phone || null,
      contactId:        o.contact.id,
      daysInStage:      daysSince(o.lastStageChangeAt),
      lastStageChangeAt: o.lastStageChangeAt,
    }))
    .sort((a, b) => b.daysInStage - a.daysInStage);

  // ── Stale Contracts — cross-reference SC list for phone numbers ───────────
  const scByName = {};
  scResults.forEach(r => { scByName[r.name?.toLowerCase().trim()] = r; });

  const staleContracts = unsignedContracts.map(c => {
    const match = scByName[c.name?.toLowerCase().trim()];
    return {
      ...c,
      phone:     match?.phone     || null,
      contactId: match?.contactId || null,
    };
  });

  const criticalContracts = staleContracts.filter(c => c.daysSinceSent >= 14).length;

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    scNoCall,
    scConfirmed,
    dcNoShows,
    staleContracts,
    summary: {
      scNoCall:          scNoCall.length,
      scConfirmed:       scConfirmed.length,
      dcNoShows:         dcNoShows.length,
      staleContracts:    staleContracts.length,
      criticalContracts,
      totalRecoverable:  scNoCall.length + dcNoShows.length + staleContracts.length,
    },
  });
};
