// GET /api/funnel-test
// Attempts to create a funnel for Thompson Chiropractic TEST (9GxPw4DByIEJTuMvpECk)
// Tests multiple GHL API endpoints to find what works.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = '9GxPw4DByIEJTuMvpECk';

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
  return { status: res.status, body: text.slice(0, 800) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const AGENCY_PIT = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';

  const results = {};

  // Try 1: list existing funnels on the location (read — confirms PIT works for this location)
  results.listFunnels = await ghlRequest(
    'GET', `/funnels/?locationId=${LOCATION_ID}`, null, AGENCY_PIT
  );

  // Try 2: create funnel
  results.createFunnel = await ghlRequest(
    'POST', `/funnels/`, {
      locationId: LOCATION_ID,
      name: 'Thompson Chiro — New Patient',
      type: 'funnel',
    }, AGENCY_PIT
  );

  // Try 3: create via websites endpoint
  results.createWebsite = await ghlRequest(
    'POST', `/funnels/website`, {
      locationId: LOCATION_ID,
      name: 'Thompson Chiro — Website',
    }, AGENCY_PIT
  );

  res.status(200).json(results);
};
