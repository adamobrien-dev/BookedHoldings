const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const AGENCY_PIT = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';

// Add new clients to config/clients.json — no code changes needed
const CLIENTS = require('../config/clients.json');

async function ghlFetch(path, pit) {
  try {
    const res = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function classifyAgencyStage(stageName = '') {
  const s = stageName.toLowerCase();
  if (s.includes('won') || s.includes('client')) return 'WON';
  if (s.includes('dc') && s.includes('upcoming')) return 'DC_UPCOMING';
  if (s.includes('dc') && s.includes('no show')) return 'DC_NOSHOW';
  if (s.includes('sc') && s.includes('upcoming')) return 'SC_UPCOMING';
  return 'OTHER';
}

function classifyLeadStage(stageName = '') {
  const s = stageName.toLowerCase();
  if (s.includes('hot')) return 'hot';
  if (s.includes('book') || s.includes('scheduled') || s.includes('appt')) return 'booked';
  if (s.includes('attend') || s.includes('visit')) return 'attended';
  if (s.includes('sale') || s.includes('won') || s.includes('review')) return 'sale';
  return 'new';
}

async function getContractsData() {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY || '0c7c0852c085eeeb45c29567517edd91fe42cde48870c1d3bf0971dda88e6f11';
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  try {
    const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=100', {
      headers: { Authorization: auth },
    });
    if (!r.ok) return { signed: [], unsigned: [] };
    const data = await r.json();
    const requests = data?.signature_requests || [];

    const signed = requests
      .filter(sr => sr.is_complete)
      .map(sr => ({
        title: sr.title,
        signerName: sr.signatures?.[0]?.signer_name || null,
        signerEmail: sr.signatures?.[0]?.signer_email_address || null,
        signedAt: sr.signatures?.[0]?.signed_at
          ? new Date(sr.signatures[0].signed_at * 1000).toISOString()
          : null,
      }));

    const unsigned = requests
      .filter(sr => !sr.is_complete && !sr.is_declined)
      .map(sr => ({
        title: sr.title,
        signerName: sr.signatures?.[0]?.signer_name || null,
        signerEmail: sr.signatures?.[0]?.signer_email_address || null,
        daysSinceSent: Math.floor((Date.now() - sr.created_at * 1000) / 86400000),
      }))
      .sort((a, b) => b.daysSinceSent - a.daysSinceSent);

    return { signed, unsigned };
  } catch { return { signed: [], unsigned: [] }; }
}

async function getStripeData() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
  const headers = { Authorization: auth };

  const [balRes, piRes, invRes] = await Promise.all([
    fetch('https://api.stripe.com/v1/balance', { headers }),
    fetch('https://api.stripe.com/v1/payment_intents?limit=100', { headers }),
    fetch('https://api.stripe.com/v1/invoices?limit=100&status=open', { headers }),
  ]);

  const balance = balRes.ok ? await balRes.json() : null;
  const pi = piRes.ok ? await piRes.json() : null;
  const openInvoices = invRes.ok ? ((await invRes.json()).data || []) : [];

  const payments = pi?.data || [];
  const collectedCents = payments
    .filter(p => p.status === 'succeeded')
    .reduce((s, p) => s + p.amount, 0);

  const failed = payments
    .filter(p => p.status === 'requires_payment_method')
    .map(p => ({ id: p.id, amountCents: p.amount, customerId: p.customer }));

  // Build per-client payment summary keyed by client key
  const stripeIdToKey = {};
  CLIENTS.forEach(c => { if (c.stripeId) stripeIdToKey[c.stripeId] = c.key; });

  const perClient = {};
  for (const p of payments) {
    const k = stripeIdToKey[p.customer];
    if (!k) continue;
    if (!perClient[k]) perClient[k] = { lastSucceeded: null, succeededCount: 0, hasFailed: false };
    if (p.status === 'succeeded') {
      perClient[k].succeededCount++;
      if (!perClient[k].lastSucceeded || p.created > perClient[k].lastSucceeded.created) {
        perClient[k].lastSucceeded = { amountCents: p.amount, created: p.created };
      }
    }
    if (p.status === 'requires_payment_method') perClient[k].hasFailed = true;
  }

  // Build billing rows from clients.json — no hardcoded billing config
  const billingRows = CLIENTS.map(bc => {
    const stripe = perClient[bc.key] || null;
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
    let installmentPaid = null, installmentTotal = null;
    if (bc.installments && stripe?.succeededCount) {
      installmentPaid = Math.min(stripe.succeededCount, bc.installments.total);
      installmentTotal = bc.installments.total;
    }
    return {
      key: bc.key,
      name: bc.name,
      biz: bc.biz,
      deal: bc.deal,
      dealSub: bc.dealSub,
      retainerAmount: bc.retainerAmount,
      lastPaidAmountCents,
      lastPaidDate,
      nextDueDate,
      paymentStatus,
      installmentPaid,
      installmentTotal,
      openInvoices: openInvoices
        .filter(inv => inv.customer === bc.stripeId)
        .map(inv => ({
          id: inv.id,
          amountDueCents: inv.amount_due,
          dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
        })),
    };
  });

  return {
    balanceCents: balance?.available?.find(b => b.currency === 'usd')?.amount ?? 0,
    collectedCents,
    failed,
    billingRows,
  };
}

