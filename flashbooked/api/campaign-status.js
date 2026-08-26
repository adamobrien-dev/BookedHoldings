// GET /api/campaign-status
//   — Tracks the "Flash Booked Ireland" Meta campaign against the unit economics Adam set:
//     €297/mo client value, 1-in-3 target close rate → €99 target cost-per-lead, and a
//     10-15 lead sample size needed before the numbers are trustworthy enough to act on.
//     Read-only. Pulls live from the Graph API using the same META_SYSTEM_TOKEN already used
//     by capi.js. Ad account is CAD-denominated; converts to EUR for the target comparison.
//
//   Also breaks down to individual-ad level and applies kill/scale rules of thumb (adapted
//   from a common paid-ads framework — 2x target CPL before judging, <0.5% CTR at 1K+
//   impressions, 3.5+ frequency, no spend in 72h) so specific underperforming creatives can
//   be spotted, not just whole ad sets. The 30%-CTR-drop-over-2-weeks rule needs daily
//   history this endpoint doesn't fetch, so it's surfaced as "not yet evaluable" rather than
//   silently skipped.

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

// Applies the 5-rule kill framework at the individual-ad level. Only flags a hard "kill"
// verdict when a rule's own data requirement is actually met (e.g. won't call CTR too low
// off a handful of impressions) — otherwise reports why it's too early to judge.
function verdictForAd({ status, spendEur, impressions, ctr, frequency, leads, cplEur, spend3dNative, targetCplEur, spendThresholdMinEur }) {
  if (status && status !== 'ACTIVE') return { code: 'paused', label: 'Paused' };

  if (spend3dNative <= 0) {
    return { code: 'kill-no-recent-spend', label: 'Kill — no spend in 72h', reason: 'Delivery has stopped (low relevance, budget-starved, or disapproved) — check Ads Manager for a delivery issue.' };
  }
  if (frequency >= 3.5) {
    return { code: 'kill-high-frequency', label: 'Kill — frequency 3.5+', reason: `Frequency is ${frequency.toFixed(1)} — audience is seeing this too often; creative fatigue.` };
  }
  if (impressions >= 1000 && ctr < 0.5) {
    return { code: 'kill-low-ctr', label: 'Kill — CTR under 0.5%', reason: `${ctr.toFixed(2)}% CTR on ${impressions.toLocaleString()} impressions — the hook isn't landing.` };
  }
  if (spendEur >= spendThresholdMinEur && leads > 0 && cplEur > targetCplEur) {
    return { code: 'kill-over-target', label: 'Kill — over target after 2x spend', reason: `€${cplEur.toFixed(0)} cost/lead vs €${targetCplEur} target, after spending past the 2x review threshold.` };
  }
  if (spendEur >= spendThresholdMinEur && leads === 0) {
    return { code: 'kill-no-leads', label: 'Kill — no leads after 2x spend', reason: `€${spendEur.toFixed(0)} spent (past the 2x review threshold) with zero leads.` };
  }
  // Rule 4 (CTR down 30% over 2 weeks) needs daily history this endpoint doesn't pull, and
  // can't apply before the campaign itself is 2 weeks old anyway — surfaced via adKillRules.note
  // in the response instead of a per-ad check.
  if (leads > 0 && cplEur != null && cplEur <= targetCplEur) {
    return { code: 'promising', label: 'Promising — under target', reason: `€${cplEur.toFixed(0)} cost/lead, at or under the €${targetCplEur} target — small sample, worth more spend before scaling hard.` };
  }
  return { code: 'gathering-data', label: 'Gathering data', reason: 'Hasn’t hit any rule’s minimum data bar yet (spend, impressions, or leads) — too early to judge.' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  if (!process.env.META_SYSTEM_TOKEN) {
    return res.status(500).json({ error: 'META_SYSTEM_TOKEN not configured' });
  }

  try {
    const [account, campaignInsightsRes, adsetInsightsRes, adInsightsRes, adInsights3dRes, adsListRes, cadToEur] = await Promise.all([
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
      metaGet(`/${CAMPAIGN_ID}/insights`, {
        level: 'ad',
        fields: 'ad_id,ad_name,adset_name,spend,impressions,clicks,ctr,frequency,actions',
        date_preset: 'maximum',
      }),
      metaGet(`/${CAMPAIGN_ID}/insights`, {
        level: 'ad',
        fields: 'ad_id,spend',
        time_range: JSON.stringify({
          since: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
          until: new Date().toISOString().slice(0, 10),
        }),
      }),
      metaGet(`/${CAMPAIGN_ID}/ads`, { fields: 'id,name,effective_status', limit: 100 }),
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

    const statusByAdId = Object.fromEntries(
      (adsListRes.data || []).map(a => [a.id, a.effective_status])
    );
    const spend3dByAdId = Object.fromEntries(
      (adInsights3dRes.data || []).map(a => [a.ad_id, Number(a.spend || 0)])
    );

    const daysLive = Math.max(
      1,
      Math.round((Date.now() - new Date(CAMPAIGN_LAUNCH_DATE).getTime()) / 86400000)
    );

    const ads = (adInsightsRes.data || []).map(a => {
      const s = Number(a.spend || 0);
      const l = leadsFromActions(a.actions);
      const sEur = s * cadToEur;
      const cpl = l > 0 ? sEur / l : null;
      const ctrVal = a.ctr ? Number(a.ctr) : 0;
      const freqVal = a.frequency ? Number(a.frequency) : 0;
      const status = statusByAdId[a.ad_id] || null;
      const spend3d = spend3dByAdId[a.ad_id] ?? s; // fall back to lifetime if not in the 3d window at all

      const verdict = verdictForAd({
        status,
        spendEur: sEur,
        impressions: Number(a.impressions || 0),
        ctr: ctrVal,
        frequency: freqVal,
        leads: l,
        cplEur: cpl,
        spend3dNative: spend3d,
        targetCplEur: TARGET_CPL_EUR,
        spendThresholdMinEur: TARGET_CPL_EUR * SPEND_MULTIPLIER_MIN,
      });

      return {
        id: a.ad_id,
        name: a.ad_name,
        adsetName: a.adset_name,
        status,
        spend_native: Math.round(s * 100) / 100,
        spend_eur: Math.round(sEur * 100) / 100,
        spend_last3d_native: Math.round(spend3d * 100) / 100,
        leads: l,
        cpl_eur: cpl != null ? Math.round(cpl * 100) / 100 : null,
        impressions: Number(a.impressions || 0),
        clicks: Number(a.clicks || 0),
        ctr: a.ctr ? Number(a.ctr) : null,
        frequency: a.frequency ? Number(a.frequency) : null,
        verdict,
      };
    }).sort((x, y) => y.spend_native - x.spend_native);

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
      ads,
      adKillRules: {
        spendMultiplierBeforeJudging: SPEND_MULTIPLIER_MIN,
        minCtrPct: 0.5,
        minImpressionsForCtrRule: 1000,
        maxFrequency: 3.5,
        noSpendWindowHours: 72,
        note: 'CTR-drop-over-2-weeks rule needs daily history not pulled here — not evaluated.',
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
