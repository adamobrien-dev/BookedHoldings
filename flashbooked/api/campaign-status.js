// GET /api/campaign-status
//   — Tracks the "Flash Booked Ireland Lead forms" Meta campaign against a funnel-stage KPI
//     framework (set 2026-09-04, see FUNNEL_TARGETS below), not a flat CPL target. That older
//     model (€297/mo retainer, 1-in-3 close rate → €99 target CPL) assumed a monthly-retainer
//     offer and treated cost-per-lead as the whole story; FlashBooked's actual offer is a
//     €1,000 upfront sale, and native Instant Form leads can look cheap on CPL alone while
//     being unqualified. So CPL is now judged together with how many leads actually book a
//     call, show up, and close — using FlashBooked's real GHL pipeline stages (Leads: New →
//     Convo: Responded → DC: Upcoming → ... → SC: Upcoming → ... → Won/Lost) as the funnel.
//     Read-only. Pulls live from the Graph API using the same META_SYSTEM_TOKEN already used
//     by capi.js. Ad account is CAD-denominated; converts to EUR for the target comparisons.
//
//   Also breaks down to individual-ad level and applies kill/scale rules of thumb (adapted
//   from a common paid-ads framework — 2x a "bad" CPL threshold before judging, <0.5% CTR at
//   1K+ impressions, 3.5+ frequency, no spend in 72h) so specific underperforming creatives
//   can be spotted, not just whole ad sets. The 30%-CTR-drop-over-2-weeks rule needs daily
//   history this endpoint doesn't fetch, so it's surfaced as "not yet evaluable" rather than
//   silently skipped.

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const AD_ACCOUNT_ID = 'act_913731484412697'; // "Booked Clinics" — shared agency account, also runs FlashBooked's ads
// "Flash Booked Ireland" (52568457569176) was paused 2026-08-31 in favor of this native
// Lead Ads campaign — same GHL utm_content attribution still applies (ad_id passes through
// to opportunities.attributions[].utmContent same as the old pixel-based campaign), so no
// other tracking logic needed to change, just which campaign is live.
const CAMPAIGN_ID = '52571401069976'; // "Flash Booked Ireland Lead forms"
const CAMPAIGN_LAUNCH_DATE = '2026-08-31';

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = 'M8E6rSDwYijkpGWK1AWR'; // FlashBooked — same location lead.js/book-discovery-call.js write to
const GHL_PIPELINE_ID = 'w611GWtjqoj03tK8uYgC'; // "Master Pipeline"
const GHL_WON_STAGE_ID = '52eac318-5157-4711-957b-52f680e005a9'; // "💰 Won"
const GHL_LOST_STAGE_ID = 'af84d738-f769-4bff-8f71-388e25ffba53'; // "🥦 Lost (Not Sold)"

// Master Pipeline's full stage list (fetched 2026-09-04 via GET /opportunities/pipelines) —
// a two-call sales process, Discovery Call (DC) then Strategy Call (SC), before Won/Lost.
const STAGE_DC_UPCOMING = '73f0587c-1d51-4e41-b070-f1eeb016cb0c'; // "📞 DC: Upcoming"
const STAGE_DC_CANCELLED = '59c5b2d1-dc45-4e29-87ac-9bb4447b12ba'; // "❌ DC: Cancelled"
const STAGE_DC_NO_SHOW = '3adb4b6b-6d26-497d-b781-d8561c708a52'; // "👻 DC: No Show"
const STAGE_DC_FOLLOW_UP = '27118d50-4111-495b-8f64-25e97e1ea6d4'; // "💲 DC: Follow Up"
const STAGE_SC_UPCOMING = 'f09360c1-a210-4fff-8630-5103db20e28e'; // "📞 SC: Upcoming"
const STAGE_SC_CANCELLED = '1c053852-b049-49d1-a171-57de75284de4'; // "❌ SC: Cancelled"
const STAGE_SC_NO_SHOW = 'd45b407a-d836-40c1-9ebf-7da1543a0b6a'; // "👻 SC: No Show"
const STAGE_SC_FOLLOW_UP = '6314c5a6-4ad0-4935-94e5-0aaff362ff0c'; // "💲 SC: Follow Up"

