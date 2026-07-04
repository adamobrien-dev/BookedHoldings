const GRAPH_API = 'https://graph.facebook.com/v21.0';
const CLIENTS   = require('../config/clients.json');

const CHURNED_STATUSES = ['churned', 'lost'];
const isChurned = c => CHURNED_STATUSES.includes(c.status);

// account_status: 1=active, 2=disabled, 3=unsettled, 9=in_grace_period
const STATUS_LABEL = { 1: 'active', 2: 'disabled', 3: 'unsettled', 9: 'grace_period', 7: 'pending_review' };

// Returns true if a campaign belongs to BookedClinics.
// Whitelisted by ID (legacy campaigns), or name contains "Booked Clinics" (new standard).
function isOurCampaign(campaign, allowedIds) {
  if (allowedIds?.length && allowedIds.includes(campaign.id)) return true;
  if (campaign.name?.toLowerCase().includes('booked clinics')) return true;
  return false;
}

async function fetchCampaigns(accountId, token) {
  const url = `${GRAPH_API}/${accountId}/campaigns?fields=id,name,status&limit=100&access_token=${token}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) return { error: d.error.message, campaigns: [] };
    return { campaigns: d.data || [] };
  } catch {
    return { error: 'fetch_failed', campaigns: [] };
  }
}

async function fetchCampaignInsights(campaignId, token, datePreset) {
  const fields = 'spend,impressions,clicks,actions,cost_per_action_type';
  const url = `${GRAPH_API}/${campaignId}/insights?fields=${encodeURIComponent(fields)}&date_preset=${datePreset}&access_token=${token}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) return null;
    return d.data?.[0] || null;
  } catch {
    return null;
  }
}

async function fetchStatus(accountId, token) {
  const url = `${GRAPH_API}/${accountId}?fields=account_status,disable_reason&access_token=${token}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) return null;
    return d;
  } catch {
    return null;
  }
}

// Meta Ad Library API — public ad search, used for competitor research.
async function fetchAdLibrary(searchTerms, token, countries) {
  const params = new URLSearchParams({
    search_terms: searchTerms,
    ad_type: 'ALL',
    ad_reached_countries: JSON.stringify(countries),
    ad_active_status: 'ALL',
    fields: 'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms',
    limit: '25',
    access_token: token,
  });
  const url = `${GRAPH_API}/ads_archive?${params.toString()}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return d;
  } catch {
    return { error: { message: 'fetch_failed' } };
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

function sumInsights(insightsArr) {
  let spend = 0, leads = 0, clicks = 0, impressions = 0, cplTotal = 0, cplCount = 0;
  for (const ins of insightsArr) {
    if (!ins) continue;
    if (ins.spend)       spend       += parseFloat(ins.spend);
    if (ins.clicks)      clicks      += parseInt(ins.clicks, 10);
    if (ins.impressions) impressions += parseInt(ins.impressions, 10);
    const l = extractLeads(ins.actions);
    if (l != null) leads += l;
    const c = extractCPL(ins.cost_per_action_type);
    if (c != null) { cplTotal += c; cplCount++; }
  }
  return {
    spend:       spend > 0 ? spend : null,
    leads:       leads > 0 ? leads : null,
    clicks:      clicks > 0 ? clicks : null,
    impressions: impressions > 0 ? impressions : null,
    cpl:         spend > 0 && leads > 0 ? spend / leads : null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) return res.status(200).json({ error: 'META_SYSTEM_TOKEN not configured', accounts: [] });

  // Ad Library competitor search: /api/meta-ads?adlib=<search terms>&countries=US
  const adlib = req.query?.adlib;
  if (adlib) {
    const countries = (req.query?.countries || 'US').split(',').map(c => c.trim());
    const result = await fetchAdLibrary(adlib, token, countries);
    return res.status(200).json({ generatedAt: new Date().toISOString(), searchTerms: adlib, countries, result });
  }

  const datePreset = req.query?.preset || 'last_7d';

  async function fetchAccountData(client) {
    const accountId   = client.metaAccountId;
    const allowedIds  = client.metaCampaignIds || [];

    const [{ campaigns, error: campError }, status] = await Promise.all([
      fetchCampaigns(accountId, token),
      fetchStatus(accountId, token),
    ]);

    if (campError) {
      return {
        key: client.key, name: client.biz.split('·')[0].trim(),
        accountId, datePreset,
        spend: null, leads: null, cpl: null, clicks: null, impressions: null,
        accountStatus: null, statusLabel: 'unknown',
        isActive: false, isUnsettled: false, isDisabled: false,
        error: campError, ourCampaigns: [],
      };
    }

    const ourCampaigns = campaigns.filter(c => isOurCampaign(c, allowedIds));

    // Fetch insights for each of our campaigns, then aggregate
    const insightsArr = await Promise.all(
      ourCampaigns.map(c => fetchCampaignInsights(c.id, token, datePreset))
    );

    const totals      = sumInsights(insightsArr);
    const acctStatus  = status?.account_status ?? null;

    return {
      key:          client.key,
      name:         client.biz.split('·')[0].trim(),
      accountId,
      datePreset,
      ...totals,
      ourCampaigns: ourCampaigns.map(c => ({ id: c.id, name: c.name, status: c.status })),
      accountStatus:  acctStatus,
      statusLabel:    STATUS_LABEL[acctStatus] || (acctStatus != null ? 'status_' + acctStatus : 'unknown'),
      isActive:       acctStatus === 1,
      isUnsettled:    acctStatus === 3 || acctStatus === 9,
      isDisabled:     acctStatus === 2,
      error:          null,
    };
  }

  const activeClients  = CLIENTS.filter(c => c.metaAccountId && !isChurned(c));
  const churnedClients = CLIENTS.filter(c => c.metaAccountId && isChurned(c));

  const [accounts, churnedAccounts] = await Promise.all([
    Promise.all(activeClients.map(fetchAccountData)),
    Promise.all(churnedClients.map(fetchAccountData)),
  ]);

  return res.status(200).json({ generatedAt: new Date().toISOString(), datePreset, accounts, churnedAccounts });
};
