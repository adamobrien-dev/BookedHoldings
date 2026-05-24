// GET /api/contract-chase
// Finds unsigned Dropbox Sign contracts for contacts in SC: Upcoming,
// then sends the appropriate follow-up SMS based on how long the contract
// has been sitting. Escalates through 4 messages as days increase.
//
// ?send=true to actually fire (default: dry run)
//
// Message sequence (days since contract sent):
//   1–7   days → soft check-in
//   8–14  days → value reminder + offer a call
//   15–21 days → urgency — spot going to waitlist
//   22+   days → final push, close this out

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

function firstName(name = '') {
  return name.trim().replace(/^Dr\.\s*/i, '').split(' ')[0] || name;
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function pickMessage(name, days) {
  const fn = firstName(name);
  if (days <= 7) return (
    `Hey ${fn}, just following up on the BookedClinics agreement I sent over. Any questions before you sign? ` +
    `Once it's done we can start building your patient pipeline right away — takes about 2 minutes.`
  );
  if (days <= 14) return (
    `Hey ${fn}, Adam here from BookedClinics. The contract's been sitting for a bit — want to hop on a quick ` +
    `10-min call to go through it together? We just launched a campaign for a clinic in your area and it's already pulling leads.`
  );
  if (days <= 21) return (
    `Hey ${fn}, heads up — we're about to open your area spot to someone on the waitlist. ` +
    `If you're still in, now's the time. The contract's already in your inbox, one click and we're off.`
  );
  return (
    `Hey ${fn}, last follow-up on the BookedClinics proposal. If the timing isn't right, ` +
    `just reply "not now" and I'll close this out — no hard feelings. If you're still in, let's get it done today.`
  );
}

async function getUnsignedContracts(apiKey) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  const r = await fetch(
    'https://api.hellosign.com/v3/signature_request/list?query=status%3Aawaiting_signature&page_size=100',
    { headers: { Authorization: auth } }
  );
  if (!r.ok) return { error: `Dropbox Sign ${r.status}`, contracts: [] };
  const data = await r.json();
  return {
    error: null,
    contracts: (data?.signature_requests || []).map(sr => ({
      id: sr.signature_request_id,
      title: sr.title,
      createdAt: new Date(sr.created_at * 1000).toISOString(),
      signerName:  sr.signatures?.[0]?.signer_name  || null,
      signerEmail: sr.signatures?.[0]?.signer_email_address || null,
    })),
  };
}

async function ghl(path, pit) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function sendSms(contactId, message, pit, dry) {
  if (dry) return { dry: true };
  const r = await fetch(`${GHL_API}/conversations/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'SMS', contactId, locationId: AGENCY_LOC, message }),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  return {
    ok: r.ok,
    status: r.status,
    messageId: data?.messageId || data?.id || null,
    error: r.ok ? null : text.slice(0, 200),
  };
}

// Fuzzy name match — first name + either last name starts with same letter
function namesMatch(ghlName = '', signName = '') {
  const normalize = s => s.toLowerCase().replace(/[^a-z ]/g, '').trim();
  const ghl = normalize(ghlName).split(' ');
  const sign = normalize(signName).split(' ');
  if (!ghl[0] || !sign[0]) return false;
  if (ghl[0] !== sign[0]) return false;           // first names must match
  if (!ghl[1] || !sign[1]) return true;           // if one has no last name, match on first
  return ghl[1][0] === sign[1][0];                // last name initial must match
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';
  const dsKey = process.env.DROPBOX_SIGN_API_KEY;
  const dry = req.query.send !== 'true';

  if (!dsKey) return res.status(500).json({ error: 'DROPBOX_SIGN_API_KEY not set' });

  // ── 1. Fetch unsigned contracts from Dropbox Sign ──────────────────────────
  const { error: dsError, contracts } = await getUnsignedContracts(dsKey);
  if (dsError) return res.status(502).json({ error: dsError });

  // ── 2. Fetch all open contacts from GHL (any stage, not won/lost) ──────────
  const oppsData = await ghl(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, pit);
  const scOpps = (oppsData?.opportunities || []).filter(
    o => o.status !== 'lost' && o.status !== 'won'
  );

  // ── 3. Cross-reference ─────────────────────────────────────────────────────
  const sent    = [];
  const skipped = [];

  for (const opp of scOpps) {
    const { id: contactId, name: ghlName, phone } = opp.contact || {};

    const match = contracts.find(c => namesMatch(ghlName, c.signerName));

    if (!match) {
      skipped.push({ name: ghlName, reason: 'no unsigned contract found in Dropbox Sign' });
      continue;
    }
    if (!phone) {
      skipped.push({ name: ghlName, reason: 'no phone number in GHL', contract: match.title });
      continue;
    }

    const days = daysSince(match.createdAt);
    const message = pickMessage(ghlName, days);
    const result = await sendSms(contactId, message, pit, dry);

    sent.push({
      name: ghlName,
      phone,
      contractTitle: match.title,
      contractAge: `${days} days`,
      messageSequence: days <= 7 ? 1 : days <= 14 ? 2 : days <= 21 ? 3 : 4,
      message,
      ...result,
    });
  }

  res.status(200).json({
    dry,
    dropboxContracts: contracts.length,
    openPipelineContacts: scOpps.length,
    summary: { sent: sent.length, skipped: skipped.length },
    sent,
    skipped,
  });
};
