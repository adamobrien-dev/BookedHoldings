// GET /api/campaign-status
//   — Tracks the "Flash Booked Ireland" Meta campaign against the unit economics Adam set:
//     €297/mo client value, 1-in-3 target close rate → €99 target cost-per-lead, and a
//     10-15 lead sample size needed before the numbers are trustworthy enough to act on.
//     Read-only. Pulls live from the Graph API using the same META_SYSTEM_TOKEN already used
//     by capi.js. Ad account is CAD-denominated; converts to EUR for the target comparison.

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const AD_ACCOUNT_ID = 'act_913731484412697'; // "Booked Clinics" — shared agency account, also runs FlashBooked's ads
const CAMPAIGN_ID = '52568457569176'; // "Flash Booked Ireland"
const CAMPAIGN_LAUNCH_DATE = '2026-08-17';

const CLIENT_VALUE_EUR = 297;
const TARGET_CLOSE_RATE = 1 / 3;
const TARGET_CPL_EUR = Math.round(CLIENT_VALUE_EUR * TARGET_CLOSE_RATE); // 99 — break-even-in-month-1 standard
const LEAD_TARGET_MIN = 10;
const LEAD_TARGET_MAX = 15;
const SPEND_MULTIPLIER_MIN = 2;
const SPEND_MULTIPLIER_MAX = 3;
const FALLBACK_CAD_TO_EUR = 0.62; // used only if the live FX lookup fails

async function metaGet(path, params) {
  const token = process.env.META_SYSTEM_TOKEN;
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const res = await fetch(`${GRAPH_API}${path}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Graph API ${path} -> ${res.status}`);
  return data;
}

async function fetchCadToEurRate() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/CAD');
    const data = await res.json();
    const rate = data?.rates?.EUR;
    if (typeof rate === 'number' && rate > 0) return rate;
  } catch (_) { /* fall through to fallback */ }
  return FALLBACK_CAD_TO_EUR;
}

// Sums the "Schedule" pixel conversion action, which is what this campaign's ad sets optimize
// for (booking a calendar slot) — the same figure used throughout manual tracking so far.
function leadsFromActions(actions) {
  const entry = (actions || []).find(a => a.action_type === 'offsite_conversion.fb_pixel_custom');
  return entry ? Number(entry.value) : 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  if (!process.env.META_SYSTEM_TOKEN) {
    return res.status(500).json({ error: 'META_SYSTEM_TOKEN not configured' });
  }

  try {
    const [account, campaignInsightsRes, adsetInsightsRes, cadToEur] = await Promise.all([
      metaGet(`/${AD_ACCOUNT_ID}`, { fields: 'name,currency' }),
      metaGet(`/${CAMPAIGN_ID}/insights`, {
        fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions',
        date_preset: 'maximum',
      }),
      metaGet(`/${CAMPAIGN_ID}/insights`, {
        level: 'adset',
        fields: 'adset_name,spend,impressions,clicks,ctr,cpc,actions',
        date_preset: 'maximum',
      }),
      fetchCadToEurRate(),
    ]);

    const totals = campaignInsightsRes.data?.[0] || {};
    const spendNative = Number(totals.spend || 0);
    const leads = leadsFromActions(totals.actions);
    const spendEur = spendNative * cadToEur;
    const cplNativeVal = leads > 0 ? spendNative / leads : null;
    const cplEurVal = leads > 0 ? spendEur / leads : null;

    const adsets = (adsetInsightsRes.data || []).map(a => {
      const s = Number(a.spend || 0);
      const l = leadsFromActions(a.actions);
      return {
        name: a.adset_name,
        spend_native: Math.round(s * 100) / 100,
        spend_eur: Math.round(s * cadToEur * 100) / 100,
        leads: l,
        cpl_native: l > 0 ? Math.round((s / l) * 100) / 100 : null,
        cpl_eur: l > 0 ? Math.round(((s * cadToEur) / l) * 100) / 100 : null,
        clicks: Number(a.clicks || 0),
        ctr: a.ctr ? Number(a.ctr) : null,
      };
    });

    const daysLive = Math.max(
      1,
      Math.round((Date.now() - new Date(CAMPAIGN_LAUNCH_DATE).getTime()) / 86400000)
    );
    const leadsPerDay = leads / daysLive;
    const leadsNeeded = Math.max(0, LEAD_TARGET_MIN - leads);
    const daysToMinLeadTarget = leadsPerDay > 0 ? Math.ceil(leadsNeeded / leadsPerDay) : null;
    const estReadyDate = daysToMinLeadTarget != null
      ? new Date(Date.now() + daysToMinLeadTarget * 86400000).toISOString().slice(0, 10)
      : null;

    const spendThresholdMinEur = TARGET_CPL_EUR * SPEND_MULTIPLIER_MIN;
    const spendThresholdMaxEur = TARGET_CPL_EUR * SPEND_MULTIPLIER_MAX;
    const pastSpendThreshold = spendEur >= spendThresholdMinEur;
    const sampleTrustworthy = leads >= LEAD_TARGET_MIN;

    let verdict;
    if (!sampleTrustworthy) {
      verdict = 'gathering-data'; // not enough leads yet regardless of what CPL looks like
    } else if (cplEurVal != null && cplEurVal <= TARGET_CPL_EUR) {
      verdict = 'on-target';
    } else if (pastSpendThreshold) {
      verdict = 'needs-review'; // enough leads AND enough spend, and still over target
    } else {
      verdict = 'gathering-data';
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      campaign: {
        name: 'Flash Booked Ireland',
        id: CAMPAIGN_ID,
        launchDate: CAMPAIGN_LAUNCH_DATE,
        daysLive,
      },
      account: { name: account.name, currency: account.currency },
      fx: { cadToEur: Math.round(cadToEur * 10000) / 10000 },
      targets: {
        clientValueEur: CLIENT_VALUE_EUR,
        targetCloseRate: TARGET_CLOSE_RATE,
        targetCplEur: TARGET_CPL_EUR,
        leadTargetMin: LEAD_TARGET_MIN,
        leadTargetMax: LEAD_TARGET_MAX,
        spendThresholdMinEur: Math.round(spendThresholdMinEur * 100) / 100,
        spendThresholdMaxEur: Math.round(spendThresholdMaxEur * 100) / 100,
      },
      totals: {
        spend_native: Math.round(spendNative * 100) / 100,
        spend_eur: Math.round(spendEur * 100) / 100,
        leads,
        cpl_native: cplNativeVal != null ? Math.round(cplNativeVal * 100) / 100 : null,
        cpl_eur: cplEurVal != null ? Math.round(cplEurVal * 100) / 100 : null,
        impressions: Number(totals.impressions || 0),
        clicks: Number(totals.clicks || 0),
        ctr: totals.ctr ? Number(totals.ctr) : null,
        cpc_native: totals.cpc ? Number(totals.cpc) : null,
        frequency: totals.frequency ? Number(totals.frequency) : null,
      },
      progress: {
        leadsSoFar: leads,
        leadsNeededForMinSample: leadsNeeded,
        sampleTrustworthy,
        pastSpendThreshold,
        leadsPerDay: Math.round(leadsPerDay * 1000) / 1000,
        estDaysToMinLeadTarget: daysToMinLeadTarget,
        estReadyDate,
      },
      verdict,
      adsets,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
