// Returns recent leads for a specific client from GHL.
// Usage: /api/recent-leads?client=terri&limit=10
const CLIENTS = require('../config/clients.json');

const GHL_API     = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

async function ghlFetch(path, pit) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const clientKey = req.query?.client;
  if (!clientKey) return res.status(400).json({ error: 'Provide ?client= key (e.g. terri, frank, sarah)' });

  const client = CLIENTS.find(c => c.key === clientKey.toLowerCase());
  if (!client) return res.status(404).json({ error: `Client "${clientKey}" not found` });
  if (!client.locationId) return res.status(400).json({ error: `No GHL locationId for ${clientKey}` });

  const pit = process.env[client.pitEnv];
  if (!pit) return res.status(400).json({ error: `No GHL token configured for ${clientKey}` });

  const limit = Math.min(parseInt(req.query?.limit || '20'), 100);

  const data = await ghlFetch(
    `/opportunities/search?location_id=${client.locationId}&limit=${limit}`,
    pit
  );

  if (!data) return res.status(500).json({ error: 'GHL fetch failed' });

  const opps = (data.opportunities || [])
    .sort((a, b) => new Date(b.dateAdded || b.createdAt) - new Date(a.dateAdded || a.createdAt))
    .map(o => ({
      name:       o.contact?.name || 'Unknown',
      phone:      o.contact?.phone || null,
      stage:      o.pipelineStageName || null,
      status:     o.status,
      dateAdded:  o.dateAdded || o.createdAt || null,
      lastUpdate: o.lastStageChangeAt || null,
      source:     o.source || null,
    }));

  const lastLead = opps[0] || null;

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    client: client.key,
    name: client.biz,
    totalInCRM: opps.length,
    lastLeadDate: lastLead?.dateAdded || null,
    lastLeadName: lastLead?.name || null,
    recentLeads: opps.slice(0, limit),
  });
};
