// GET /api/ghl-info
// Returns agency identity info from GHL using the agency PIT.
// Used to discover companyId, locationId, and confirm the PIT is working.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
  if (!pit) return res.status(500).json({ error: 'GHL_PIT_AGENCY not set' });

  async function ghl(path) {
    const r = await fetch(`https://services.leadconnectorhq.com${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: '2021-07-28' },
    });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 500) };
  }

  const [identity, location] = await Promise.all([
    ghl('/oauth/installedLocations'),
    ghl('/locations/NKpzhLv8iNQ0c9Ge3QAR'),
  ]);

  res.status(200).json({ identity, location });
};
