const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const CLIENTS = [
  {
    key: 'terri',
    name: 'Terri Mignot',
    biz: 'Get Body Sculpted',
    niche: 'Body Sculpting · Tucker, GA',
    locationId: 'y1yUn5PVAMq0PEAtHdoa',
    pitEnv: 'GHL_PIT_TERRI',
    stripeId: 'cus_UR9Pr9Dxonz3SN',
    status: 'live',
  },
  {
    key: 'allaphia',
    name: 'Allaphia Richards',
    biz: 'Paradise Healing',
    niche: 'Healing & Wellness · Boston, MA',
    locationId: '0U66FTyg5WJhqyyzIbqM',
    pitEnv: 'GHL_PIT_ALLAPHIA',
    stripeId: 'cus_UOulmSIDAPiGuI',
    status: 'live',
  },
  {
    key: 'thania',
    name: 'Thania Ramirez',
    biz: 'Tiali Beauty Lounge',
    niche: 'Med-Spa · Warwick, RI',
    locationId: 'ZbBlLQsUabCGBXdSXcVq',
    pitEnv: 'GHL_PIT_THANIA',
    stripeId: 'cus_UMJQDHYQPyci1p',
    status: 'live',
  },
  {
    key: 'aguilera',
    name: 'Frank Aguilera',
    biz: 'Aguilera Health & Wellness',
    niche: 'Chiropractic · Bakersfield, CA',
    locationId: 'fl8EgJBlFzCy65y6wNyS',
    pitEnv: 'GHL_PIT_AGUILERA',
    stripeId: 'cus_UTCCPxtx3eoza7',
    status: 'setup',
  },
  {
    key: 'glendale',
    name: "Glendale's Urgent Care",
    biz: "Glendale's Urgent Care",
    niche: 'Urgent Care · Glendale, CA',
    locationId: 'DTaKXJaCm5a7xHfXMU2v',
    pitEnv: 'GHL_PIT_GLENDALE',
    stripeId: null,
    status: 'pending',
  },
];

const FLETCHER_STRIPE_ID = 'cus_UVQcb88jp1OQqD';

const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const AGENCY_PIT = 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
const SC_UPCOMING_STAGE = '8216ee1d-73eb-4a3e-b53b-8b8cf0942256';

async function getScRecovery() {
  const oppsData = await ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, AGENCY_PIT);
  const scOpps = (oppsData?.opportunities || []).filter(o => o.pipelineStageId === SC_UPCOMING_STAGE);

  const now = new Date();
  const results = await Promise.all(scOpps.map(async o => {
    const apData = await ghlFetch(`/contacts/${o.contact.id}/appointments`, AGENCY_PIT);
    const future = (apData?.events || []).filter(e => new Date(e.startTime || e.endTime) > now);
    return {
      name: o.contact.name,
      phone: o.contact.phone,
      contactId: o.contact.id,
      hasFutureAppt: future.length > 0,
      nextAppt: future.sort((a, b) => new Date(a.startTime || a.endTime) - new Date(b.startTime || b.endTime))[0]?.startTime || null,
    };
  }));

  return {
    needsRecovery: results.filter(r => !r.hasFutureAppt),
    confirmed: results.filter(r => r.hasFutureAppt),
  };
}

