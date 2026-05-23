const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

const STAGES = {
  SC_UPCOMING: '8216ee1d-73eb-4a3e-b53b-8b8cf0942256',
  DC_NOSHOW:   'f7a093f3-799e-4c00-826b-886c41199063',
};

// Fallback list used only if Dropbox Sign API key is not set
const STALE_CONTRACTS_FALLBACK = [
  { name: 'Doyinsola Abikoye', biz: 'No business name on file', sentDate: '2026-04-17' },
  { name: 'Emily Anderson',    biz: 'Renew Chiropractic',       sentDate: '2026-04-18' },
  { name: 'Brittany Baumer',   biz: 'The Skin & Body Spa',      sentDate: '2026-04-21' },
  { name: 'Andre F',           biz: 'Clear Cost Telehealth',    sentDate: '2026-04-22' },
  { name: 'Nayson Rouhipour',  biz: "Glendale's Urgent Care",   sentDate: '2026-05-05' },
  { name: 'Nnenna Obioha',     biz: 'Lost in GHL — contract sent after', sentDate: '2026-05-07' },
  { name: 'Yahaira Manon',     biz: '2 ad images in Drive',     sentDate: '2026-05-13' },
];

async function getDropboxSignContracts() {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) return null;

  try {
    const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
    const res = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=50', {
      headers: { Authorization: auth },
    });
    if (!res.ok) return null;
    const data = await res.json();

    return (data.signature_requests || [])
      .filter(r => !r.is_complete && !r.is_declined)
      .map(r => {
        const signer = r.signers?.[0] || {};
        const sentDate = new Date(r.created_at * 1000).toISOString().split('T')[0];
        return {
          name: signer.name || r.title || 'Unknown',
          biz:  r.title || '',
          sentDate,
          signatureRequestId: r.signature_request_id,
        };
      });
  } catch {
    return null;
  }
}

async function ghlFetch(path, pit) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pit = process.env.GHL_PIT_AGENCY || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';

  // Fetch all agency opps once
  const oppsData = await ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, pit);
  const opps = oppsData?.opportunities || [];

  const now = new Date();

  // ── SC: Upcoming — check each contact for a future appointment ─────────────
  const scOpps = opps.filter(o => o.pipelineStageId === STAGES.SC_UPCOMING);

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

  const scNoCall   = scResults.filter(r => !r.hasFutureAppt).sort((a, b) => b.daysInStage - a.daysInStage);
  const scConfirmed = scResults.filter(r =>  r.hasFutureAppt).sort((a, b) => new Date(a.nextAppt) - new Date(b.nextAppt));

  // ── DC: No-Show ────────────────────────────────────────────────────────────
  const dcNoShows = opps
    .filter(o => o.pipelineStageId === STAGES.DC_NOSHOW)
    .map(o => ({
      name:          o.contact.name || 'Unknown',
      phone:         o.contact.phone || null,
      contactId:     o.contact.id,
      daysInStage:   daysSince(o.lastStageChangeAt),
      lastStageChangeAt: o.lastStageChangeAt,
    }))
    .sort((a, b) => b.daysInStage - a.daysInStage);

  // ── Stale Contracts — live from Dropbox Sign, fallback to static list ────────
  const scByName = {};
  scResults.forEach(r => { scByName[r.name?.toLowerCase().trim()] = r; });

  const rawContracts = (await getDropboxSignContracts()) ?? STALE_CONTRACTS_FALLBACK;

  const staleContracts = rawContracts.map(c => {
    const match = scByName[c.name?.toLowerCase().trim()];
    return {
      ...c,
      daysSinceSent: daysSince(c.sentDate),
      phone:         match?.phone     || null,
      contactId:     match?.contactId || null,
    };
  }).sort((a, b) => b.daysSinceSent - a.daysSinceSent);

  // ── Summary ────────────────────────────────────────────────────────────────
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
