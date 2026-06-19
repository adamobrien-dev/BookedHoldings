// Lookup a person across GHL, Stripe, and Dropbox Sign by name or email.
// Usage: /api/client-lookup?name=japa   or  ?email=hello@unwindsoundlounge.com
const CLIENTS_CONFIG = require('../config/clients.json');

const GHL_API     = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC  = 'NKpzhLv8iNQ0c9Ge3QAR';
const AGENCY_PIT  = process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';

async function ghlFetch(path, pit) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function searchGHL(query) {
  const results = [];

  // Search agency location
  const locations = [
    { id: AGENCY_LOC, pit: AGENCY_PIT, label: 'Agency' },
    ...CLIENTS_CONFIG
      .filter(c => c.locationId && c.pitEnv && process.env[c.pitEnv])
      .map(c => ({ id: c.locationId, pit: process.env[c.pitEnv], label: c.biz?.split('·')[0]?.trim() || c.key })),
  ];

  await Promise.all(locations.map(async ({ id, pit, label }) => {
    const data = await ghlFetch(`/contacts/?locationId=${id}&query=${encodeURIComponent(query)}&limit=20`, pit);
    const contacts = data?.contacts || [];
    for (const c of contacts) {
      // Get recent conversations
      const convData = await ghlFetch(`/conversations/search?locationId=${id}&contactId=${c.id}&limit=10`, pit);
      const conversations = convData?.conversations || [];

      // Get opportunities
      const oppData = await ghlFetch(`/opportunities/search?location_id=${id}&contact_id=${c.id}&limit=10`, pit);
      const opps = oppData?.opportunities || [];

      results.push({
        source: label,
        id: c.id,
        name: c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        email: c.email,
        phone: c.phone,
        tags: c.tags || [],
        pipeline: opps.map(o => ({
          name: o.name,
          stage: o.pipelineStageName,
          status: o.status,
          value: o.monetaryValue,
          updatedAt: o.lastStageChangeAt,
        })),
        recentConversations: conversations.slice(0, 5).map(cv => ({
          type: cv.type,
          lastMessage: cv.lastMessageBody,
          lastMessageDate: cv.lastMessageDate,
          unread: cv.unreadCount,
        })),
        createdAt: c.dateAdded,
      });
    }
  }));

  return results;
}

async function searchStripe(query) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { error: 'STRIPE_SECRET_KEY not configured' };

  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');

  // Search customers
  const searchRes = await fetch(
    `https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`name~"${query}" OR email~"${query}"`)}&limit=5`,
    { headers: { Authorization: auth } }
  );

  if (!searchRes.ok) return { error: 'stripe_search_failed' };
  const searchData = await searchRes.json();
  const customers = searchData?.data || [];

  const results = await Promise.all(customers.map(async (cust) => {
    // Get payment intents for this customer
    const piRes = await fetch(
      `https://api.stripe.com/v1/payment_intents?customer=${cust.id}&limit=20`,
      { headers: { Authorization: auth } }
    );
    const pi = piRes.ok ? await piRes.json() : null;
    const payments = pi?.data || [];

    // Get disputes
    const disputeRes = await fetch(
      `https://api.stripe.com/v1/disputes?limit=10`,
      { headers: { Authorization: auth } }
    );
    const disputeData = disputeRes.ok ? await disputeRes.json() : null;
    const disputes = (disputeData?.data || []).filter(d => d.payment_intent &&
      payments.some(p => p.id === d.payment_intent));

    return {
      id: cust.id,
      name: cust.name,
      email: cust.email,
      created: new Date(cust.created * 1000).toISOString(),
      payments: payments.map(p => ({
        id: p.id,
        amount: `$${(p.amount / 100).toFixed(2)}`,
        status: p.status,
        date: new Date(p.created * 1000).toISOString().split('T')[0],
        description: p.description,
      })),
      disputes: disputes.map(d => ({
        id: d.id,
        amount: `$${(d.amount / 100).toFixed(2)}`,
        status: d.status,
        reason: d.reason,
        dueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null,
      })),
    };
  }));

  return results;
}

async function searchDropboxSign(query) {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) return { error: 'DROPBOX_SIGN_API_KEY not configured' };

  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  try {
    const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=100', {
      headers: { Authorization: auth },
    });
    if (!r.ok) return { error: 'dropbox_sign_fetch_failed' };
    const data = await r.json();
    const q = query.toLowerCase();

    return (data?.signature_requests || [])
      .filter(sr => {
        const signerName  = (sr.signatures?.[0]?.signer_name || '').toLowerCase();
        const signerEmail = (sr.signatures?.[0]?.signer_email_address || '').toLowerCase();
        const title       = (sr.title || '').toLowerCase();
        return signerName.includes(q) || signerEmail.includes(q) || title.includes(q);
      })
      .map(sr => ({
        documentId: sr.signature_request_id,
        title: sr.title,
        signerName:  sr.signatures?.[0]?.signer_name,
        signerEmail: sr.signatures?.[0]?.signer_email_address,
        status: sr.is_complete ? 'signed' : sr.is_declined ? 'declined' : 'pending',
        sentAt: new Date(sr.created_at * 1000).toISOString(),
        signedAt: sr.signatures?.[0]?.signed_at
          ? new Date(sr.signatures[0].signed_at * 1000).toISOString()
          : null,
        daysSinceSent: Math.floor((Date.now() - sr.created_at * 1000) / 86400000),
      }));
  } catch {
    return { error: 'dropbox_sign_error' };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const query = req.query?.name || req.query?.email || req.query?.q;
  if (!query) {
    return res.status(400).json({ error: 'Provide ?name=, ?email=, or ?q= query param' });
  }

  const [ghl, stripe, dropboxSign] = await Promise.all([
    searchGHL(query),
    searchStripe(query),
    searchDropboxSign(query),
  ]);

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    query,
    ghl,
    stripe,
    dropboxSign,
  });
};
