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
  {
    key: 'sandy',
    name: 'Sandy Sullivan',
    biz: 'My Adult Primary Care and Pain Management',
    niche: 'StemWave / Primary Care · Fayetteville, TN',
    locationId: 'M8E6rSDwYijkpGWK1AWR',
    pitEnv: 'GHL_PIT_SANDY',
    stripeId: null,
    status: 'setup',
  },
];

const FLETCHER_STRIPE_ID = 'cus_UVQcb88jp1OQqD';

const BILLING_CONFIG = [
  { key: 'fletcher', name: 'Fletcher Munksgard', biz: 'Dane Functional Health · GLP-1, Functional Medicine', stripeId: FLETCHER_STRIPE_ID, deal: 'Flat $500/mo', dealSub: 'No onboarding fee', cycleDays: 30, retainerAmount: 500 },
  { key: 'aguilera', name: 'Frank Aguilera', biz: 'Aguilera Health & Wellness · Chiropractic · Bakersfield, CA', stripeId: 'cus_UTCCPxtx3eoza7', deal: 'Flat $500/mo', dealSub: 'Onboarding waived', cycleDays: 30, retainerAmount: 500 },
  { key: 'terri', name: 'Terri Mignot', biz: 'Get Body Sculpted · Body Contouring · Tucker, GA', stripeId: 'cus_UR9Pr9Dxonz3SN', deal: '$1k setup + $500/mo', dealSub: '3 × $333 installments', cycleDays: 30, retainerAmount: 500, installments: { total: 3, amount: 333 } },
  { key: 'allaphia', name: 'Allaphia Richards', biz: 'Paradise Healing LLC · Boston, MA', stripeId: 'cus_UOulmSIDAPiGuI', deal: '$1k setup + $500/mo', dealSub: 'Setup fully paid', cycleDays: 30, retainerAmount: 500 },
  { key: 'thania', name: 'Thania Ramirez', biz: 'Tiali Beauty Lounge · Med-Spa · Warwick, RI', stripeId: 'cus_UMJQDHYQPyci1p', deal: '$500 setup + 10% rev', dealSub: 'Performance only', cycleDays: 30, retainerAmount: null, installments: { total: 3, amount: 167 } },
];

const STALE_CONTRACTS = [
  { name: 'Doyinsola Abikoye', biz: 'No business name on file', sentDate: '2026-04-17' },
  { name: 'Emily Anderson', biz: 'Renew Chiropractic', sentDate: '2026-04-18' },
  { name: 'Brittany Baumer', biz: 'The Skin & Body Spa', sentDate: '2026-04-21' },
  { name: 'Andre F', biz: 'Clear Cost Telehealth', sentDate: '2026-04-22' },
  { name: 'Nayson Rouhipour', biz: "Glendale's Urgent Care", sentDate: '2026-05-05' },
  { name: 'Nnenna Obioha', biz: 'Marked Lost in GHL but contract was sent after', sentDate: '2026-05-07' },
  { name: 'Yahaira Manon', biz: '2 ad images in Drive folder', sentDate: '2026-05-13' },
];

const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const AGENCY_PIT = 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
const AGENCY_STAGES = {
  DC_UPCOMING:  'd0065956-d245-4c34-8bcd-4414a3a2c408',
  DC_NOSHOW:    'f7a093f3-799e-4c00-826b-886c41199063',
  SC_UPCOMING:  '8216ee1d-73eb-4a3e-b53b-8b8cf0942256',
};

