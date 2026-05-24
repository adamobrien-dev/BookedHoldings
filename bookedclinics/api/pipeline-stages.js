// GET /api/pipeline-stages — temporary, delete after use
// Lists all pipelines and stages for the agency location

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';

  async function tryPath(path) {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    const text = await r.text();
    return { path, status: r.status, body: text.slice(0, 1000) };
  }

  const attempts = await Promise.all([
    tryPath(`/opportunities/pipelines?locationId=${AGENCY_LOC}`),
    tryPath(`/pipelines/?locationId=${AGENCY_LOC}`),
    tryPath(`/opportunities/pipeline?locationId=${AGENCY_LOC}`),
    tryPath(`/pipelines/all?locationId=${AGENCY_LOC}`),
  ]);

  res.status(200).json(attempts);
};
