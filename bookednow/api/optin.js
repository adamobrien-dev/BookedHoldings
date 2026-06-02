// POST /api/optin — receives opt-in form submission and creates a GHL contact
const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Location map: slug → { locationId, pitEnv, businessName, phone, tagPrefix }
const LOCATIONS = {
  'paradise-healing': {
    locationId: '0U66FTyg5WJhqyyzIbqM',
    pitEnv:     'GHL_PIT_ALLAPHIA',
    businessName: 'Paradise Healing LLC',
    phone:      '',
    tags:       ['opt-in', 'paradise-healing', 'website-lead'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, firstName, lastName, email, phone, consent } = req.body || {};

  if (!slug || !firstName || !phone || consent !== 'yes') {
    return res.status(400).json({ error: 'Missing required fields or consent not given' });
  }

  const loc = LOCATIONS[slug];
  if (!loc) return res.status(400).json({ error: 'Unknown form' });

  const pit = process.env[loc.pitEnv] || process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';

  try {
    const ghlRes = await fetch(`${GHL_API}/contacts/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: loc.locationId,
        firstName,
        lastName: lastName || '',
        email: email || undefined,
        phone,
        tags: loc.tags,
        source: 'Website Opt-In Form',
        customFields: [
          { key: 'sms_consent', field_value: 'yes' },
          { key: 'sms_consent_date', field_value: new Date().toISOString() },
          { key: 'sms_consent_ip', field_value: req.headers['x-forwarded-for'] || 'unknown' },
        ],
      }),
    });

    if (!ghlRes.ok) {
      const text = await ghlRes.text();
      console.error('GHL error:', ghlRes.status, text);
      // Still return success to the user — don't expose GHL errors
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Optin handler error:', err);
    return res.status(500).json({ error: 'Submission failed, please try again.' });
  }
};
