// POST /api/western-renewables-lead  { name, phone, email?, enquiry_type?, location?,
//   residential_or_commercial?, existing_customer?, urgency?, requested_next_step?, call_summary }
//   — called by the "Sarah" Retell agent's capture_lead tool, built specifically for the Western
//     Renewables (Ivan Murphy) demo. Upserts the caller as a GHL contact in Western Renewables'
//     own sub-account, tags them, files the structured details into custom fields, drops them
//     into the "Western Renewables" pipeline at New Enquiry, and logs a note — mirrors
//     flashbooked/api/lead.js's pattern but writes real opportunity/pipeline data instead of a
//     generic FlashBooked lead note, since this is a dedicated per-client sub-account demo.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (same trust boundary as the
// other Aoife/Sarah tool endpoints).
//
// Always responds 200 with a `message` field, even on failure — handed straight to the LLM
// mid-call, so a raw error status/JSON would surface as confusing text to a live caller.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = '5vsBqK6J2m6ayOA8fjna'; // Western Renewables (Ivan Murphy)
const PIPELINE_ID = 'waVbyKQ4J16rTiLEVe5y';
const STAGE_NEW_ENQUIRY = 'cb774fde-7c11-44bb-af9a-8d6e57a2e099';

const FLD_ENQUIRY = 'gZITS7RITjZ6zk5hnrXW';
const FLD_LOCATION = 'TCKePpOVtpTc325WO5Hv';
const FLD_EXISTING = 'SOO3et0fg3duUnEqkdQs';
const FLD_SUMMARY = '01lSxglIp8IJzvzg6Cxl';
const FLD_PRIORITY = '4lLZqHHPQuJdLclUkI61';
const FLD_NEXTSTEP = '6gudjfLhx2hTEqpFmlSg';

const FALLBACK_MESSAGE = "I'm having a bit of trouble saving that on my end — let the caller know you'll take their number and have the team call them back.";

async function ghl(method, path, body, pit) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

function computeTags({ enquiry_type, residential_or_commercial, requested_next_step }) {
  const tags = ['ai handled'];
  const type = (enquiry_type || '').toLowerCase();
  if (type === 'solar') tags.push('solar');
  if (type === 'ev charger') tags.push('ev charger');
  if (type === 'battery') tags.push('battery');
  const roc = (residential_or_commercial || '').toLowerCase();
  if (roc === 'commercial') tags.push('commercial');
  if (roc === 'residential') tags.push('residential');
  if (/survey/i.test(requested_next_step || '')) tags.push('survey required');
  return tags;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    console.error('western-renewables-lead: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const pit = process.env.GHL_PIT_WESTERN_RENEWABLES;
  if (!pit) {
    console.error('western-renewables-lead: GHL_PIT_WESTERN_RENEWABLES not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const {
    name, phone, email, enquiry_type, location,
    residential_or_commercial, existing_customer, urgency,
    requested_next_step, call_summary,
  } = req.body || {};

  if (!phone) return res.status(200).json({ ok: false, message: 'Ask the caller for a callback phone number before saving their details.' });

  try {
    const [firstName, ...rest] = (name || '').trim().split(/\s+/).filter(Boolean);
    const upsert = await ghl('POST', '/contacts/upsert', {
      locationId: LOCATION_ID,
      ...(firstName ? { firstName } : {}),
      ...(rest.length ? { lastName: rest.join(' ') } : {}),
      ...(name ? { name } : {}),
      phone,
      ...(email ? { email } : {}),
      country: 'IE',
      source: 'Western Renewables — AI Receptionist (Sarah)',
      tags: computeTags({ enquiry_type, residential_or_commercial, requested_next_step }),
      customFields: [
        ...(enquiry_type ? [{ id: FLD_ENQUIRY, field_value: enquiry_type }] : []),
        ...(location ? [{ id: FLD_LOCATION, field_value: location }] : []),
        ...(existing_customer != null ? [{ id: FLD_EXISTING, field_value: existing_customer ? 'Yes' : 'No' }] : []),
        ...(call_summary ? [{ id: FLD_SUMMARY, field_value: call_summary }] : []),
        ...(urgency ? [{ id: FLD_PRIORITY, field_value: urgency }] : []),
        ...(requested_next_step ? [{ id: FLD_NEXTSTEP, field_value: requested_next_step }] : []),
      ],
    }, pit);

    if (!upsert.ok) {
      console.error('western-renewables-lead: GHL upsert failed', upsert.status, JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }
    const contactId = upsert.data?.contact?.id;
    if (!contactId) {
      console.error('western-renewables-lead: GHL upsert returned no contact id', JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }

    await ghl('POST', '/opportunities/', {
      pipelineId: PIPELINE_ID,
      locationId: LOCATION_ID,
      name: `${name || 'Caller'} - ${enquiry_type || 'Enquiry'}`,
      pipelineStageId: STAGE_NEW_ENQUIRY,
      contactId,
      status: 'open',
      monetaryValue: 0,
      source: 'Western Renewables — AI Receptionist (Sarah)',
    }, pit);

    if (call_summary) {
      await ghl('POST', `/contacts/${contactId}/notes`, {
        body: `AI Call Summary: ${call_summary}`,
      }, pit);
    }

    return res.status(200).json({ ok: true, contactId, message: 'Got it, that\'s all noted down — the team will follow up.' });
  } catch (err) {
    console.error('western-renewables-lead error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }
};
