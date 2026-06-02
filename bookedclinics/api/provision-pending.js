// One-shot: provisions clients.json entries that have _provision data but no locationId
// DELETE this file after use
const GHL_API     = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const CLIENTS     = require('../config/clients.json');

async function ghl(method, path, body, token) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GHL ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const secret = req.query.secret;
  if (secret !== 'bc2026') return res.status(401).json({ error: 'unauthorized' });

  const AGENCY_PIT = process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';
  const COMPANY_ID = process.env.GHL_COMPANY_ID || 'MSYotuf1a5FAsGdPRMfP';

  const pending = CLIENTS.filter(c => !c.locationId && c._provision);
  if (!pending.length) return res.status(200).json({ message: 'No pending clients', results: [] });

  const results = await Promise.allSettled(pending.map(async bc => {
    const p = bc._provision;

    // Create sub-account
    const locData = await ghl('POST', '/locations/', {
      name: bc.biz.split('·')[0].trim(),
      companyId: COMPANY_ID,
      email: bc.stripeId ? `${bc.key}@bookedclinics.ca` : p.email,
      phone: p.phone,
      website: p.website || '',
      city: p.city,
      state: p.state,
      postalCode: p.zip,
      country: 'US',
      timezone: p.timezone,
      settings: { allowDuplicateContact: false, allowDuplicateOpportunity: false },
    }, AGENCY_PIT);

    const locationId = locData?.location?.id;
    if (!locationId) throw new Error(`No locationId in response: ${JSON.stringify(locData).slice(0,200)}`);

    // Create contact in the new sub-account
    const [firstName, ...rest] = bc.name.split(' ');
    const contactData = await ghl('POST', '/contacts/', {
      locationId,
      firstName,
      lastName: rest.join(' '),
      name: bc.name,
      email: bc.stripeId ? (bc.key === 'sarah' ? 'sarahpurdy@todaytelemedicine.com' : 'sma@rtbspa.com') : '',
      phone: p.phone,
      companyName: bc.biz.split('·')[0].trim(),
      website: p.website || '',
      city: p.city,
      state: p.state,
      postalCode: p.zip,
      country: 'US',
      tags: ['bookedclinics-client'],
      source: 'BookedClinics Onboarding',
    }, AGENCY_PIT);

    const contactId = contactData?.contact?.id;
    return { key: bc.key, name: bc.name, locationId, contactId };
  }));

  const output = results.map((r, i) => ({
    key: pending[i].key,
    name: pending[i].name,
    status: r.status,
    ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
  }));

  return res.status(200).json({ results: output });
};