// Adam's stated funnel (2026-09-04) is 3 stages — booked call → show → close — simpler than
// the real two-call DC-then-SC pipeline above. Collapsing DC and SC together to match that:
// any of these means a Discovery Call was booked at some point. GHL's API only exposes an
// opportunity's *current* stage, not its history, so a lead already further along (e.g. at
// SC: Upcoming) still counts here, since forward-only pipeline progression means it must have
// passed through DC: Upcoming to get there.
const BOOKED_CALL_STAGES = new Set([
  STAGE_DC_UPCOMING, STAGE_DC_CANCELLED, STAGE_DC_NO_SHOW, STAGE_DC_FOLLOW_UP,
  STAGE_SC_UPCOMING, STAGE_SC_CANCELLED, STAGE_SC_NO_SHOW, STAGE_SC_FOLLOW_UP,
  GHL_WON_STAGE_ID, GHL_LOST_STAGE_ID,
]);
// A booked call whose outcome is already known — excludes DC: Upcoming, which just means a
// call is scheduled and hasn't happened yet, so it can't be scored as shown/no-show/cancelled.
const RESOLVED_CALL_STAGES = new Set([
  STAGE_DC_CANCELLED, STAGE_DC_NO_SHOW, STAGE_DC_FOLLOW_UP,
  STAGE_SC_UPCOMING, STAGE_SC_CANCELLED, STAGE_SC_NO_SHOW, STAGE_SC_FOLLOW_UP,
  GHL_WON_STAGE_ID, GHL_LOST_STAGE_ID,
]);
const NO_SHOW_STAGES = new Set([STAGE_DC_NO_SHOW, STAGE_SC_NO_SHOW]);
const CANCELLED_STAGES = new Set([STAGE_DC_CANCELLED, STAGE_SC_CANCELLED]);

// Kept for the per-ad kill/scale spend-threshold rule (verdictForAd) — unrelated to the old
// CPL/close-rate target model retired 2026-09-04 in favor of FUNNEL_TARGETS below.
const SPEND_MULTIPLIER_MIN = 2;
const SPEND_MULTIPLIER_MAX = 3;
const FALLBACK_CAD_TO_EUR = 0.62; // used only if the live FX lookup fails
const LEAD_TARGET_MIN = 10;
const LEAD_TARGET_MAX = 15;

// Ad-level CPL reference points, replacing the old flat €99 target — top of Adam's "ideal"
// CPL band (promising) and his own "Bad: €80+ CPL" line (kill threshold).
const AD_CPL_IDEAL_MAX_EUR = 60;
const AD_CPL_BAD_EUR = 80;

// Campaign-level funnel KPI targets for native Lead Form campaigns, from Adam's own benchmarks
// (2026-09-04) for this funnel: Ad → Instant Form → Lead → AI call/SMS → Booked call (DC:
// Upcoming+) → Show → Closed (Won). CPL alone is misleading for Instant Forms (can look cheap
// while unqualified), so it's always read together with the booked-call rate.
const FUNNEL_TARGETS = {
  ctrPctMin: 2, // 2%+
  cpcEurMax: 3, // < €2–3
  cplEurMin: 30, cplEurMax: 60, // €30–60 ideal
  bookedCallRatePctMin: 30, bookedCallRatePctMax: 50, // qualified/booked lead rate
  showRatePctMin: 65, showRatePctMax: 80,
  closeRatePctMin: 20, closeRatePctMax: 30, // of those who showed, % that close
  cacEurMax: 500, // spend per Won client
  costPerBookedCallEurMin: 150, costPerBookedCallEurMax: 200, // north-star once the AI caller is live
};

// Adam's own Great/Fine/Weak/Bad bands (2026-09-04) for judging an Instant Form campaign —
// weighs CPL together with the booked-call rate (the earliest available proxy for lead
// quality, before enough calls have happened to score show/close rates directly).
function campaignHealthVerdict(cplEur, bookedCallRatePct) {
  if (cplEur == null || bookedCallRatePct == null) return null;
  if (cplEur <= 50 && bookedCallRatePct >= 40) return { code: 'great', label: 'Great' };
  if (bookedCallRatePct < 20) return { code: 'weak', label: 'Weak — cheap leads, low qualification' };
  if (cplEur >= AD_CPL_BAD_EUR && bookedCallRatePct < 25) return { code: 'bad', label: 'Bad' };
  return { code: 'fine', label: 'Fine' };
}

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

function actionValue(actions, type) {
  const entry = (actions || []).find(a => a.action_type === type);
  return entry ? Number(entry.value) : 0;
}

