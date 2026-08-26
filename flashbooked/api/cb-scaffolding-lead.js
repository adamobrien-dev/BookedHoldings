// POST /api/cb-scaffolding-lead  { name, phone, email?, enquiry_type?, residential_or_commercial?,
//   site_location?, property_type?, storeys?, scope_of_work?, required_dates?,
//   existing_customer?, urgency?, requested_next_step?, call_summary }
//   — called by the "Katie" Retell agent's capture_lead tool, built for CB Scaffolding
//     (Chris Byrne). Upserts the caller as a GHL contact in CB Scaffolding's own sub-account,
//     tags them, files the structured details into custom fields, drops them into the
//     "CB Scaffolding" pipeline at New Enquiry, and logs a note — same pattern as
//     western-renewables-lead.js.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (same trust boundary as
// the other Aoife/Sarah/Katie tool endpoints).
//
// Always responds 200 with a `message` field, even on failure — handed straight to the LLM
// mid-call, so a raw error status/JSON would surface as confusing text to a live caller.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'pQ4bVEhM0JgZwr3bkHJf'; // CB Scaffolding (Chris Byrne)
const PIPELINE_ID = '3JB4J9LzfzBKfvRuwak9';
const STAGE_NEW_ENQUIRY = '5ee7e69c-ae5c-4b14-9435-6b73fdc48ba7';

const FLD_ENQUIRY = 'ZnW2y7zHrp4ZL5YLLJQD';
const FLD_LOCATION = 'EzYs5Y3AC23eH0acNJ2b';
const FLD_PROPERTY_TYPE = 'INf9ALgHrYoYb8eOrcUh';
const FLD_STOREYS = '0M0XQKCfqUJi8trYcFjV';
const FLD_SCOPE = 'EXcTi5qN2i7kqsQYawda';
const FLD_DATES = '8VK9zr6BZItHYQFGMayT';
const FLD_EXISTING = 'wuMaM68nwdXkFVfizsr7';
const FLD_PRIORITY = 's0HW9d94SyDy8AzdycC2';
const FLD_NEXTSTEP = '7YmF3EapKsZdrP21N3v3';
const FLD_SUMMARY = 'P20LfqQ5m2yOjUWDLACZ';

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
  if (type === 'scaffolding') tags.push('scaffolding');
  if (type === 'plant hire') tags.push('plant hire');
  const roc = (residential_or_commercial || '').toLowerCase();
  if (roc === 'commercial') tags.push('commercial');
  if (roc === 'residential') tags.push('residential');
  if (/site visit/i.test(requested_next_step || '')) tags.push('site visit required');
  return tags;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    console.error('cb-scaffolding-lead: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const pit = process.env.GHL_PIT_CB_SCAFFOLDING;
  if (!pit) {
    console.error('cb-scaffolding-lead: GHL_PIT_CB_SCAFFOLDING not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  // Retell wraps function args as { name, call, args } by default — unwrap either shape.
  const params = req.body?.args || req.body || {};
  const {
    name, email, enquiry_type, residential_or_commercial,
    site_location, property_type, storeys, scope_of_work, required_dates,
    existing_customer, urgency, requested_next_step, call_summary,
  } = params;
  let phone = params.phone;

  // A truthy check alone lets an obviously-incomplete number through — seen live: "778" (a
  // caller cut off mid-number) passed this check and got saved as a real contact phone number.
  // Require enough digits to plausibly be a real number before accepting it. If what the caller
  // gave doesn't clear that bar, fall back to the call's own caller ID (Twilio always has this,
  // regardless of what got transcribed) rather than losing the lead outright.
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 7) {
    const callerId = req.body?.call?.from_number;
    if (callerId && callerId.replace(/\D/g, '').length >= 7) {
      phone = callerId;
    } else {
      return res.status(200).json({ ok: false, message: 'That number sounded incomplete — ask the caller to repeat their full callback number before saving their details.' });
    }
  }

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
      source: 'CB Scaffolding — AI Receptionist (Katie)',
      tags: computeTags({ enquiry_type, residential_or_commercial, requested_next_step }),
      customFields: [
        ...(enquiry_type ? [{ id: FLD_ENQUIRY, field_value: enquiry_type }] : []),
        ...(site_location ? [{ id: FLD_LOCATION, field_value: site_location }] : []),
        ...(property_type ? [{ id: FLD_PROPERTY_TYPE, field_value: property_type }] : []),
        ...(storeys ? [{ id: FLD_STOREYS, field_value: String(storeys) }] : []),
        ...(scope_of_work ? [{ id: FLD_SCOPE, field_value: scope_of_work }] : []),
        ...(required_dates ? [{ id: FLD_DATES, field_value: required_dates }] : []),
        ...(existing_customer != null ? [{ id: FLD_EXISTING, field_value: existing_customer ? 'Yes' : 'No' }] : []),
        ...(call_summary ? [{ id: FLD_SUMMARY, field_value: call_summary }] : []),
        ...(urgency ? [{ id: FLD_PRIORITY, field_value: urgency }] : []),
        ...(requested_next_step ? [{ id: FLD_NEXTSTEP, field_value: requested_next_step }] : []),
      ],
    }, pit);

    if (!upsert.ok) {
      console.error('cb-scaffolding-lead: GHL upsert failed', upsert.status, JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }
    const contactId = upsert.data?.contact?.id;
    if (!contactId) {
      console.error('cb-scaffolding-lead: GHL upsert returned no contact id', JSON.stringify(upsert.data));
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
      source: 'CB Scaffolding — AI Receptionist (Katie)',
    }, pit);

    if (call_summary) {
      await ghl('POST', `/contacts/${contactId}/notes`, {
        body: `AI Call Summary: ${call_summary}`,
      }, pit);
    }

    return res.status(200).json({ ok: true, contactId, message: 'Got it, that\'s all noted down — the team will follow up.' });
  } catch (err) {
    console.error('cb-scaffolding-lead error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }
};
