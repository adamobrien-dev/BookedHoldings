const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const AGENCY_PIT = process.env.GHL_PIT_AGENCY || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
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

async function getStripeData() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
  const headers = { Authorization: auth };

  const [balRes, customersRes, invoicesRes, piRes, subsRes] = await Promise.all([
    fetch('https://api.stripe.com/v1/balance', { headers }),
    fetch('https://api.stripe.com/v1/customers?limit=100', { headers }),
    fetch('https://api.stripe.com/v1/invoices?limit=100', { headers }),
    fetch('https://api.stripe.com/v1/payment_intents?limit=100', { headers }),
    fetch('https://api.stripe.com/v1/subscriptions?limit=100&status=all', { headers }),
  ]);

  const balance       = balRes.ok       ? await balRes.json()           : null;
  const customers     = customersRes.ok ? (await customersRes.json()).data || [] : [];
  const invoices      = invoicesRes.ok  ? (await invoicesRes.json()).data  || [] : [];
  const payments      = piRes.ok        ? (await piRes.json()).data        || [] : [];
  const subscriptions = subsRes.ok      ? (await subsRes.json()).data      || [] : [];

  // Build per-customer invoice summary
  const customerMap = {};
  for (const c of customers) {
    customerMap[c.id] = {
      id:            c.id,
      name:          c.name  || c.email || c.id,
      email:         c.email || null,
      openInvoices:  [],
      paidInvoices:  [],
      lastPaidAt:    null,
      lastPaidCents: null,
      hasFailed:     false,
      nextDueDate:   null,
      retainerAmount: null,
    };
  }

  // Attach subscription data — next billing date + amount
  for (const sub of subscriptions) {
    const c = customerMap[sub.customer];
    if (!c || sub.status === 'canceled') continue;
    c.nextDueDate    = new Date(sub.current_period_end * 1000).toISOString();
    c.retainerAmount = sub.items?.data?.[0]?.price?.unit_amount
      ? Math.round(sub.items.data[0].price.unit_amount / 100)
      : null;
  }

  for (const inv of invoices) {
    const c = customerMap[inv.customer];
    if (!c) continue;
    const entry = {
      id:           inv.id,
      amountCents:  inv.amount_due,
      dueDate:      inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      paidAt:       inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
      description:  inv.description || inv.lines?.data?.[0]?.description || null,
    };
    if (inv.status === 'open')   c.openInvoices.push(entry);
    if (inv.status === 'paid') {
      c.paidInvoices.push(entry);
      if (!c.lastPaidAt || entry.paidAt > c.lastPaidAt) {
        c.lastPaidAt    = entry.paidAt;
        c.lastPaidCents = inv.amount_paid;
      }
    }
  }

  for (const p of payments) {
    const c = customerMap[p.customer];
    if (!c) continue;
    if (p.status === 'requires_payment_method') c.hasFailed = true;
  }

  const collectedCents = payments
    .filter(p => p.status === 'succeeded')
    .reduce((s, p) => s + p.amount, 0);

  const allClients = Object.values(customerMap).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const unpaid = allClients
    .filter(c => c.openInvoices.length > 0 || c.hasFailed)
    .map(c => ({
      name:          c.name,
      email:         c.email,
      hasFailed:     c.hasFailed,
      openInvoices:  c.openInvoices,
      totalOwedCents: c.openInvoices.reduce((s, inv) => s + inv.amountCents, 0),
    }))
    .sort((a, b) => b.totalOwedCents - a.totalOwedCents);

  // Build billing rows from clients.json config + live Stripe data
  const billingRows = CLIENTS.map(bc => {
    const c = bc.stripeId ? (customerMap[bc.stripeId] || {}) : {};
    const openInv = c.openInvoices?.[0] || null;

    let paymentStatus = 'none';
    if (c.hasFailed)                      paymentStatus = 'failed';
    else if (c.lastPaidAt && !openInv)    paymentStatus = 'ok';
    else if (openInv)                     paymentStatus = 'warn';

    let statusLabel, statusClass;
    if (paymentStatus === 'failed')      { statusLabel = 'Payment Failed'; statusClass = 'pill-red'; }
    else if (paymentStatus === 'ok')     { statusLabel = 'Paid';           statusClass = 'pill-green'; }
    else if (paymentStatus === 'warn')   { statusLabel = 'Invoice Open';   statusClass = 'pill-yellow'; }
    else                                 { statusLabel = 'No Activity';    statusClass = 'pill-gray'; }

    // next due: subscription > manually invoiced (lastPaid + cycleDays) > open invoice due date
    let nextDueDate = c.nextDueDate || null;
    if (!nextDueDate && c.lastPaidAt && bc.cycleDays) {
      nextDueDate = new Date(new Date(c.lastPaidAt).getTime() + bc.cycleDays * 24 * 3600 * 1000).toISOString();
    }
    if (!nextDueDate && openInv?.dueDate) nextDueDate = openInv.dueDate;

    return {
      key:                bc.key,
      name:               bc.name,
      biz:                bc.biz,
      deal:               bc.deal || '—',
      dealSub:            bc.dealSub || null,
      retainerAmount:     bc.retainerAmount || (c.lastPaidCents ? Math.round(c.lastPaidCents / 100) : null),
      lastPaidAmountCents: c.lastPaidCents || null,
      lastPaidDate:       c.lastPaidAt || null,
      nextDueDate,
      paymentStatus, statusLabel, statusClass,
    };
  });

  return {
    balanceCents: balance?.available?.find(b => b.currency === 'usd')?.amount ?? 0,
    collectedCents,
    unpaid,
    clients: allClients,
    billingRows,
  };
}