// FlashBooked's booking page passes the Meta ad_id through as the utm_content param, and GHL
// records it per-opportunity in `attributions[]`. Prefers the last-touch attribution (closest
// to when the opportunity was actually created) so a contact who first arrived via one ad but
// booked from a retargeting/direct visit attributes to the touch that actually converted them.
function adIdFromOpportunity(opp) {
  const attrs = opp.attributions || [];
  const last = attrs.find(a => a.isLast && a.utmContent);
  if (last) return last.utmContent;
  const withContent = attrs.find(a => a.utmContent);
  return withContent ? withContent.utmContent : null;
}

// Won/Lost counts per Meta ad_id, from FlashBooked's GHL pipeline — cross-references actual
// signed clients against ad spend, not just booked-a-call leads. Only counts opportunities
// whose attributed ad_id is one we recognize from this campaign's own ad list, so leads from
// other sources (organic, referrals, other campaigns) don't get mixed in. Returns null (not an
// empty map) if GHL isn't reachable, so callers can tell "no signed leads" apart from "couldn't check".
//
// `nameToId` is a fallback: two ads (13, 15) briefly had their utm_content tag misconfigured
// to pass the ad's *name* instead of its numeric id (fixed 2026-08-26 by swapping both ads to
// a corrected creative) — leads captured during that window still have the ad name in
// utmContent, not the id, so they'd otherwise never match `knownAdIds`.
//
// Confirmed 2026-09-04: contacts synced in via GHL's native Meta Lead Form integration
// (source "Meta Lead Form") carry no `attributions[]` at all, unlike the pixel/booking-page
// flow — so they can never match an ad_id here. Rather than silently dropping real leads
// from the campaign total just because we can't tell which ad drove them, anything tagged
// UNATTRIBUTED_LEAD_TAG (applied by the lead-capture automation itself, independent of
// attribution) still counts toward the total, bucketed separately from the per-ad breakdown.
const UNATTRIBUTED_LEAD_TAG = 'flashbooked ireland lead';

