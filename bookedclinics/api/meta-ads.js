const GRAPH_API = 'https://graph.facebook.com/v21.0';

const ACCOUNTS = [
  { key: 'terri',    name: 'Terri — Get Body Sculpted',   id: 'act_485117883849244'  },
  { key: 'allaphia', name: 'Allaphia — Paradise Healing', id: 'act_1525285445041708' },
  { key: 'thania',   name: 'Thania — Tiali Beauty',       id: 'act_1538112044990130' },
  { key: 'aguilera', name: 'Aguilera Health & Wellness',  id: 'act_881548277918155'  },
];

// account_status: 1=active, 2=disabled, 3=unsettled, 9=in_grace_period
const STATUS_LABEL = { 1: 'active', 2: 'disabled', 3: 'unsettled', 9: 'grace_period', 7: 'pending_review' };

async function fetchInsights(id, token, datePreset) {
  const fields = 'spend,impressions,clicks,actions,cost_per_action_type';
  const url = `${GRAPH_API}/${id}/insights?fields=${encodeURIComponent(fields)}&date_preset=${datePreset}&access_token=${token}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) return { error: d.error.message };
    return d.data?.[0] || {};
  } catch {
    return { error: 'fetch_failed' };
  }
}

async function fetchStatus(id, token) {
  const url = `${GRAPH_API}/${id}?fields=account_status,disable_reason&access_token=${token}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) return null;
    return d;
  } catch {
    return null;
  }
}

function extractLeads(actions = []) {
  const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'contact_total'];
  for (const t of LEAD_TYPES) {
    const match = actions.find(a => a.action_type === t);
    if (match) return parseInt(match.value, 10);
  }
  return null;
}

function extractCPL(cpaArr = []) {
  const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'contact_total'];
  for (const t of LEAD_TYPES) {
    const match = cpaArr.find(a => a.action_type === t);
    if (match) return parseFloat(match.value);
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) return res.status(200).json({ error: 'META_SYSTEM_TOKEN not configured', accounts: [] });

  const datePreset = (req.query?.preset) || 'last_7d';

  const accounts = await Promise.all(ACCOUNTS.map(async (acct) => {
    const [insights, status] = await Promise.all([
      fetchInsights(acct.id, token, datePreset),
      fetchStatus(acct.id, token),
    ]);

    const acctStatus = status?.account_status ?? null;
    const spend      = insights.spend       != null ? parseFloat(insights.spend) : null;
    const leads      = extractLeads(insights.actions);
    const cpl        = extractCPL(insights.cost_per_action_type);
    const clicks     = insights.clicks      != null ? parseInt(insights.clicks, 10) : null;
    const impressions= insights.impressions != null ? parseInt(insights.impressions, 10) : null;

    return {
      key:          acct.key,
      name:         acct.name,
      accountId:    acct.id,
      datePreset,
      spend,
      leads,
      cpl,
      clicks,
      impressions,
      accountStatus:  acctStatus,
      statusLabel:    STATUS_LABEL[acctStatus] || (acctStatus != null ? 'status_' + acctStatus : 'unknown'),
      isActive:       acctStatus === 1,
      isUnsettled:    acctStatus === 3 || acctStatus === 9,
      isDisabled:     acctStatus === 2,
      error:          insights.error || null,
    };
  }));

  return res.status(200).json({ generatedAt: new Date().toISOString(), datePreset, accounts });
};