async function getAgencyData() {
  const oppsData = await ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, AGENCY_PIT);
  const opps = oppsData?.opportunities || [];

  const scOpps       = opps.filter(o => o.pipelineStageId === AGENCY_STAGES.SC_UPCOMING);
  const dcUpcoming   = opps.filter(o => o.pipelineStageId === AGENCY_STAGES.DC_UPCOMING);
  const dcNoShow     = opps.filter(o => o.pipelineStageId === AGENCY_STAGES.DC_NOSHOW);
  const wonOpps      = opps.filter(o => o.status === 'won');
  const lostOpps     = opps.filter(o => o.status === 'lost');
  const names = arr => arr.map(o => o.contact?.name || 'Unknown');

  const now = new Date();
  const scRecovery = await Promise.all(scOpps.map(async o => {
    const apData = await ghlFetch(`/contacts/${o.contact.id}/appointments`, AGENCY_PIT);
    const future = (apData?.events || []).filter(e => {
      const t = new Date(e.startTime || e.endTime);
      return !isNaN(t) && t > now;
    });
    return {
      name: o.contact.name,
      phone: o.contact.phone,
      contactId: o.contact.id,
      hasFutureAppt: future.length > 0,
      nextAppt: future.sort((a, b) => new Date(a.startTime || a.endTime) - new Date(b.startTime || b.endTime))[0]?.startTime || null,
    };
  }));

  return {
    pipeline: {
      scUpcoming: scOpps.length,
      dcUpcoming: dcUpcoming.length,
      dcNoShow: dcNoShow.length,
      won: wonOpps.length,
      lost: lostOpps.length,
      total: opps.filter(o => o.status !== 'lost').length,
      scNames: names(scOpps),
      dcNoShowNames: names(dcNoShow),
      wonNames: names(wonOpps),
    },
    scRecovery: {
      needsRecovery: scRecovery.filter(r => !r.hasFutureAppt),
      confirmed: scRecovery.filter(r => r.hasFutureAppt),
    },
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

  // Build per-client last payment + failed flag from the same payment list
  const stripeIdToKey = { [FLETCHER_STRIPE_ID]: 'fletcher' };
  CLIENTS.forEach(c => { if (c.stripeId) stripeIdToKey[c.stripeId] = c.key; });

  const perClient = {};
  for (const p of payments) {
    const clientKey = stripeIdToKey[p.customer];
    if (!clientKey) continue;
    if (!perClient[clientKey]) perClient[clientKey] = { lastSucceeded: null, succeededCount: 0, hasFailed: false };
    if (p.status === 'succeeded') {
      perClient[clientKey].succeededCount++;
      if (!perClient[clientKey].lastSucceeded || p.created > perClient[clientKey].lastSucceeded.created) {
        perClient[clientKey].lastSucceeded = { amountCents: p.amount, created: p.created };
      }
    }
    if (p.status === 'requires_payment_method') {
      perClient[clientKey].hasFailed = true;
    }
  }

  return {
    balanceCents: balance?.available?.find(b => b.currency === 'usd')?.amount ?? 0,
    collectedCents,
    failed,
    fletcherFailed,
    perClient,
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

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [clientsData, stripeData, paypalData, agencyData] = await Promise.all([
      Promise.all(CLIENTS.map(getClientData)),
      getStripeData(),
      getPaypalData(),
      getAgencyData(),
    ]);
    const scRecovery = agencyData?.scRecovery ?? null;

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
        billingRows: (() => {
          const spc = stripeData?.perClient || {};
          return BILLING_CONFIG.map(bc => {
            const stripe = spc[bc.key] || null;
            const cd = clientsData.find(c => c.key === bc.key);
            let lastPaidAmountCents = null, lastPaidDate = null, nextDueDate = null, paymentStatus = 'none';
            if (stripe?.lastSucceeded) {
              lastPaidAmountCents = stripe.lastSucceeded.amountCents;
              lastPaidDate = new Date(stripe.lastSucceeded.created * 1000).toISOString();
              nextDueDate = bc.cycleDays
                ? new Date((stripe.lastSucceeded.created + bc.cycleDays * 24 * 3600) * 1000).toISOString()
                : null;
              paymentStatus = stripe.hasFailed ? 'warn' : 'ok';
            } else if (stripe?.hasFailed) {
              paymentStatus = 'failed';
            }
            let statusLabel = 'Active', statusClass = 'pill-green';
            if (paymentStatus === 'failed') { statusLabel = 'Needs Action'; statusClass = 'pill-red'; }
            else if (cd?.workflows?.fast5 === 'LIVE') { statusLabel = 'Ads Live'; statusClass = 'pill-blue'; }
            else if (cd?.status === 'setup' || cd?.status === 'pending') { statusLabel = 'Setting Up'; statusClass = 'pill-yellow'; }
            // Installment progress: count succeeded payments against total installments
            let installmentPaid = null, installmentTotal = null;
            if (bc.installments && stripe?.succeededCount) {
              installmentPaid  = Math.min(stripe.succeededCount, bc.installments.total);
              installmentTotal = bc.installments.total;
            }
            return { key: bc.key, name: bc.name, biz: bc.biz, deal: bc.deal, dealSub: bc.dealSub, retainerAmount: bc.retainerAmount, lastPaidAmountCents, lastPaidDate, nextDueDate, paymentStatus, statusLabel, statusClass, installmentPaid, installmentTotal };
          });
        })(),
        staleContracts: (() => {
          const todayMs = new Date().setHours(0, 0, 0, 0);
          return STALE_CONTRACTS.map(sc => ({
            ...sc,
            daysSinceSent: Math.floor((todayMs - new Date(sc.sentDate).setHours(0, 0, 0, 0)) / 86400000),
          }));
        })(),
        agencyPipeline: agencyData?.pipeline ?? null,
      },
      clients: clientsData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