async function getAgencyData() {
  const oppsData = await ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, AGENCY_PIT);
  const opps = oppsData?.opportunities || [];

  const scOpps     = opps.filter(o => classifyAgencyStage(o.pipelineStageName) === 'SC_UPCOMING');
  const dcUpcoming = opps.filter(o => classifyAgencyStage(o.pipelineStageName) === 'DC_UPCOMING');
  const dcNoShow   = opps.filter(o => classifyAgencyStage(o.pipelineStageName) === 'DC_NOSHOW');
  const wonOpps    = opps.filter(o => classifyAgencyStage(o.pipelineStageName) === 'WON');
  const lostOpps   = opps.filter(o => o.status === 'lost');
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

async function getClientData(client) {
  const pit = process.env[client.pitEnv];
  if (!pit || !client.locationId) return { ...client, leads: null, workflows: null, error: !pit ? 'missing_pit' : 'no_location' };

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
      leads[classifyLeadStage(opp.pipelineStageName || '')]++;
    }
  }

  const WF_MAP = [
    { key: 'fast5',        patterns: ['fast 5', 'fast5', 'new lead nurture'] },
    { key: 'confirmation', patterns: ['confirmation', 'reminder'] },
    { key: 'noshow',       patterns: ['no show', 'noshow', 'no-show'] },
    { key: 'review',       patterns: ['review', 'new sale'] },
    { key: 'nurture',      patterns: ['long-term', 'longterm', 'long term'] },
    { key: 'stale',        patterns: ['stale', 're-engage', 'reengage'] },
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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [clientsData, stripeData, contractsData, agencyData] = await Promise.all([
      Promise.all(CLIENTS.map(getClientData)),
      getStripeData(),
      getContractsData(),
      getAgencyData(),
    ]);

    const totalLeads = clientsData.reduce((s, c) => s + (c.leads?.total || 0), 0);
    const stuckLeads = clientsData.reduce((s, c) => s + (c.leads?.new || 0), 0);
    const stripeCollected = (stripeData?.collectedCents || 0) / 100;

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalLeads,
        stuckLeads,
        stuckPct: totalLeads > 0 ? Math.round((stuckLeads / totalLeads) * 100) : 0,
        totalCollected: stripeCollected,
        stripeBalanceCents: stripeData?.balanceCents ?? null,
        billingRows: stripeData?.billingRows ?? [],
        contracts: contractsData,
        agencyPipeline: agencyData?.pipeline ?? null,
        scRecovery: agencyData?.scRecovery ?? null,
      },
      clients: clientsData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