async function fetchSignedLeadsByAdId(knownAdIds, nameToId) {
  const pit = process.env.GHL_PIT_FLASHBOOKED;
  if (!pit) return null;

  try {
    // Single page (limit 100) — FlashBooked's whole pipeline is a handful of opportunities
    // right now; revisit with real pagination if volume grows past that.
    const res = await fetch(
      `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${GHL_PIPELINE_ID}&limit=100`,
      { headers: { Authorization: `Bearer ${pit}`, Version: '2021-07-28' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const opps = data.opportunities || [];

    const byAdId = {};
    const unattributed = { total: 0, won: 0, lost: 0 };
    // Funnel counts span every campaign lead (attributed or not) — the funnel is about the
    // campaign as a whole, not per-ad, so it doesn't need the ad_id match that byAdId/
    // unattributed do.
    const funnel = { leads: 0, bookedCall: 0, resolved: 0, showed: 0, won: 0 };
    for (const opp of opps) {
      let adId = adIdFromOpportunity(opp);
      if (adId && !knownAdIds.has(adId) && nameToId[adId]) adId = nameToId[adId];
      const isAttributed = adId && knownAdIds.has(adId);
      const tags = opp.contact?.tags || [];
      const isUnattributedCampaignLead = !isAttributed && tags.includes(UNATTRIBUTED_LEAD_TAG);
      if (!isAttributed && !isUnattributedCampaignLead) continue;

      if (isAttributed) {
        if (!byAdId[adId]) byAdId[adId] = { total: 0, won: 0, lost: 0 };
        byAdId[adId].total += 1;
        if (opp.pipelineStageId === GHL_WON_STAGE_ID) byAdId[adId].won += 1;
        else if (opp.pipelineStageId === GHL_LOST_STAGE_ID) byAdId[adId].lost += 1;
      } else {
        unattributed.total += 1;
        if (opp.pipelineStageId === GHL_WON_STAGE_ID) unattributed.won += 1;
        else if (opp.pipelineStageId === GHL_LOST_STAGE_ID) unattributed.lost += 1;
      }

      funnel.leads += 1;
      const stage = opp.pipelineStageId;
      if (BOOKED_CALL_STAGES.has(stage)) {
        funnel.bookedCall += 1;
        if (RESOLVED_CALL_STAGES.has(stage)) {
          funnel.resolved += 1;
          if (!NO_SHOW_STAGES.has(stage) && !CANCELLED_STAGES.has(stage)) funnel.showed += 1;
        }
      }
      if (stage === GHL_WON_STAGE_ID) funnel.won += 1;
    }
    return { byAdId, unattributed, funnel };
  } catch (_) {
    return null;
  }
}

// Applies the 5-rule kill framework at the individual-ad level. Only flags a hard "kill"
// verdict when a rule's own data requirement is actually met (e.g. won't call CTR too low
// off a handful of impressions) — otherwise reports why it's too early to judge.
function verdictForAd({ status, spendEur, impressions, ctr, frequency, leads, cplEur, spend3dNative, adCplBadEur, adCplIdealMaxEur, spendThresholdMinEur }) {
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
  if (spendEur >= spendThresholdMinEur && leads > 0 && cplEur > adCplBadEur) {
    return { code: 'kill-over-target', label: 'Kill — CPL in the "Bad" range', reason: `€${cplEur.toFixed(0)} cost/lead vs the €${adCplBadEur}+ "Bad" line, after spending past the 2x review threshold.` };
  }
  if (spendEur >= spendThresholdMinEur && leads === 0) {
    return { code: 'kill-no-leads', label: 'Kill — no leads after 2x spend', reason: `€${spendEur.toFixed(0)} spent (past the 2x review threshold) with zero leads.` };
  }
  // Rule 4 (CTR down 30% over 2 weeks) needs daily history this endpoint doesn't pull, and
  // can't apply before the campaign itself is 2 weeks old anyway — surfaced via adKillRules.note
  // in the response instead of a per-ad check.
  if (leads > 0 && cplEur != null && cplEur <= adCplIdealMaxEur) {
    return { code: 'promising', label: 'Promising — CPL in the ideal range', reason: `€${cplEur.toFixed(0)} cost/lead, at or under the €${adCplIdealMaxEur} ideal-band top — small sample, and CPL alone isn't enough for Instant Forms; check booked-call rate too before scaling.` };
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
    const [account, campaignInsightsRes, adsetInsightsRes, adInsightsRes, adInsights3dRes, adInsightsDailyRes, adsListRes, cadToEur] = await Promise.all([
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
        fields: 'ad_id,ad_name,adset_name,spend,impressions,clicks,ctr,cpc,frequency,actions',
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
      // Per-day spend per ad, just to find each ad's first day with real delivery — Meta has
      // no direct "first spend date" field, and lifetime totals alone can't tell a 9-day-old
      // ad from one that started 2 days ago (see 2026-08-25 memory note on this exact mixup).
      metaGet(`/${CAMPAIGN_ID}/insights`, {
        level: 'ad',
        fields: 'ad_id,spend',
        time_increment: 1,
        date_preset: 'maximum',
        // Default page size (25) silently truncates this — up to ~17 ads x growing day count
        // needs headroom well past that, or most ads' rows just never arrive (confirmed live:
        // 25 rows back covering only 10 of 17 ad_ids, all misreported as no first-spend date).
        limit: 1000,
      }),
      metaGet(`/${CAMPAIGN_ID}/ads`, { fields: 'id,name,effective_status', limit: 100 }),
      fetchCadToEurRate(),
    ]);

    const firstSpendDateByAdId = {};
    for (const row of (adInsightsDailyRes.data || [])) {
      if (Number(row.spend || 0) <= 0) continue;
      const existing = firstSpendDateByAdId[row.ad_id];
      if (!existing || row.date_start < existing) firstSpendDateByAdId[row.ad_id] = row.date_start;
    }

    const knownAdIds = new Set((adInsightsRes.data || []).map(a => a.ad_id));
    const nameToId = Object.fromEntries((adInsightsRes.data || []).map(a => [a.ad_name, a.ad_id]));
    const signedResult = await fetchSignedLeadsByAdId(knownAdIds, nameToId);
    const signedByAdId = signedResult ? signedResult.byAdId : null;
    const unattributedLeads = signedResult ? signedResult.unattributed : null;
    const funnelCounts = signedResult ? signedResult.funnel : null;
    // GHL's pipeline is ground truth once an ad's utm_content is attributing correctly — Meta's
    // own pixel count can overcount (confirmed 2026-08-26: Ad 13/15's misconfigured utm_content
    // tag correlated with ~4 duplicate "Schedule" pixel fires that were never real distinct
    // bookings — see project_flashbooked_new_company memory). Once GHL is reachable, every
    // "leads" figure below — per ad, per ad set, and campaign total — is the verified GHL
    // opportunity count, not the raw pixel number. Falls back to the pixel count only if GHL
    // can't be reached at all, so the dashboard never just goes blank.
    const leadsSource = signedByAdId ? 'ghl-verified' : 'meta-pixel-fallback';

    const totals = campaignInsightsRes.data?.[0] || {};
    const spendNative = Number(totals.spend || 0);
    const leadsMetaPixel = leadsFromActions(totals.actions);
    const spendEur = spendNative * cadToEur;

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
      const metaPixelLeads = leadsFromActions(a.actions);
      const signed = signedByAdId ? (signedByAdId[a.ad_id] || { total: 0, won: 0, lost: 0 }) : null;
      // Verified (GHL) count wins whenever it's available — see leadsSource note above. A GHL
      // opportunity can lag a few minutes behind the pixel firing (webhook sync delay), so this
      // can very briefly under-count a just-this-second booking; that's a far safer failure mode
      // than the duplicate-pixel overcounting it replaces.
      const l = signed ? signed.total : metaPixelLeads;
      const sEur = s * cadToEur;
      const cpl = l > 0 ? sEur / l : null;
      const ctrVal = a.ctr ? Number(a.ctr) : 0;
      const freqVal = a.frequency ? Number(a.frequency) : 0;
      const status = statusByAdId[a.ad_id] || null;
      const spend3d = spend3dByAdId[a.ad_id] ?? s; // fall back to lifetime if not in the 3d window at all

      const firstSpendDate = firstSpendDateByAdId[a.ad_id] || null;
      const daysRunning = firstSpendDate
        ? Math.max(1, Math.round((Date.now() - new Date(firstSpendDate).getTime()) / 86400000))
        : null;

      const linkClicks = actionValue(a.actions, 'link_click');
      const landingPageViews = actionValue(a.actions, 'landing_page_view');
      const arrivalRatePct = linkClicks > 0 ? (landingPageViews / linkClicks) * 100 : null;

      const verdict = verdictForAd({
        status,
        spendEur: sEur,
        impressions: Number(a.impressions || 0),
        ctr: ctrVal,
        frequency: freqVal,
        leads: l,
        cplEur: cpl,
        spend3dNative: spend3d,
        adCplBadEur: AD_CPL_BAD_EUR,
        adCplIdealMaxEur: AD_CPL_IDEAL_MAX_EUR,
        spendThresholdMinEur: AD_CPL_BAD_EUR * SPEND_MULTIPLIER_MIN,
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
        leads_meta_pixel: metaPixelLeads,
        cpl_eur: cpl != null ? Math.round(cpl * 100) / 100 : null,
        impressions: Number(a.impressions || 0),
        clicks: Number(a.clicks || 0),
        ctr: a.ctr ? Number(a.ctr) : null,
        cpc_native: a.cpc ? Number(a.cpc) : null,
        frequency: a.frequency ? Number(a.frequency) : null,
        firstSpendDate,
        daysRunning,
        landingPageViews,
        arrivalRatePct: arrivalRatePct != null ? Math.round(arrivalRatePct * 10) / 10 : null,
        signedLeads: signed ? signed.won : null,
        lostLeads: signed ? signed.lost : null,
        pipelineLeads: signed ? signed.total : null,
        verdict,
      };
    }).sort((x, y) => y.spend_native - x.spend_native);

    // Ad-set and campaign-level "leads" are sums of the verified per-ad counts above, not a
    // second independent Meta pixel query — keeps every number on the page internally
    // consistent instead of two different sources of truth silently disagreeing.
    const leadsByAdsetName = {};
    for (const a of ads) leadsByAdsetName[a.adsetName] = (leadsByAdsetName[a.adsetName] || 0) + a.leads;

    const adsets = (adsetInsightsRes.data || []).map(a => {
      const s = Number(a.spend || 0);
      const l = leadsByAdsetName[a.adset_name] || 0;
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

    const leads = ads.reduce((sum, a) => sum + a.leads, 0) + (unattributedLeads?.total || 0);
    const cplNativeVal = leads > 0 ? spendNative / leads : null;
    const cplEurVal = leads > 0 ? spendEur / leads : null;

    const leadsPerDay = leads / daysLive;
    const leadsNeeded = Math.max(0, LEAD_TARGET_MIN - leads);
    const daysToMinLeadTarget = leadsPerDay > 0 ? Math.ceil(leadsNeeded / leadsPerDay) : null;
    const estReadyDate = daysToMinLeadTarget != null
      ? new Date(Date.now() + daysToMinLeadTarget * 86400000).toISOString().slice(0, 10)
      : null;

    const spendThresholdMinEur = AD_CPL_BAD_EUR * SPEND_MULTIPLIER_MIN;
    const spendThresholdMaxEur = AD_CPL_BAD_EUR * SPEND_MULTIPLIER_MAX;
    const pastSpendThreshold = spendEur >= spendThresholdMinEur;
    const sampleTrustworthy = leads >= LEAD_TARGET_MIN;

    const bookedCall = funnelCounts?.bookedCall || 0;
    const resolved = funnelCounts?.resolved || 0;
    const showed = funnelCounts?.showed || 0;
    const won = funnelCounts?.won || 0;
    const bookedCallRatePct = leads > 0 ? (bookedCall / leads) * 100 : null;
    const showRatePct = resolved > 0 ? (showed / resolved) * 100 : null;
    const closeRatePct = showed > 0 ? (won / showed) * 100 : null;
    const cacEur = won > 0 ? spendEur / won : null;
    const costPerBookedCallEur = bookedCall > 0 ? spendEur / bookedCall : null;

    const healthVerdict = sampleTrustworthy
      ? campaignHealthVerdict(cplEurVal, bookedCallRatePct)
      : null;
    const verdict = healthVerdict ? healthVerdict.code : 'gathering-data';

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      campaign: {
        name: 'Flash Booked Ireland Lead forms',
        id: CAMPAIGN_ID,
        launchDate: CAMPAIGN_LAUNCH_DATE,
        daysLive,
      },
      account: { name: account.name, currency: account.currency },
      fx: { cadToEur: Math.round(cadToEur * 10000) / 10000 },
      targets: {
        ...FUNNEL_TARGETS,
        adCplIdealMaxEur: AD_CPL_IDEAL_MAX_EUR,
        adCplBadEur: AD_CPL_BAD_EUR,
        leadTargetMin: LEAD_TARGET_MIN,
        leadTargetMax: LEAD_TARGET_MAX,
        spendThresholdMinEur: Math.round(spendThresholdMinEur * 100) / 100,
        spendThresholdMaxEur: Math.round(spendThresholdMaxEur * 100) / 100,
      },
      totals: {
        spend_native: Math.round(spendNative * 100) / 100,
        spend_eur: Math.round(spendEur * 100) / 100,
        leads,
        leads_meta_pixel: leadsMetaPixel,
        cpl_native: cplNativeVal != null ? Math.round(cplNativeVal * 100) / 100 : null,
        cpl_eur: cplEurVal != null ? Math.round(cplEurVal * 100) / 100 : null,
        impressions: Number(totals.impressions || 0),
        clicks: Number(totals.clicks || 0),
        ctr: totals.ctr ? Number(totals.ctr) : null,
        cpc_native: totals.cpc ? Number(totals.cpc) : null,
        frequency: totals.frequency ? Number(totals.frequency) : null,
        signedLeads: signedByAdId
          ? ads.reduce((sum, a) => sum + (a.signedLeads || 0), 0) + (unattributedLeads?.won || 0)
          : null,
        unattributed_leads: unattributedLeads?.total || 0,
      },
      ghl: { attributionAvailable: signedByAdId != null },
      leadsSource,
      progress: {
        leadsSoFar: leads,
        leadsNeededForMinSample: leadsNeeded,
        sampleTrustworthy,
        pastSpendThreshold,
        leadsPerDay: Math.round(leadsPerDay * 1000) / 1000,
        estDaysToMinLeadTarget: daysToMinLeadTarget,
        estReadyDate,
      },
      funnel: {
        leads,
        bookedCall,
        bookedCallRatePct: bookedCallRatePct != null ? Math.round(bookedCallRatePct * 10) / 10 : null,
        resolved,
        showed,
        showRatePct: showRatePct != null ? Math.round(showRatePct * 10) / 10 : null,
        won,
        closeRatePct: closeRatePct != null ? Math.round(closeRatePct * 10) / 10 : null,
        cacEur: cacEur != null ? Math.round(cacEur * 100) / 100 : null,
        costPerBookedCallEur: costPerBookedCallEur != null ? Math.round(costPerBookedCallEur * 100) / 100 : null,
      },
      verdict,
      verdictLabel: healthVerdict ? healthVerdict.label : 'Gathering data',
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
