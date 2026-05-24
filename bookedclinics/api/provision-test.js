// GET /api/provision-test
// Fires a test sub-account creation for Thompson Chiropractic.
// Delete this file once the test is confirmed working.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const TEST_CLIENT = {
  name: 'Dr. Alex Thompson',
  businessName: 'Thompson Chiropractic TEST',
  email: 'alex@thompsonchiro.test',
  phone: '+15125550100',
  niche: 'Chiropractic',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  website: 'https://thompsonchiro.com',
  timezone: 'America/Chicago',
};

async function ghlRequest(method, path, body, token) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const AGENCY_PIT = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';
  const COMPANY_ID = process.env.GHL_COMPANY_ID || 'MSYotuf1a5FAsGdPRMfP';

  const result = await ghlRequest('POST', '/locations/', {
    name: TEST_CLIENT.businessName,
    companyId: COMPANY_ID,
    email: TEST_CLIENT.email,
    phone: TEST_CLIENT.phone,
    website: TEST_CLIENT.website,
    city: TEST_CLIENT.city,
    state: TEST_CLIENT.state,
    postalCode: TEST_CLIENT.zip,
    country: 'US',
    timezone: TEST_CLIENT.timezone,
    settings: { allowDuplicateContact: false, allowDuplicateOpportunity: false },
  }, AGENCY_PIT);

  res.status(200).json({
    ghlStatus: result.status,
    ghlResponse: JSON.parse(result.body),
  });
};