async function ghlFetch(path, pit) {
  try {
    const res = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function classifyStage(stageName = '') {
  const s = stageName.toLowerCase();
  if (s.includes('hot')) return 'hot';
  if (s.includes('book') || s.includes('scheduled') || s.includes('appt')) return 'booked';
  if (s.includes('attend') || s.includes('visit')) return 'attended';
  if (s.includes('sale') || s.includes('won') || s.includes('review')) return 'sale';
  return 'new';
}

async function getClientData(client) {
  const pit = process.env[client.pitEnv];
  if (!pit) return { ...client, leads: null, workflows: null, error: 'missing_pit' };

  const [oppsData, wfData] = await Promise.all([
    ghlFetch(`/opportunities/search?location_id=${client.locationId}&limit=100`, pit),
    ghlFetch(`/workflows/?locationId=${client.locationId}`, pit),
  ]);

  const leads = { new: 0, hot: 0, booked: 0, attended: 0, sale: 0, total: 0 };
  if (oppsData?.opportunities) {
    for (const opp of oppsData.opportunities) {
      leads.total++;
      if (opp.status === 'won') { leads.sale++; continue; }
      if (opp.status === 'lost') { leads.total--; continue; }
      const bucket = classifyStage(opp.pipelineStageName || '');
      leads[bucket]++;
    }
  }

  const WF_MAP = [
    { key: 'fast5', patterns: ['fast 5', 'fast5', 'new lead nurture'] },
    { key: 'confirmation', patterns: ['confirmation', 'reminder'] },
    { key: 'noshow', patterns: ['no show', 'noshow', 'no-show'] },
    { key: 'review', patterns: ['review', 'new sale'] },
    { key: 'nurture', patterns: ['long-term', 'longterm', 'long term'] },
    { key: 'stale', patterns: ['stale', 're-engage', 'reengage'] },
  ];

  const workflows = {};
  if (wfData?.workflows) {
    for (const wf of wfData.workflows) {
      const nameLower = wf.name?.toLowerCase() || '';
      for (const { key, patterns } of WF_MAP) {
        if (patterns.some(p => nameLower.includes(p))) {
          workflows[key] = wf.status === 'published' ? 'LIVE' : 'DRAFT';
        }
      }
    }
  }

  return { ...client, leads, workflows };
}

async function getStripeData() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
  const headers = { Authorization: auth };

  const [balRes, piRes] = await Promise.all([
    fetch('https://api.stripe.com/v1/balance', { headers }),
    fetch('https://api.stripe.com/v1/payment_intents?limit=100', { headers }),
  ]);

  const balance = balRes.ok ? await balRes.json() : null;
  const pi = piRes.ok ? await piRes.json() : null;

  const payments = pi?.data || [];
  const collectedCents = payments
    .filter(p => p.status === 'succeeded')
    .reduce((s, p) => s + p.amount, 0);

  const failed = payments
    .filter(p => p.status === 'requires_payment_method')
    .map(p => ({ id: p.id, amountCents: p.amount, customerId: p.customer }));

  const fletcherFailed = failed.some(p => p.customerId === FLETCHER_STRIPE_ID);

  return {
    balanceCents: balance?.available?.find(b => b.currency === 'usd')?.amount ?? 0,
    collectedCents,
    failed,
    fletcherFailed,
  };
}

async function getPaypalData() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) return null;

  try {
    const tokenRes = await fetch('https://api.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 31);

    const txRes = await fetch(
      `https://api.paypal.com/v1/reporting/transactions?start_date=${start.toISOString().split('.')[0]}Z&end_date=${end.toISOString().split('.')[0]}Z&page_size=100`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!txRes.ok) return null;
    const data = await txRes.json();

    const collectedUSD = (data.transaction_details || [])
      .filter(t =>
        t.transaction_info.transaction_event_code === 'T0006' &&
        t.transaction_info.transaction_status === 'S' &&
        t.transaction_info.transaction_amount.currency_code === 'USD'
      )
      .reduce((s, t) => s + parseFloat(t.transaction_info.transaction_amount.value), 0);

    return { collectedUSD };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [clientsData, stripeData, paypalData, scRecovery] = await Promise.all([
      Promise.all(CLIENTS.map(getClientData)),
      getStripeData(),
      getPaypalData(),
      getScRecovery(),
    ]);

    const totalLeads = clientsData.reduce((s, c) => s + (c.leads?.total || 0), 0);
    const stuckLeads = clientsData.reduce((s, c) => s + (c.leads?.new || 0), 0);
    const stripeCollected = (stripeData?.collectedCents || 0) / 100;
    const paypalCollected = paypalData?.collectedUSD || 0;

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalLeads,
        stuckLeads,
        stuckPct: totalLeads > 0 ? Math.round((stuckLeads / totalLeads) * 100) : 0,
        totalCollected: stripeCollected + paypalCollected,
        stripeBalanceCents: stripeData?.balanceCents ?? null,
        fletcherFailed: stripeData?.fletcherFailed ?? null,
        scRecovery: scRecovery ?? null,
      },
      clients: clientsData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
