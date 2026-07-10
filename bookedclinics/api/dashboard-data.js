const CLIENTS_CONFIG = require('../config/clients.json');

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const CHURNED_STATUSES = ['churned', 'lost'];
const isChurned = c => CHURNED_STATUSES.includes(c.status);

// BookedClinics' own agency sales pipeline (prospects trying to become clients) is a
// completely separate GHL location from client sub-accounts (patient leads). Some
// prospects converted to clients but their agency-pipeline opportunity was never marked
// Won, so they still show up as "needs a sales call" — filter anyone already a client
// (any status, including churned) out of those prospect-recovery lists.
const normalizeName = (n = '') => n.toLowerCase().trim();
const CLIENT_NAMES = new Set(CLIENTS_CONFIG.map(c => normalizeName(c.name)));
const isExistingClient = name => CLIENT_NAMES.has(normalizeName(name));

const CLIENTS = CLIENTS_CONFIG.filter(c => !isChurned(c)).map(c => ({
  key: c.key,
  name: c.name,
  biz: (c.biz || '').split('·')[0].trim(),
  niche: c.niche,
  locationId: c.locationId,
  pitEnv: c.pitEnv,
  stripeId: c.stripeId,
  status: c.status,
}));

const CHURNED_CLIENTS = CLIENTS_CONFIG.filter(isChurned).map(c => ({
  key: c.key,
  name: c.name,
  biz: (c.biz || '').split('·')[0].trim(),
  niche: c.niche,
  status: c.status,
}));

// Keys "get lost every day" — this checks the live runtime (actual Vercel state)
// rather than any local file, since that's the thing that actually drifts.
function getKeysHealth() {
  const required = [
    { env: 'STRIPE_SECRET_KEY', label: 'Stripe' },
    { env: 'PAYPAL_CLIENT_ID', label: 'PayPal client ID' },
    { env: 'PAYPAL_CLIENT_SECRET', label: 'PayPal secret' },
    { env: 'DROPBOX_SIGN_API_KEY', label: 'Dropbox Sign' },
    { env: 'META_SYSTEM_TOKEN', label: 'Meta Ads' },
    { env: 'KV_REST_API_URL', label: 'Vercel KV (URL)' },
    { env: 'KV_REST_API_TOKEN', label: 'Vercel KV (token)' },
    { env: 'GHL_PIT_AGENCY', label: 'GHL — Agency' },
    ...CLIENTS.map(c => ({ env: c.pitEnv, label: 'GHL — ' + c.name })),
  ];
  const missing = required.filter(k => k.env && !process.env[k.env]);
  return { total: required.length, missing };
}

const FLETCHER_STRIPE_ID = CLIENTS_CONFIG.find(c => c.key === 'fletcher')?.stripeId;

const BILLING_CONFIG = CLIENTS_CONFIG
  .filter(c => c.deal && c.deal !== 'Pending')
  .map(c => ({
    key: c.key,
    name: c.name,
    biz: c.biz,
    stripeId: c.stripeId,
    deal: c.deal,
    dealSub: c.dealSub,
    cycleDays: c.cycleDays,
    retainerAmount: c.retainerAmount,
    installments: c.installments,
    status: c.status,
  }));

const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const AGENCY_PIT = process.env.GHL_PIT_AGENCY;
const AGENCY_STAGES = {
  DC_UPCOMING:  'd0065956-d245-4c34-8bcd-4414a3a2c408',
  DC_NOSHOW:    'f7a093f3-799e-4c00-826b-886c41199063',
  SC_UPCOMING:  '8216ee1d-73eb-4a3e-b53b-8b8cf0942256',
};

async function getAgencyData() {
  const oppsData = await ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, AGENCY_PIT);
  const opps = oppsData?.opportunities || [];

  const scOpps       = opps.filter(o => o.pipelineStageId === AGENCY_STAGES.SC_UPCOMING && !isExistingClient(o.contact?.name));
  const dcUpcoming   = opps.filter(o => o.pipelineStageId === AGENCY_STAGES.DC_UPCOMING);
  const dcNoShow     = opps.filter(o => o.pipelineStageId === AGENCY_STAGES.DC_NOSHOW && !isExistingClient(o.contact?.name));
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

  const [oppsData, wfData, pipelinesData] = await Promise.all([
    ghlFetch(`/opportunities/search?location_id=${client.locationId}&limit=100`, pit),
    ghlFetch(`/workflows/?locationId=${client.locationId}`, pit),
    ghlFetch(`/opportunities/pipelines?locationId=${client.locationId}`, pit),
  ]);

  // GHL's /opportunities/search response only gives pipelineStageId (a UUID),
  // never a stage name — look the name up from the pipeline definition instead.
  const stageNameById = {};
  for (const p of pipelinesData?.pipelines || []) {
    for (const s of p.stages || []) stageNameById[s.id] = s.name;
  }

  const leads = { new: 0, hot: 0, booked: 0, attended: 0, sale: 0, total: 0 };
  if (oppsData?.opportunities) {
    for (const opp of oppsData.opportunities) {
      leads.total++;
      if (opp.status === 'won') { leads.sale++; continue; }
      if (opp.status === 'lost') { leads.total--; continue; }
      const bucket = classifyStage(stageNameById[opp.pipelineStageId] || '');
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

  // Build per-client last payment + failed flag from the same payment list.
  // Uses the full config (not just active CLIENTS) so churned clients still show billing history.
  const stripeIdToKey = {};
  CLIENTS_CONFIG.forEach(c => { if (c.stripeId) stripeIdToKey[c.stripeId] = c.key; });

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

async function getUnsignedContracts() {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) return [];

  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  try {
    const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=100', {
      headers: { Authorization: auth },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.signature_requests || [])
      .filter(sr => !sr.is_complete && !sr.is_declined)
      .map(sr => ({
        name: sr.signatures?.[0]?.signer_name || 'Unknown',
        biz: sr.title || '',
        sentDate: new Date(sr.created_at * 1000).toISOString().split('T')[0],
        daysSinceSent: Math.floor((Date.now() - sr.created_at * 1000) / 86400000),
      }));
  } catch {
    return [];
  }
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
    const [clientsData, stripeData, paypalData, agencyData, staleContracts] = await Promise.all([
      Promise.all(CLIENTS.map(getClientData)),
      getStripeData(),
      getPaypalData(),
      getAgencyData(),
      getUnsignedContracts(),
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
            if (bc.status === 'churned') { statusLabel = 'Churned'; statusClass = 'pill-gray'; }
            else if (bc.status === 'lost') { statusLabel = 'Lost'; statusClass = 'pill-gray'; }
            else if (paymentStatus === 'failed') { statusLabel = 'Needs Action'; statusClass = 'pill-red'; }
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
        staleContracts,
        agencyPipeline: agencyData?.pipeline ?? null,
        keysHealth: getKeysHealth(),
      },
      clients: clientsData,
      churnedClients: CHURNED_CLIENTS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
