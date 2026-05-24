// GET /api/retarget-sms
// Retargeting SMS campaign for BookedClinics agency pipeline.
// Default: dry run — shows who would receive what.
// Add ?send=true to actually fire the messages.
//
// Targets:
//   DC_NOSHOW      — missed their discovery call
//   SC_UPCOMING    — in strategy call stage but no appointment booked
//   Cold / Other   — all other open opps not already in DC/SC stages
//   Stale contracts— hardcoded list of unsigned proposals

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

const STAGE_IDS = {
  DC_UPCOMING: 'd0065956-d245-4c34-8bcd-4414a3a2c408',
  DC_NOSHOW:   'f7a093f3-799e-4c00-826b-886c41199063',
  SC_UPCOMING: '8216ee1d-73eb-4a3e-b53b-8b8cf0942256',
};

// Names from STALE_CONTRACTS — no appt, contract was sent
const STALE_NAMES = [
  'Doyinsola Abikoye',
  'Emily Anderson',
  'Brittany Baumer',
  'Andre F',
  'Nayson Rouhipour',
  'Nnenna Obioha',
  'Yahaira Manon',
];

function firstName(fullName = '') {
  return fullName.trim().replace(/^Dr\.\s*/i, '').split(' ')[0] || fullName;
}

const TEMPLATES = {
  DC_NOSHOW: (name) =>
    `Hey ${firstName(name)}, it's Adam from BookedClinics. We missed each other on our discovery call — still interested in getting more patients for your practice? I can send you a new booking link.`,

  SC_NO_APPT: (name) =>
    `Hey ${firstName(name)}, Adam from BookedClinics here. Just noticed we don't have a strategy call locked in yet. We have a few spots open this week — want me to send you a link?`,

  STALE_CONTRACT: (name) =>
    `Hey ${firstName(name)}, following up on the proposal I sent over for BookedClinics. Happy to answer any questions before you sign — just reply here or let me know if you want a quick call.`,

  COLD: (name) =>
    `Hey ${firstName(name)}, it's Adam from BookedClinics. Wanted to check in — are you still looking to grow your patient numbers? We're helping clinics add 10-20 new patients a month. Got 10 min this week?`,
};

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function hasFutureAppointment(contactId, pit) {
  const { data } = await ghl('GET', `/contacts/${contactId}/appointments`, null, pit);
  const now = Date.now();
  return (data?.events || []).some(e => {
    const t = new Date(e.startTime || e.endTime).getTime();
    return !isNaN(t) && t > now;
  });
}

async function sendSms(contactId, message, locationId, pit, dry) {
  if (dry) return { dry: true };
  const { ok, status, data } = await ghl('POST', '/conversations/messages', {
    type: 'SMS',
    contactId,
    locationId,
    message,
  }, pit);
  return { ok, status, messageId: data?.messageId || data?.id || null, error: ok ? null : JSON.stringify(data) };
}

async function findContactByName(name, pit) {
  const { data } = await ghl('GET', `/contacts/?locationId=${AGENCY_LOC}&query=${encodeURIComponent(name)}&limit=5`, null, pit);
  const contacts = data?.contacts || [];
  const lower = name.toLowerCase();
  return contacts.find(c => (c.name || '').toLowerCase().includes(lower)) || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';
  const dry = req.query.send !== 'true';

  const results = { dry, sent: [], skipped: [], errors: [] };

  // ── 1. Fetch all open opportunities ────────────────────────────────────────
  const { data: oppsData } = await ghl(
    'GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, null, pit
  );
  const opps = (oppsData?.opportunities || []).filter(o => o.status !== 'lost');

  // ── 2. DC_NOSHOW — missed discovery call ───────────────────────────────────
  const dcNoShow = opps.filter(o => o.pipelineStageId === STAGE_IDS.DC_NOSHOW);
  for (const opp of dcNoShow) {
    const { id: contactId, name, phone } = opp.contact || {};
    if (!contactId || !phone) { results.skipped.push({ name, reason: 'no phone', stage: 'DC_NOSHOW' }); continue; }
    const message = TEMPLATES.DC_NOSHOW(name);
    const send = await sendSms(contactId, message, AGENCY_LOC, pit, dry);
    results.sent.push({ name, phone, stage: 'DC_NOSHOW', message, ...send });
  }

  // ── 3. SC_UPCOMING — in strategy call stage but no appointment ─────────────
  const scOpps = opps.filter(o => o.pipelineStageId === STAGE_IDS.SC_UPCOMING);
  for (const opp of scOpps) {
    const { id: contactId, name, phone } = opp.contact || {};
    if (!contactId || !phone) { results.skipped.push({ name, reason: 'no phone', stage: 'SC_UPCOMING' }); continue; }
    const hasAppt = await hasFutureAppointment(contactId, pit);
    if (hasAppt) { results.skipped.push({ name, phone, stage: 'SC_UPCOMING', reason: 'has upcoming appointment' }); continue; }
    const message = TEMPLATES.SC_NO_APPT(name);
    const send = await sendSms(contactId, message, AGENCY_LOC, pit, dry);
    results.sent.push({ name, phone, stage: 'SC_UPCOMING', message, ...send });
  }

  // ── 4. Cold / other open stages ────────────────────────────────────────────
  const knownStages = new Set(Object.values(STAGE_IDS));
  const coldOpps = opps.filter(o => !knownStages.has(o.pipelineStageId) && o.status === 'open');
  for (const opp of coldOpps) {
    const { id: contactId, name, phone } = opp.contact || {};
    if (!contactId || !phone) { results.skipped.push({ name, reason: 'no phone', stage: opp.pipelineStageName || 'unknown' }); continue; }
    const message = TEMPLATES.COLD(name);
    const send = await sendSms(contactId, message, AGENCY_LOC, pit, dry);
    results.sent.push({ name, phone, stage: opp.pipelineStageName || 'cold', message, ...send });
  }

  // ── 5. Stale contracts — look up by name ───────────────────────────────────
  for (const staleName of STALE_NAMES) {
    const contact = await findContactByName(staleName, pit);
    if (!contact) { results.skipped.push({ name: staleName, reason: 'not found in GHL', stage: 'stale_contract' }); continue; }
    if (!contact.phone) { results.skipped.push({ name: staleName, reason: 'no phone', stage: 'stale_contract' }); continue; }
    // Skip if they're already in the pipeline results above (avoid double-sending)
    const alreadySent = results.sent.some(r => r.name === contact.name);
    if (alreadySent) { results.skipped.push({ name: staleName, reason: 'already targeted via pipeline', stage: 'stale_contract' }); continue; }
    const message = TEMPLATES.STALE_CONTRACT(contact.name);
    const send = await sendSms(contact.id, message, AGENCY_LOC, pit, dry);
    results.sent.push({ name: contact.name, phone: contact.phone, stage: 'stale_contract', message, ...send });
  }

  results.summary = {
    totalTargeted: results.sent.length,
    totalSkipped: results.skipped.length,
    breakdown: {
      dcNoShow: results.sent.filter(r => r.stage === 'DC_NOSHOW').length,
      scNoAppt: results.sent.filter(r => r.stage === 'SC_UPCOMING').length,
      cold: results.sent.filter(r => r.stage !== 'DC_NOSHOW' && r.stage !== 'SC_UPCOMING' && r.stage !== 'stale_contract').length,
      staleContract: results.sent.filter(r => r.stage === 'stale_contract').length,
    },
  };

  res.status(200).json(results);
};
