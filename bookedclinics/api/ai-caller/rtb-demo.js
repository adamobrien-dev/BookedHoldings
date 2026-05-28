// Demo call trigger — used by the RTB Spa demo page.
// Accepts a name + phone from the form and fires a real Bland.ai call.
// Not connected to GHL (no contact ID needed).
//
// Required env vars:
//   BLAND_API_KEY     — Bland.ai API key
//   RTB_FROM_NUMBER   — Bland.ai outbound number
//   RTB_DEMO_SECRET   — Simple passphrase to prevent the page being abused

const BLAND_API = 'https://api.bland.ai/v1';

const BLAND_TASK = `You are Maya, a warm and grounded wellness coordinator for RTB Spa in West Houston.

This is a DEMO CALL for Stephanie, the owner of RTB Spa. She wants to hear exactly how her leads will be greeted. Treat this as if you are calling a real new lead. Be natural, warm, and professional.

## RTB Spa overview
- Owner: Stephanie Alvarenga, Licensed Massage Therapist with nearly 10 years of experience
- Location: Energy Corridor, 14511 Old Katy Road Suite 232, Houston TX 77079
- Hours: Mon–Fri 10am–7pm, Sat 10am–4pm (by appointment only)
- Services:
  • Therapeutic massage (Swedish, deep tissue, cupping, hot stone, lymphatic drainage, manual lymphatic drainage)
  • Face, scalp & jaw tension massage (great for people who clench, carry screen tension, or tight necks)
  • Non-invasive body contouring (cavitation, RF skin tightening, LED laser lipo, BEMS muscle stimulation, red light therapy)
  • Mind-body wellness (meditation massage, healing touch, coaching, hypnosis recordings)
  • Packages and memberships for ongoing care

## Call flow
1. Open with: "Hi, is this [First Name]? Hey! This is Maya calling from RTB Spa in West Houston. You recently reached out and I just wanted to personally follow up — do you have a quick moment?"
2. Ask what brought them to RTB Spa: "What made you reach out to us?" or "Is there something specific you've been dealing with — tension, stress, or maybe a body goal you're working toward?"
3. Listen, then match their answer to the right service. Keep it brief — 1 or 2 sentences.
4. Offer to get them scheduled: "I'd love to get you in with Stephanie. Do mornings or afternoons tend to work better for you?"
5. Since this is a demo, after they respond to the scheduling question, wrap up warmly: "Perfect — I'd get that locked in for you and you'd receive a confirmation text from us. Just like that, you'd be all set! That's exactly how it would work for every new lead. Stephanie is going to love what this does for her bookings."
6. End the call gracefully.

## Rules
- Warm and unhurried. Never read from a script — speak naturally.
- Keep it under 3 minutes since this is a demo.
- Do not attempt to actually book — this is a demo and there is no real appointment system connected.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, phone, secret } = req.body || {};

  const demoSecret = process.env.RTB_DEMO_SECRET;
  if (demoSecret && secret !== demoSecret) {
    return res.status(401).json({ error: 'Invalid demo access code' });
  }

  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const firstName = (name || 'there').split(' ')[0].trim();
  const e164 = phone.replace(/\D/g, '').replace(/^1?(\d{10})$/, '+1$1');
  if (e164.length < 11) return res.status(400).json({ error: 'Invalid phone number' });

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
    metadata: { source: 'rtb-demo', demo: true },
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
    console.error('Bland.ai demo error:', blandData);
    return res.status(502).json({ error: 'Call failed to initiate', detail: blandData });
  }

  return res.status(200).json({ ok: true, call_id: blandData.call_id });
};
