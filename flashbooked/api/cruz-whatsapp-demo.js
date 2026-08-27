// POST /api/cruz-whatsapp-demo — Twilio WhatsApp inbound webhook.
//   Demo for Sean (Cruz Detailing, Kildare/Dublin mobile car detailing) ahead of his discovery
//   call: texts an instant quote back based on service + vehicle size keywords in the message.
//   Pricing below is placeholder/generic (Sean hasn't shared real numbers yet) — swap PRICING
//   for his actual rates once known, the matching logic doesn't need to change.
//
// Point a Twilio WhatsApp Sandbox (or a real WhatsApp sender once provisioned) "when a message
// comes in" webhook at this URL. Twilio posts form-encoded { Body, From, To, ... }.

const PRICING = {
  'deep clean': { small: 70, medium: 90, large: 120 },
  'single stage detail': { small: 140, medium: 170, large: 210 },
  'new car protection': { small: 190, medium: 230, large: 280 },
  'ceramic coating': { small: 320, medium: 380, large: 450 },
};

const SERVICE_ALIASES = [
  { key: 'ceramic coating', patterns: ['ceramic', 'coating'] },
  { key: 'new car protection', patterns: ['new car', 'protection', 'ppf'] },
  { key: 'single stage detail', patterns: ['single stage', 'full detail', 'detailing', 'detail'] },
  { key: 'deep clean', patterns: ['deep clean', 'valet', 'clean'] },
  { key: 'maintenance plan', patterns: ['maintenance', 'plan', 'subscription'] },
  { key: 'commercial', patterns: ['commercial', 'fleet', 'van fleet'] },
];

const SIZE_ALIASES = [
  { key: 'small', patterns: ['small', 'hatchback', 'mini', 'compact'] },
  { key: 'medium', patterns: ['medium', 'saloon', 'estate', 'sedan'] },
  { key: 'large', patterns: ['large', 'suv', '4x4', 'jeep', 'van', 'crossover'] },
];

function matchOne(text, aliases) {
  for (const { key, patterns } of aliases) {
    if (patterns.some((p) => text.includes(p))) return key;
  }
  return null;
}

function reply(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

const MENU = `Hi, thanks for reaching out to Cruz Detailing! 🚗\n\nJust tell me the service + your vehicle size and I'll quote you straight away, e.g. "deep clean for my hatchback" or "ceramic coating, SUV".\n\nServices: Deep Clean, Single Stage Detail, New Car Protection, Ceramic Coating, Maintenance Plan, Commercial/Fleet.`;

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');

  if (req.method !== 'POST') {
    return res.status(200).send(reply(MENU));
  }

  const body = (req.body?.Body || '').toString().trim().toLowerCase();
  if (!body) return res.status(200).send(reply(MENU));

  const service = matchOne(body, SERVICE_ALIASES);
  const size = matchOne(body, SIZE_ALIASES);

  if (service === 'maintenance plan') {
    return res.status(200).send(reply(
      `Our Maintenance Plan starts from €50/month depending on how often you'd like us out — let me know your vehicle and preferred frequency and I'll get you an exact price.`
    ));
  }

  if (service === 'commercial') {
    return res.status(200).send(reply(
      `Commercial/fleet work is quoted per vehicle and volume — send over how many vehicles and what type, and we'll get a custom quote back to you shortly.`
    ));
  }

  if (service && size) {
    const price = PRICING[service][size];
    return res.status(200).send(reply(
      `${service[0].toUpperCase()}${service.slice(1)} for a ${size} vehicle is approx. €${price} (final price confirmed on arrival based on condition). Want me to book you in?`
    ));
  }

  if (service && !size) {
    return res.status(200).send(reply(
      `Sure — what size is the vehicle? Small (hatchback/mini), Medium (saloon/estate), or Large (SUV/4x4/van)?`
    ));
  }

  if (size && !service) {
    return res.status(200).send(reply(
      `Got it. Which service — Deep Clean, Single Stage Detail, New Car Protection, or Ceramic Coating?`
    ));
  }

  return res.status(200).send(reply(MENU));
};
