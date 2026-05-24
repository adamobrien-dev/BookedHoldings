// GET /api/contract-chase
// Fetches every unsigned Dropbox Sign contract, looks up the signer's
// phone number in GHL, and sends an escalating follow-up SMS.
//
// ?send=true to fire (default: dry run)
//
// Message sequence by days since contract sent:
//   1–7   → soft check-in
//   8–14  → value reminder, offer a call
//   15–21 → urgency — spot going to waitlist
//   22+   → final push

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

function firstName(name = '') {
  return name.trim().replace(/^Dr\.\s*/i, '').split(' ')[0] || name;
}

function daysSince(isoOrEpoch) {
  const ms = typeof isoOrEpoch === 'number' ? isoOrEpoch * 1000 : new Date(isoOrEpoch).getTime();
  return Math.floor((Date.now() - ms) / 86400000);
}

function pickMessage(name, days) {
  const fn = firstName(name);
  if (days <= 7) return (
    `Hey ${fn}, just following up on the BookedClinics agreement I sent over. Any questions before you sign? ` +
    `Once it's done we can start building your patient pipeline right away — takes about 2 minutes.`
  );
  if (days <= 14) return (
    `Hey ${fn}, Adam here from BookedClinics. The contract's been sitting for a bit — want to hop on a quick ` +
    `10-min call to go through it together? We just launched a campaign for a clinic in your area getting solid results.`
  );
  if (days <= 21) return (
    `Hey ${fn}, heads up — we're about to open your area spot to someone on the waitlist. ` +
    `If you're still in, now's the time. The contract's already in your inbox, one click and we're off.`
  );
  return (
    `Hey ${fn}, last follow-up on the BookedClinics proposal. If the timing isn't right just reply "not now" ` +
    `and I'll close this out — no hard feelings. If you're in, let's get it done today.`
  );
}

async function getUnsignedContracts(apiKey) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  const r = await fetch(
    'https://api.hellosign.com/v3/signature_request/list?query=status%3Aawaiting_signature&page_size=100',
    { headers: { Authorization: auth } }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Dropbox Sign ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data?.signature_requests || []).map(sr => ({
    id: sr.signature_request_id,
    title: sr.title,
    createdAt: sr.created_at,
    signerName:  sr.signatures?.[0]?.signer_name || null,
    signerEmail: sr.signatures?.[0]?.signer_email_address || null,
  }));
}

async function findGhlContact(email, name, pit) {
  // Try email first (exact)
  if (email) {
    const r = await fetch(
      `${GHL_API}/contacts/?locationId=${AGENCY_LOC}&query=${encodeURIComponent(email)}&limit=5`,
      { headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION } }
    );
    if (r.ok) {
      const data = await r.json();
      const match = (data?.contacts || []).find(c =>
        c.email?.toLowerCase() === email.toLowerCase()
      );
      if (match) return match;
    }
  }
  // Fall back to name search
  if (name) {
    const r = await fetch(
      `${GHL_API}/contacts/?locationId=${AGENCY_LOC}&query=${encodeURIComponent(name)}&limit=5`,
      { headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION } }
    );
    if (r.ok) {
      const data = await r.json();
      const lower = name.toLowerCase();
      return (data?.contacts || []).find(c =>
        (c.name || '').toLowerCase().includes(lower.split(' ')[0])
      ) || null;
    }
  }
  return null;
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';
  const dsKey = process.env.DROPBOX_SIGN_API_KEY;
  const dry = req.query.send !== 'true';

  if (!dsKey) return res.status(500).json({ error: 'DROPBOX_SIGN_API_KEY not set' });

  let contracts;
  try {
    contracts = await getUnsignedContracts(dsKey);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  const sent    = [];
  const skipped = [];

  for (const contract of contracts) {
    const days = daysSince(contract.createdAt);
    const contact = await findGhlContact(contract.signerEmail, contract.signerName, pit);

    if (!contact) {
      skipped.push({ signerName: contract.signerName, signerEmail: contract.signerEmail, contractAge: `${days}d`, reason: 'not found in GHL' });
      continue;
    }
    if (!contact.phone) {
      skipped.push({ name: contact.name, contractAge: `${days}d`, reason: 'no phone in GHL' });
      continue;
    }

    const message = pickMessage(contact.name, days);
    const result  = await sendSms(contact.id, message, pit, dry);

    sent.push({
      name: contact.name,
      phone: contact.phone,
      contractTitle: contract.title,
      contractAge: `${days} days`,
      sequence: days <= 7 ? 1 : days <= 14 ? 2 : days <= 21 ? 3 : 4,
      message,
      ...result,
    });
  }

  res.status(200).json({
    dry,
    totalContracts: contracts.length,
    summary: { sent: sent.length, skipped: skipped.length },
    sent,
    skipped,
  });
};