async function getContractsData() {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY || '0c7c0852c085eeeb45c29567517edd91fe42cde48870c1d3bf0971dda88e6f11';
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  try {
    const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=100', {
      headers: { Authorization: auth },
    });
    if (!r.ok) return { signed: [], unsigned: [] };
    const data  = await r.json();
    const requests = data?.signature_requests || [];

    const signed = requests
      .filter(sr => sr.is_complete)
      .map(sr => ({
        title:      sr.title,
        signerName: sr.signatures?.[0]?.signer_name || null,
        signerEmail: sr.signatures?.[0]?.signer_email_address || null,
        signedAt:   sr.signatures?.[0]?.signed_at
          ? new Date(sr.signatures[0].signed_at * 1000).toISOString()
          : null,
      }))
      .sort((a, b) => (b.signedAt || '').localeCompare(a.signedAt || ''));

    const unsigned = requests
      .filter(sr => !sr.is_complete && !sr.is_declined)
      .map(sr => ({
        title:        sr.title,
        signerName:   sr.signatures?.[0]?.signer_name || null,
        signerEmail:  sr.signatures?.[0]?.signer_email_address || null,
        daysSinceSent: Math.floor((Date.now() - sr.created_at * 1000) / 86400000),
      }))
      .sort((a, b) => b.daysSinceSent - a.daysSinceSent);

    return { signed, unsigned };
  } catch { return { signed: [], unsigned: [] }; }
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
      name:          o.contact.name,
      phone:         o.contact.phone,
      contactId:     o.contact.id,
      hasFutureAppt: future.length > 0,
      nextAppt:      future.sort((a, b) => new Date(a.startTime || a.endTime) - new Date(b.startTime || b.endTime))[0]?.startTime || null,
    };
  }));

  return {
    pipeline: {
      scUpcoming:    scOpps.length,
      dcUpcoming:    dcUpcoming.length,
      dcNoShow:      dcNoShow.length,
      won:           wonOpps.length,
      lost:          lostOpps.length,
      total:         opps.filter(o => o.status !== 'lost').length,
      scNames:       names(scOpps),
      dcNoShowNames: names(dcNoShow),
      wonNames:      names(wonOpps),
    },
    scRecovery: {
      needsRecovery: scRecovery.filter(r => !r.hasFutureAppt),
      confirmed:     scRecovery.filter(r =>  r.hasFutureAppt),
    },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [stripeData, contractsData, agencyData] = await Promise.all([
      getStripeData(),
      getContractsData(),
      getAgencyData(),
    ]);

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      stripe: {
        balanceCents:   stripeData?.balanceCents   ?? null,
        collectedCents: stripeData?.collectedCents ?? null,
        unpaid:         stripeData?.unpaid         ?? [],
        clients:        stripeData?.clients        ?? [],
      },
      billingRows:    stripeData?.billingRows    ?? [],
      contracts:      contractsData,
      agencyPipeline: agencyData?.pipeline  ?? null,
      scRecovery:     agencyData?.scRecovery ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
