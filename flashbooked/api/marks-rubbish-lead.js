// POST /api/marks-rubbish-lead  { name, phone, email?, enquiry_type?, collection_address?,
//   items_description?, existing_customer?, urgency?, requested_next_step?, call_summary }
//   — called by the Marks Rubbish Removal Retell agent's capture_lead tool. Upserts the caller
//     as a GHL contact in Marks Rubbish Removal's own sub-account, tags them, files the
//     structured details into custom fields, drops them into the pipeline at New Enquiry, and
//     logs a note — mirrors flashbooked/api/western-renewables-lead.js's pattern.
//
// Auth: header x-webhook-secret must match FLASHBOOKED_LEAD_SECRET (same trust boundary as the
// other Aoife/Sarah/Katie tool endpoints).
//
// Always responds 200 with a `message` field, even on failure — handed straight to the LLM
// mid-call, so a raw error status/JSON would surface as confusing text to a live caller.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = '1cNEhtryf6dC0hp5NULz'; // Marks Rubbish Removal
const PIPELINE_ID = 'n4JM1my7tMK9qTvhtmwp';
const STAGE_NEW_ENQUIRY = 'b930efad-2561-4f30-978e-30e9393556cd';

const FLD_ENQUIRY = '7VLjBdWCI5CX1O2f7xvn';
const FLD_ADDRESS = 'F2jhzKHfy73vdCLLiFS2';
const FLD_ITEMS = 'Ml6rPd09IwuOhgqsh2gA';
const FLD_EXISTING = 'ckcUIJeAZEI739j1l74Q';
const FLD_SUMMARY = 'SF3xJ8zCyPkmNqwGBwh5';
const FLD_PRIORITY = 'FKbOJ0v2UI6Emq0s5iRw';
const FLD_NEXTSTEP = 'YuNMDY9o3KvEewuODaOm';

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

function computeTags({ enquiry_type, requested_next_step }) {
  const tags = ['ai handled'];
  const type = (enquiry_type || '').toLowerCase();
  if (type) tags.push(type.replace(/[^a-z0-9]+/g, '-'));
  if (/quote|survey/i.test(requested_next_step || '')) tags.push('quote required');
  return tags;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.FLASHBOOKED_LEAD_SECRET || secret !== process.env.FLASHBOOKED_LEAD_SECRET) {
    console.error('marks-rubbish-lead: unauthorized');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  const pit = process.env.GHL_PIT_MARKS_RUBBISH;
  if (!pit) {
    console.error('marks-rubbish-lead: GHL_PIT_MARKS_RUBBISH not configured');
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }

  // Retell wraps function args as { name, call, args } by default — unwrap either shape defensively.
  const params = req.body?.args || req.body || {};
  const {
    name, email, enquiry_type, collection_address,
    items_description, existing_customer, urgency,
    requested_next_step, call_summary,
  } = params;
  let phone = params.phone;

  // A truthy check alone lets an obviously-incomplete number through — a caller cut off
  // mid-number can pass and get saved as a real contact phone number. Require enough digits to
  // plausibly be a real number; fall back to the call's own caller ID (Twilio always has this,
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
      source: 'Marks Rubbish Removal — AI Receptionist',
      tags: computeTags({ enquiry_type, requested_next_step }),
      customFields: [
        ...(enquiry_type ? [{ id: FLD_ENQUIRY, field_value: enquiry_type }] : []),
        ...(collection_address ? [{ id: FLD_ADDRESS, field_value: collection_address }] : []),
        ...(items_description ? [{ id: FLD_ITEMS, field_value: items_description }] : []),
        ...(existing_customer != null ? [{ id: FLD_EXISTING, field_value: existing_customer ? 'Yes' : 'No' }] : []),
        ...(call_summary ? [{ id: FLD_SUMMARY, field_value: call_summary }] : []),
        ...(urgency ? [{ id: FLD_PRIORITY, field_value: urgency }] : []),
        ...(requested_next_step ? [{ id: FLD_NEXTSTEP, field_value: requested_next_step }] : []),
      ],
    }, pit);

    if (!upsert.ok) {
      console.error('marks-rubbish-lead: GHL upsert failed', upsert.status, JSON.stringify(upsert.data));
      return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
    }
    const contactId = upsert.data?.contact?.id;
    if (!contactId) {
      console.error('marks-rubbish-lead: GHL upsert returned no contact id', JSON.stringify(upsert.data));
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
      source: 'Marks Rubbish Removal — AI Receptionist',
    }, pit);

    if (call_summary) {
      await ghl('POST', `/contacts/${contactId}/notes`, {
        body: `AI Call Summary: ${call_summary}`,
      }, pit);
    }

    return res.status(200).json({ ok: true, contactId, message: 'Got it, that\'s all noted down — the team will follow up.' });
  } catch (err) {
    console.error('marks-rubbish-lead error', err.message);
    return res.status(200).json({ ok: false, message: FALLBACK_MESSAGE });
  }
};
