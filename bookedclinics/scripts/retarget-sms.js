// GET /api/retarget-sms
// Retargeting SMS campaign for BookedClinics agency pipeline.
// Default: dry run — shows who would receive what, no messages sent.
// Add ?send=true to actually fire.
//
// Groups targeted:
//   DC No Show     — missed their discovery call
//   SC No Show     — made it to strategy call but didn't show
//   DC Cancelled   — cancelled before discovery call
//   DC Follow Up   — was contacted, needs next step
//   SC Upcoming    — in strategy call stage but no appointment booked (> 7 days old)
//
// Won / DC Upcoming — skipped (don't disrupt active or closed contacts)

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

function firstName(name = '') {
  return name.trim().replace(/^Dr\.\s*/i, '').split(' ')[0] || name;
}

function classify(stageName = '') {
  const s = stageName.toLowerCase();
  if (s.includes('won') || s.includes('client')) return 'WON';
  if (s.includes('dc') && s.includes('upcoming')) return 'DC_UPCOMING';
  if (s.includes('dc') && s.includes('no show')) return 'DC_NOSHOW';
  if (s.includes('dc') && s.includes('cancel')) return 'DC_CANCELLED';
  if (s.includes('dc') && s.includes('follow')) return 'DC_FOLLOWUP';
  if (s.includes('sc') && s.includes('no show')) return 'SC_NOSHOW';
  if (s.includes('sc') && s.includes('upcoming')) return 'SC_UPCOMING';
  return 'OTHER';
}

const TEMPLATES = {
  DC_NOSHOW: (name) =>
    `Hey ${firstName(name)}, it's Adam from BookedClinics — looks like we missed each other on our discovery call. Still interested in getting more patients? I can send a new booking link right now.`,

  SC_NOSHOW: (name) =>
    `Hey ${firstName(name)}, Adam from BookedClinics here. We missed you on our strategy call — that's okay! Are you still open to growing your practice? I'd love to find a new time that works for you.`,

  DC_CANCELLED: (name) =>
    `Hey ${firstName(name)}, it's Adam from BookedClinics. Saw your call was cancelled — no worries at all. Are you still looking to bring in more patients? Happy to jump on a quick 15-min call this week.`,

  DC_FOLLOWUP: (name) =>
    `Hey ${firstName(name)}, Adam here from BookedClinics. Wanted to follow up on our last chat — are you ready to take the next step? We have a few strategy call spots open this week.`,

  SC_UPCOMING_NO_APPT: (name) =>
    `Hey ${firstName(name)}, Adam from BookedClinics here. Just noticed we still haven't locked in your strategy call. We have openings this week — want me to send you a booking link?`,
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

async function sendSms(contactId, message, pit, dry) {
  if (dry) return { dry: true };
  const { ok, status, data } = await ghl('POST', '/conversations/messages', {
    type: 'SMS',
    contactId,
    locationId: AGENCY_LOC,
    message,
  }, pit);
  return { ok, status, messageId: data?.messageId || data?.id || null, error: ok ? null : JSON.stringify(data).slice(0, 200) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-e4f008f0-1bf3-47d6-b22e-2cbca0390d82';
  const dry = req.query.send !== 'true';
  const onlyStage = req.query.only?.toUpperCase() || null; // e.g. ?only=SC_UPCOMING
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const oppsResult = await ghl('GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, null, pit);
  const oppsData = oppsResult.data;
  if (!oppsResult.ok) {
    return res.status(502).json({ error: 'GHL API error', status: oppsResult.status, detail: oppsData });
  }
  const opps = (oppsData?.opportunities || []).filter(o => o.status !== 'lost');

  const sent = [];
  const skipped = [];

  for (const opp of opps) {
    const { id: contactId, name, phone } = opp.contact || {};
    const stage = classify(opp.pipelineStageName || '');
    const createdAt = new Date(opp.dateAdded || opp.createdAt || 0).getTime();

    // Filter to specific stage if ?only= param provided
    if (onlyStage && stage !== onlyStage) {
      skipped.push({ name, stage: opp.pipelineStageName, reason: `filtered — only targeting ${onlyStage}` });
      continue;
    }

    // Skip — don't disrupt active or won contacts
    if (stage === 'WON' || stage === 'DC_UPCOMING') {
      skipped.push({ name, stage: opp.pipelineStageName, reason: 'skip — won or upcoming call' });
      continue;
    }

    if (!contactId || !phone) {
      skipped.push({ name, stage: opp.pipelineStageName, reason: 'no phone' });
      continue;
    }

    let template = null;

    if (stage === 'DC_NOSHOW') template = TEMPLATES.DC_NOSHOW;
    else if (stage === 'SC_NOSHOW') template = TEMPLATES.SC_NOSHOW;
    else if (stage === 'DC_CANCELLED') template = TEMPLATES.DC_CANCELLED;
    else if (stage === 'DC_FOLLOWUP') template = TEMPLATES.DC_FOLLOWUP;
    else if (stage === 'SC_UPCOMING') {
      // Only retarget SC_UPCOMING if opp is > 7 days old (no active booking in progress)
      if (createdAt > sevenDaysAgo) {
        skipped.push({ name, stage: opp.pipelineStageName, reason: 'SC_UPCOMING — too recent (<7 days)' });
        continue;
      }
      const hasAppt = await hasFutureAppointment(contactId, pit);
      if (hasAppt) {
        skipped.push({ name, phone, stage: opp.pipelineStageName, reason: 'SC_UPCOMING — has upcoming appointment' });
        continue;
      }
      template = TEMPLATES.SC_UPCOMING_NO_APPT;
    } else {
      skipped.push({ name, stage: opp.pipelineStageName, reason: `unrecognized stage — skipped` });
      continue;
    }

    const message = template(name);
    const result = await sendSms(contactId, message, pit, dry);
    sent.push({ name, phone, stage: opp.pipelineStageName, message, ...result });
  }

  res.status(200).json({
    dry,
    summary: {
      totalTargeted: sent.length,
      totalSkipped: skipped.length,
      breakdown: {
        dcNoShow:    sent.filter(r => r.stage?.toLowerCase().includes('dc') && r.stage?.toLowerCase().includes('no show')).length,
        scNoShow:    sent.filter(r => r.stage?.toLowerCase().includes('sc') && r.stage?.toLowerCase().includes('no show')).length,
        dcCancelled: sent.filter(r => r.stage?.toLowerCase().includes('cancel')).length,
        dcFollowUp:  sent.filter(r => r.stage?.toLowerCase().includes('follow')).length,
        scNoAppt:    sent.filter(r => r.stage?.toLowerCase().includes('sc') && r.stage?.toLowerCase().includes('upcoming')).length,
      },
    },
    sent,
    skipped,
  });
};
