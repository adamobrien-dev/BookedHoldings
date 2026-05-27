const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

async function ghl(path, pit) {
  const r = await fetch(`${GHL_API}${path}`, {
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
  });
  if (!r.ok) return { ok: false, status: r.status, data: await r.json().catch(() => null) };
  return { ok: true, data: await r.json() };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';
  const contactId = req.query.contactId || null;
  const limit = parseInt(req.query.limit) || 20;

  // Fetch conversations — optionally filtered to a specific contact
  const qs = contactId
    ? `?locationId=${AGENCY_LOC}&contactId=${contactId}&limit=${limit}`
    : `?locationId=${AGENCY_LOC}&limit=${limit}&unreadOnly=false`;

  const { ok, status, data } = await ghl(`/conversations/search${qs}`, pit);

  if (!ok) return res.status(502).json({ error: 'GHL error', status, detail: data });

  const convos = data?.conversations || [];

  const result = convos.map(c => ({
    id:           c.id,
    contactId:    c.contactId,
    contactName:  c.fullName || c.contactName || null,
    contactPhone: c.phone || null,
    contactEmail: c.email || null,
    lastMessage:  c.lastMessageBody || null,
    lastMessageAt: c.lastMessageDate || null,
    unreadCount:  c.unreadCount || 0,
    type:         c.type || null,
  }));

  res.status(200).json({
    total: result.length,
    conversations: result,
  });
};
