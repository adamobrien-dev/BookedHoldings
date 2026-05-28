// Receives GHL webhook when a new RTB Spa lead is created.
// Validates the contact has a phone number, then fires a Bland.ai outbound call.
//
// Required env vars:
//   BLAND_API_KEY         — Bland.ai API key
//   RTB_FROM_NUMBER       — Bland.ai phone number to call from (e.g. +17135550000)
//   RTB_WEBHOOK_SECRET    — Optional: shared secret GHL sends in X-GHL-Secret header
//   VERCEL_URL or APP_URL — Public base URL of this deployment (for tool callbacks)

const BLAND_API = 'https://api.bland.ai/v1';
const GHL_API   = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Filled in once RTB sub-account is in GHL
const RTB_LOCATION_ID  = process.env.RTB_LOCATION_ID  || 'FILL_IN_RTB_LOCATION_ID';
const RTB_PIT          = process.env.RTB_PIT           || 'FILL_IN_RTB_PIT';
const RTB_CALENDAR_ID  = process.env.RTB_CALENDAR_ID   || 'FILL_IN_RTB_CALENDAR_ID';

function baseUrl() {
  const url = process.env.APP_URL || process.env.VERCEL_URL;
  if (!url) return 'https://bookedclinics.vercel.app';
  return url.startsWith('http') ? url : `https://${url}`;
}

async function tagContact(contactId, tag) {
  await fetch(`${GHL_API}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RTB_PIT}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tags: [tag] }),
  });
}

async function addNote(contactId, body) {
  await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RTB_PIT}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
}

const BLAND_TASK = `You are Maya, a friendly and warm wellness coordinator calling on behalf of RTB Spa, a boutique wellness studio in West Houston.

Your goal is to welcome the lead, understand what brought them to RTB Spa, and book them for their first appointment.

## Your tone
Warm, calm, unhurried. You are not pushy — you are a helpful guide. Speak naturally, not like a script.

## RTB Spa overview (share naturally based on what the lead wants)
- Location: Energy Corridor, 14511 Old Katy Road Suite 232, Houston TX 77079
- Owner: Stephanie Alvarenga, Licensed Massage Therapist with nearly 10 years of experience
- Hours: Mon–Fri 10am–7pm, Sat 10am–4pm (by appointment)
- Services:
  • Therapeutic massage (Swedish, deep tissue, cupping, hot stone, lymphatic drainage)
  • Face, scalp & jaw tension massage (great for people who clench, carry screen tension, or have tight necks)
  • Non-invasive body contouring (cavitation, RF, LED laser lipo, BEMS muscle stimulation)
  • Mind-body wellness (meditation massage, healing touch, coaching, hypnosis recordings)
  • Packages and memberships for ongoing care

## Call flow
1. Greet warmly: "Hi, is this [First Name]? Hi! This is Maya calling from RTB Spa in West Houston. You recently reached out and I just wanted to personally follow up — do you have a quick moment?"
2. Confirm interest and find out what they're looking for. Let them talk. Ask: "What made you reach out to us?" or "Is there something specific you've been dealing with — tension, stress, or maybe a body goal?"
3. Match their goal to the right service category. Keep it simple — 1-2 sentences max.
4. Offer to get them booked: "I'd love to get you in with Stephanie. Let me check what's available for you — do mornings or afternoons tend to work better?"
5. Use the check_availability tool to get open slots, then confirm a time with the lead.
6. Use the book_appointment tool to secure their spot. Confirm the booking aloud.
7. Wrap up: "Perfect — you're all set! Stephanie is going to love working with you. You'll get a confirmation shortly. Is there anything else before I let you go?"

## Rules
- Never pressure. If they say they need to think about it, say that's totally fine and offer to send info via text.
- If they don't answer or say it's a bad time, apologize and say you'll try again later.
- Never make up availability — always use the check_availability tool first.
- If the booking tool fails, take their preferred time as a note and tell them Stephanie will confirm shortly.
- Keep the call under 5 minutes.`;

const BLAND_TOOLS = (appBase, contactId) => [
  {
    name: 'check_availability',
    description: 'Check available appointment slots at RTB Spa for the given date preference.',
    input_schema: {
      type: 'object',
      properties: {
        preference: {
          type: 'string',
          description: 'Day/time preference the lead mentioned, e.g. "Tuesday morning" or "this weekend"',
        },
      },
      required: ['preference'],
    },
    speech: 'Let me check what Stephanie has open for you.',
    url: `${appBase}/api/ai-caller/rtb-tools`,
    method: 'POST',
    headers: { 'x-tool-action': 'check_availability', 'x-contact-id': contactId },
    body: { preference: '{{preference}}' },
    response: { slots: '{{slots}}' },
    timeout: 10000,
  },
  {
    name: 'book_appointment',
    description: 'Book the appointment for the lead at RTB Spa.',
    input_schema: {
      type: 'object',
      properties: {
        slot_id: {
          type: 'string',
          description: 'The slot ID returned by check_availability',
        },
        service_interest: {
          type: 'string',
          description: 'What the lead is coming in for, e.g. "therapeutic massage" or "body contouring"',
        },
      },
      required: ['slot_id', 'service_interest'],
    },
    speech: 'Booking that for you now.',
    url: `${appBase}/api/ai-caller/rtb-tools`,
    method: 'POST',
    headers: { 'x-tool-action': 'book_appointment', 'x-contact-id': contactId },
    body: { slot_id: '{{slot_id}}', service_interest: '{{service_interest}}' },
    response: { confirmation: '{{confirmation}}' },
    timeout: 15000,
  },
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Optional webhook secret validation
  const secret = process.env.RTB_WEBHOOK_SECRET;
  if (secret && req.headers['x-ghl-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};

  // GHL sends contact data in the webhook payload
  const contact = body.contact || body;
  const phone    = contact.phone || contact.mobilePhone || contact.phone_raw;
  const firstName = contact.firstName || contact.first_name || 'there';
  const contactId = contact.id || contact.contactId;
  const email    = contact.email;

  if (!phone) {
    return res.status(400).json({ error: 'No phone number in payload' });
  }

  // Normalize phone to E.164
  const e164 = phone.replace(/\D/g, '').replace(/^1?(\d{10})$/, '+1$1');
  if (e164.length < 11) {
    return res.status(400).json({ error: 'Phone number too short to be valid' });
  }

  const appBase = baseUrl();

  const callPayload = {
    phone_number: e164,
    from: process.env.RTB_FROM_NUMBER || null,
    task: BLAND_TASK,
    model: 'enhanced',
    language: 'en',
    voice: 'maya',
    first_sentence: `Hi, is this ${firstName}?`,
    wait_for_greeting: true,
    record: true,
    webhook: `${appBase}/api/ai-caller/rtb-callback`,
    metadata: {
      contact_id: contactId || null,
      email: email || null,
      source: 'rtb-ghl-webhook',
      location_id: RTB_LOCATION_ID,
      calendar_id: RTB_CALENDAR_ID,
    },
    tools: BLAND_TOOLS(appBase, contactId || ''),
  };

  const blandRes = await fetch(`${BLAND_API}/calls`, {
    method: 'POST',
    headers: {
      Authorization: process.env.BLAND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(callPayload),
  });

  const blandData = await blandRes.json();

  if (!blandRes.ok) {
    console.error('Bland.ai error:', blandData);
    return res.status(502).json({ error: 'Bland.ai call failed', detail: blandData });
  }

  // Tag the contact so we know a call was fired
  if (contactId) {
    await tagContact(contactId, 'ai-call-queued');
    await addNote(contactId, `AI call queued via Bland.ai (call_id: ${blandData.call_id}) — Maya will follow up to book an appointment.`);
  }

  return res.status(200).json({ ok: true, call_id: blandData.call_id });
};
