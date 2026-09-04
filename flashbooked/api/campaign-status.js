// GET /api/campaign-status
//   — Tracks the "Flash Booked Ireland Lead forms" Meta campaign against a funnel-stage KPI
//     framework (set 2026-09-04, revised same day after live testing — see FUNNEL_TARGETS,
//     AD_CPL_*_CAD, and campaignHealthVerdict below), not a flat CPL target. CPL alone is
//     misleading for a 2-question Instant Form (just "what business" + "what are you
//     struggling with") — it can look great while the leads are junk. So every CPL number is
//     read alongside qualified rate and booked-call rate, in Adam's stated priority order:
//     qualified leads > booked calls > CPL > CTR > frequency. Qualification uses FlashBooked's
//     real GHL pipeline stages (Leads: New → Convo: Responded → Qualified/Disqualified → DC:
//     Upcoming → ... → SC: Upcoming → ... → Won/Lost) — "Qualified" is a dedicated stage Adam
//     added 2026-09-04 specifically to give lead quality a positive signal, not just the
//     pre-existing negative one ("Disqualified"). Read-only. Pulls live from the Graph API
//     using the same META_SYSTEM_TOKEN already used by capi.js. Ad account is CAD-denominated;
//     every target here is CAD-native (no EUR conversion) since that's what spend is actually
//     billed in — EUR fields in the response are informational only.
//
//   Also breaks down to individual-ad level and applies kill/scale rules of thumb (spend
//   threshold before judging a bad CPL or zero leads, a CTR floor, a lead-quality floor, and a
//   booked-call-rate floor) so specific underperforming creatives can be spotted, not just
//   whole ad sets. Frequency is NOT an automatic kill trigger (Adam's correction 2026-09-04) —
//   it's only meaningful alongside a rising-CPL/falling-CTR trend, which needs daily history
//   this endpoint doesn't fetch, so it's surfaced as informational only.

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
// a two-call sales process, Discovery Call (DC) then Strategy Call (SC), before Won/Lost. The
// "Qualified" stage was added by Adam 2026-09-04, specifically so lead quality (his own
// definition: Irish trade/home-service business + real problem FlashBooked solves + capacity/
// willingness to take on more work) has a positive signal to land on — before that, only a
// *negative* signal existed ("Disqualified"), so a lead nobody had reviewed yet was
// indistinguishable from one that had been actively judged good.
const STAGE_QUALIFIED = '817f8775-cdf4-489e-a24d-8fcc3418deaa'; // "👍 Qualified"
const STAGE_DISQUALIFIED = '21e81cb3-d1eb-43b7-bb62-8ad6845f6555'; // "👎 Disqualified"
const STAGE_DC_UPCOMING = '73f0587c-1d51-4e41-b070-f1eeb016cb0c'; // "📞 DC: Upcoming"
const STAGE_DC_CANCELLED = '59c5b2d1-dc45-4e29-87ac-9bb4447b12ba'; // "❌ DC: Cancelled"
const STAGE_DC_NO_SHOW = '3adb4b6b-6d26-497d-b781-d8561c708a52'; // "👻 DC: No Show"
const STAGE_DC_FOLLOW_UP = '27118d50-4111-495b-8f64-25e97e1ea6d4'; // "💲 DC: Follow Up"
const STAGE_SC_UPCOMING = 'f09360c1-a210-4fff-8630-5103db20e28e'; // "📞 SC: Upcoming"
const STAGE_SC_CANCELLED = '1c053852-b049-49d1-a171-57de75284de4'; // "❌ SC: Cancelled"
const STAGE_SC_NO_SHOW = 'd45b407a-d836-40c1-9ebf-7da1543a0b6a'; // "👻 SC: No Show"
const STAGE_SC_FOLLOW_UP = '6314c5a6-4ad0-4935-94e5-0aaff362ff0c'; // "💲 SC: Follow Up"

// Anything other than "still sitting untouched" — i.e. someone has actually looked at this
// lead and made a qualify/disqualify call, whether or not it's gone further since.
const REVIEWED_STAGES = new Set([
  STAGE_QUALIFIED, STAGE_DISQUALIFIED,
  STAGE_DC_UPCOMING, STAGE_DC_CANCELLED, STAGE_DC_NO_SHOW, STAGE_DC_FOLLOW_UP,
  STAGE_SC_UPCOMING, STAGE_SC_CANCELLED, STAGE_SC_NO_SHOW, STAGE_SC_FOLLOW_UP,
  GHL_WON_STAGE_ID, GHL_LOST_STAGE_ID,
]);
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

const FALLBACK_CAD_TO_EUR = 0.62; // used only if the live FX lookup fails; spend/CPL EUR fields
                                   // are informational only now — every target below is CAD-native
const LEAD_TARGET_MIN = 10;
const LEAD_TARGET_MAX = 15;

// Below this many leads/reviewed-leads, the quality/booking-rate kill rules don't fire — no
// hard number was given for "once you've got enough leads," so this is a judgment call, easy
// to raise once real volume shows up.
const MIN_SAMPLE_FOR_QUALITY_RULES = 5;

// CAD-native CPL bands (2026-09-04) for FlashBooked's specific 2-question Instant Form (just
// "what business are you in" + "what are you struggling with") — reset lower than the general
// lead-forms guidance because that low friction should produce a cheaper CPL, which raises the
// bar on lead quality mattering even more. Replaces the earlier EUR ideal-band/bad-line
// constants entirely; spend is CAD-native so there's no FX conversion needed for these checks.
const AD_CPL_GREAT_MAX_CAD = 40;
const AD_CPL_GOOD_MAX_CAD = 55;
const AD_CPL_ACCEPTABLE_MAX_CAD = 70; // "Bad" is anything above this
const AD_SPEND_KILL_THRESHOLD_CAD = 130; // ~midpoint of Adam's "roughly CA$120–140"
const AD_CTR_KILL_PCT = 0.7; // lead-form-specific — loosened from the 0.5% general-ads figure
const QUALIFIED_RATE_KILL_PCT = 25; // below this % of *reviewed* leads qualified → kill
const BOOKED_CALL_RATE_KILL_PCT = 25; // below this % of leads booking a call → kill
// Frequency (3.5+) is deliberately NOT an automatic kill signal — Adam's correction 2026-09-04:
// it only matters alongside CPL rising or CTR/conversions falling, which needs a spend/CTR
// trend this endpoint doesn't track daily. Still shown as a column in the ads table so it can
// be eyeballed against the CPL/CTR columns next to it.

// Campaign-level funnel KPI targets for native Lead Form campaigns. CPL alone is misleading for
// Instant Forms (can look cheap while unqualified), so it's always read alongside qualified
// rate and booked-call rate — Adam's stated priority: qualified leads > booked calls > CPL >
// CTR > frequency.
const FUNNEL_TARGETS = {
  ctrKillPct: AD_CTR_KILL_PCT,
  cpcCadMax: 3,
  cplGreatMaxCad: AD_CPL_GREAT_MAX_CAD,
  cplGoodMaxCad: AD_CPL_GOOD_MAX_CAD,
  cplAcceptableMaxCad: AD_CPL_ACCEPTABLE_MAX_CAD,
  qualifiedRateKillPct: QUALIFIED_RATE_KILL_PCT,
  bookedCallRateKillPct: BOOKED_CALL_RATE_KILL_PCT,
  showRatePctMin: 65, showRatePctMax: 80,
  closeRatePctMin: 20, closeRatePctMax: 30, // of those who showed, % that close
  cacCadMax: 500, // spend per Won client — TODO: revisit in CAD terms, currently a placeholder carried over from the EUR-era target
  costPerBookedCallCadMin: 150, costPerBookedCallCadMax: 200, // north-star once the AI caller is live
};

// Adam's Great/Good/Acceptable/Bad bands (2026-09-04), weighted by his stated priority order —
// qualified rate and booked-call rate override CPL, since a cheap CPL with bad lead quality is
// worse than a pricier CPL with good quality.
function campaignHealthVerdict(cplCad, qualifiedRatePct, bookedCallRatePct) {
  if (qualifiedRatePct != null && qualifiedRatePct < QUALIFIED_RATE_KILL_PCT) {
    return { code: 'bad', label: 'Bad — low lead quality' };
  }
  if (bookedCallRatePct != null && bookedCallRatePct < BOOKED_CALL_RATE_KILL_PCT) {
    return { code: 'bad', label: 'Bad — low booking rate' };
  }
  if (cplCad == null) return null;
  if (cplCad <= AD_CPL_GREAT_MAX_CAD) return { code: 'great', label: 'Great' };
  if (cplCad <= AD_CPL_GOOD_MAX_CAD) return { code: 'good', label: 'Good' };
  if (cplCad <= AD_CPL_ACCEPTABLE_MAX_CAD) return { code: 'acceptable', label: 'Acceptable' };
  return { code: 'bad', label: 'Bad — CPL over target' };
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

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits ? digits.slice(-9) : null; // last 9 digits — robust to +353/0/00 prefix differences
}

// Meta's own Lead Ads data is the authoritative source for which ad a native Lead Form
// submission came from — more reliable than GHL's attributions[] field, which is confirmed
// (2026-09-04, cross-checked against Meta's own Leads Centre by Adam) to sometimes be flat
// missing and sometimes just wrong for these leads. Fetched per-ad via Graph API's leads edge
// and matched to GHL contacts by phone first, falling back to email — confirmed live
// (2026-09-04) that at least one of this campaign's forms doesn't collect a phone number at
// all, so a lead can have neither a GHL attribution nor a phone to match on, but every form
// here does collect email. Returns {} maps (not null) on any failure — including missing
// `leads_retrieval` permission on META_SYSTEM_TOKEN — so callers fall back to GHL-only
// attribution rather than breaking.
async function fetchNativeLeadAdIdMaps(adIds) {
  const phoneToAdId = {};
  const emailToAdId = {};
  try {
    const results = await Promise.all(
      adIds.map(id => metaGet(`/${id}/leads`, { fields: 'field_data' }).catch(() => ({ data: [] })))
    );
    adIds.forEach((adId, i) => {
      for (const lead of (results[i].data || [])) {
        const fields = lead.field_data || [];
        const phoneField = fields.find(f => /phone/i.test(f.name));
        const phone = phoneField?.values?.[0] ? normalizePhone(phoneField.values[0]) : null;
        if (phone) phoneToAdId[phone] = adId;
        const emailField = fields.find(f => /email/i.test(f.name));
        const email = emailField?.values?.[0] ? String(emailField.values[0]).trim().toLowerCase() : null;
        if (email) emailToAdId[email] = adId;
      }
    });
  } catch (_) { /* leave maps empty */ }
  return { phoneToAdId, emailToAdId };
}

async function fetchSignedLeadsByAdId(knownAdIds, nameToId, phoneToAdId, emailToAdId) {
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

    const emptyBucket = () => ({
      total: 0, won: 0, lost: 0,
      reviewed: 0, qualified: 0, disqualified: 0,
      bookedCall: 0, resolved: 0, showed: 0,
    });
    // Mutates `bucket` with this opportunity's stage — shared by the per-ad, unattributed, and
    // campaign-wide funnel tallies so the three can't drift out of sync with each other.
    function tally(bucket, stage) {
      bucket.total += 1;
      if (stage === GHL_WON_STAGE_ID) bucket.won += 1;
      else if (stage === GHL_LOST_STAGE_ID) bucket.lost += 1;
      if (REVIEWED_STAGES.has(stage)) {
        bucket.reviewed += 1;
        if (stage === STAGE_DISQUALIFIED) bucket.disqualified += 1;
        else bucket.qualified += 1;
      }
      if (BOOKED_CALL_STAGES.has(stage)) {
        bucket.bookedCall += 1;
        if (RESOLVED_CALL_STAGES.has(stage)) {
          bucket.resolved += 1;
          if (!NO_SHOW_STAGES.has(stage) && !CANCELLED_STAGES.has(stage)) bucket.showed += 1;
        }
      }
    }

    const byAdId = {};
    const unattributed = emptyBucket();
    const funnel = emptyBucket();
    for (const opp of opps) {
      let adId = adIdFromOpportunity(opp);
      if (adId && !knownAdIds.has(adId) && nameToId[adId]) adId = nameToId[adId];
      if (!adId || !knownAdIds.has(adId)) {
        // GHL had no (or no valid) attribution — fall back to Meta's own lead-to-ad match by
        // phone, then email, before giving up to the unattributed bucket.
        const phone = normalizePhone(opp.contact?.phone);
        const email = opp.contact?.email ? String(opp.contact.email).trim().toLowerCase() : null;
        if (phone && phoneToAdId[phone]) adId = phoneToAdId[phone];
        else if (email && emailToAdId[email]) adId = emailToAdId[email];
      }
      const isAttributed = adId && knownAdIds.has(adId);
      const tags = opp.contact?.tags || [];
      const isUnattributedCampaignLead = !isAttributed && tags.includes(UNATTRIBUTED_LEAD_TAG);
      if (!isAttributed && !isUnattributedCampaignLead) continue;

      const stage = opp.pipelineStageId;
      if (isAttributed) {
        if (!byAdId[adId]) byAdId[adId] = emptyBucket();
        tally(byAdId[adId], stage);
      } else {
        tally(unattributed, stage);
      }
      tally(funnel, stage);
    }
    return { byAdId, unattributed, funnel };
  } catch (_) {
    return null;
  }
}

// Applies Adam's kill framework (revised 2026-09-04) at the individual-ad level, in his stated
// priority order — qualified rate > booked-call rate > CPL > CTR > frequency. Only flags a hard
// "kill" verdict when a rule's own data requirement is actually met (e.g. won't call CTR too
// low off a handful of impressions, or quality/booking rate off a couple of leads) — otherwise
// reports why it's too early to judge. Frequency is deliberately NOT a kill trigger here — see
// the comment on AD_CTR_KILL_PCT above for why.
function verdictForAd({ status, spendNative, impressions, ctr, leads, cplNative, spend3dNative, reviewed, qualified, bookedCall }) {
  if (status && status !== 'ACTIVE') return { code: 'paused', label: 'Paused' };

  if (spend3dNative <= 0) {
    return { code: 'kill-no-recent-spend', label: 'Kill — no spend in 72h', reason: 'Delivery has stopped (low relevance, budget-starved, or disapproved) — check Ads Manager for a delivery issue.' };
  }
  if (impressions >= 1000 && ctr < AD_CTR_KILL_PCT) {
    return { code: 'kill-low-ctr', label: `Kill — CTR under ${AD_CTR_KILL_PCT}%`, reason: `${ctr.toFixed(2)}% CTR on ${impressions.toLocaleString()} impressions — the hook isn't landing.` };
  }
  if (spendNative >= AD_SPEND_KILL_THRESHOLD_CAD && leads === 0) {
    return { code: 'kill-no-leads', label: 'Kill — no leads after spend threshold', reason: `CA$${spendNative.toFixed(0)} spent (past the CA$${AD_SPEND_KILL_THRESHOLD_CAD} review threshold) with zero leads.` };
  }
  if (spendNative >= AD_SPEND_KILL_THRESHOLD_CAD && leads > 0 && cplNative > AD_CPL_ACCEPTABLE_MAX_CAD) {
    return { code: 'kill-bad-cpl', label: 'Kill — CPL in the "Bad" range', reason: `CA$${cplNative.toFixed(0)} cost/lead vs the CA$${AD_CPL_ACCEPTABLE_MAX_CAD}+ "Bad" line, after spending past the CA$${AD_SPEND_KILL_THRESHOLD_CAD} review threshold.` };
  }
  if (reviewed >= MIN_SAMPLE_FOR_QUALITY_RULES) {
    const qualifiedRatePct = (qualified / reviewed) * 100;
    if (qualifiedRatePct < QUALIFIED_RATE_KILL_PCT) {
      return { code: 'kill-bad-quality', label: 'Kill — low lead quality', reason: `Only ${qualifiedRatePct.toFixed(0)}% of ${reviewed} reviewed leads qualified (business + real problem + capacity) — under the ${QUALIFIED_RATE_KILL_PCT}% floor.` };
    }
  }
  if (leads >= MIN_SAMPLE_FOR_QUALITY_RULES) {
    const bookedCallRatePct = (bookedCall / leads) * 100;
    if (bookedCallRatePct < BOOKED_CALL_RATE_KILL_PCT) {
      return { code: 'kill-bad-booking-rate', label: 'Kill — low booking rate', reason: `Only ${bookedCallRatePct.toFixed(0)}% of ${leads} leads booked a call — under the ${BOOKED_CALL_RATE_KILL_PCT}% floor.` };
    }
  }
  // Rule needing a CTR/CPL trend over daily history (down 30% over 2 weeks) can't be checked
  // here — surfaced via adKillRules.note in the response instead of a per-ad check.
  if (leads > 0 && cplNative != null) {
    if (cplNative <= AD_CPL_GREAT_MAX_CAD) return { code: 'great', label: 'Great — CPL in target range', reason: `CA$${cplNative.toFixed(0)} cost/lead — but check qualified/booked-call rate above before scaling; CPL alone can look great on unqualified leads.` };
    if (cplNative <= AD_CPL_GOOD_MAX_CAD) return { code: 'good', label: 'Good — CPL in target range', reason: `CA$${cplNative.toFixed(0)} cost/lead, in the CA$${AD_CPL_GOOD_MAX_CAD} "Good" band.` };
    if (cplNative <= AD_CPL_ACCEPTABLE_MAX_CAD) return { code: 'acceptable', label: 'Acceptable', reason: `CA$${cplNative.toFixed(0)} cost/lead, in the CA$${AD_CPL_ACCEPTABLE_MAX_CAD} "Acceptable" band — not bad enough to kill yet, not cheap enough to scale hard.` };
  }
  return { code: 'gathering-data', label: 'Gathering data', reason: 'Hasn’t hit any rule’s minimum data bar yet (spend, impressions, leads, or reviewed count) — too early to judge.' };
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
    const { phoneToAdId, emailToAdId } = await fetchNativeLeadAdIdMaps([...knownAdIds]);
    const signedResult = await fetchSignedLeadsByAdId(knownAdIds, nameToId, phoneToAdId, emailToAdId);
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

    const emptySignedBucket = { total: 0, won: 0, lost: 0, reviewed: 0, qualified: 0, disqualified: 0, bookedCall: 0, resolved: 0, showed: 0 };

    const ads = (adInsightsRes.data || []).map(a => {
      const s = Number(a.spend || 0);
      const metaPixelLeads = leadsFromActions(a.actions);
      const signed = signedByAdId ? (signedByAdId[a.ad_id] || emptySignedBucket) : null;
      // Verified (GHL) count wins whenever it's available — see leadsSource note above. A GHL
      // opportunity can lag a few minutes behind the pixel firing (webhook sync delay), so this
      // can very briefly under-count a just-this-second booking; that's a far safer failure mode
      // than the duplicate-pixel overcounting it replaces.
      const l = signed ? signed.total : metaPixelLeads;
      const sEur = s * cadToEur;
      const cpl = l > 0 ? s / l : null; // CAD-native — CPL targets are CAD, not EUR (see 2026-09-04 KPI rework)
      const cplEur = l > 0 ? sEur / l : null; // informational only
      const ctrVal = a.ctr ? Number(a.ctr) : 0;
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
        spendNative: s,
        impressions: Number(a.impressions || 0),
        ctr: ctrVal,
        leads: l,
        cplNative: cpl,
        spend3dNative: spend3d,
        reviewed: signed ? signed.reviewed : 0,
        qualified: signed ? signed.qualified : 0,
        bookedCall: signed ? signed.bookedCall : 0,
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
        cpl_native: cpl != null ? Math.round(cpl * 100) / 100 : null,
        cpl_eur: cplEur != null ? Math.round(cplEur * 100) / 100 : null,
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
        reviewedLeads: signed ? signed.reviewed : null,
        qualifiedLeads: signed ? signed.qualified : null,
        disqualifiedLeads: signed ? signed.disqualified : null,
        bookedCallLeads: signed ? signed.bookedCall : null,
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
    const cplNativeVal = leads > 0 ? spendNative / leads : null; // CAD-native — the number targets are judged against
    const cplEurVal = leads > 0 ? spendEur / leads : null; // informational only

    const leadsPerDay = leads / daysLive;
    const leadsNeeded = Math.max(0, LEAD_TARGET_MIN - leads);
    const daysToMinLeadTarget = leadsPerDay > 0 ? Math.ceil(leadsNeeded / leadsPerDay) : null;
    const estReadyDate = daysToMinLeadTarget != null
      ? new Date(Date.now() + daysToMinLeadTarget * 86400000).toISOString().slice(0, 10)
      : null;

    const pastSpendThreshold = spendNative >= AD_SPEND_KILL_THRESHOLD_CAD;
    const sampleTrustworthy = leads >= LEAD_TARGET_MIN;

    const reviewed = funnelCounts?.reviewed || 0;
    const qualified = funnelCounts?.qualified || 0;
    const disqualified = funnelCounts?.disqualified || 0;
    const bookedCall = funnelCounts?.bookedCall || 0;
    const resolved = funnelCounts?.resolved || 0;
    const showed = funnelCounts?.showed || 0;
    const won = funnelCounts?.won || 0;
    const qualifiedRatePct = reviewed > 0 ? (qualified / reviewed) * 100 : null;
    const bookedCallRatePct = leads > 0 ? (bookedCall / leads) * 100 : null;
    const showRatePct = resolved > 0 ? (showed / resolved) * 100 : null;
    const closeRatePct = showed > 0 ? (won / showed) * 100 : null;
    const cacNative = won > 0 ? spendNative / won : null;
    const costPerBookedCallNative = bookedCall > 0 ? spendNative / bookedCall : null;

    const healthVerdict = sampleTrustworthy
      ? campaignHealthVerdict(cplNativeVal, qualifiedRatePct, bookedCallRatePct)
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
        leadTargetMin: LEAD_TARGET_MIN,
        leadTargetMax: LEAD_TARGET_MAX,
        adSpendKillThresholdCad: AD_SPEND_KILL_THRESHOLD_CAD,
        minSampleForQualityRules: MIN_SAMPLE_FOR_QUALITY_RULES,
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
        reviewed,
        qualified,
        disqualified,
        qualifiedRatePct: qualifiedRatePct != null ? Math.round(qualifiedRatePct * 10) / 10 : null,
        bookedCall,
        bookedCallRatePct: bookedCallRatePct != null ? Math.round(bookedCallRatePct * 10) / 10 : null,
        resolved,
        showed,
        showRatePct: showRatePct != null ? Math.round(showRatePct * 10) / 10 : null,
        won,
        closeRatePct: closeRatePct != null ? Math.round(closeRatePct * 10) / 10 : null,
        cacNative: cacNative != null ? Math.round(cacNative * 100) / 100 : null,
        costPerBookedCallNative: costPerBookedCallNative != null ? Math.round(costPerBookedCallNative * 100) / 100 : null,
      },
      verdict,
      verdictLabel: healthVerdict ? healthVerdict.label : 'Gathering data',
      adsets,
      ads,
      adKillRules: {
        adSpendKillThresholdCad: AD_SPEND_KILL_THRESHOLD_CAD,
        minCtrPct: AD_CTR_KILL_PCT,
        minImpressionsForCtrRule: 1000,
        qualifiedRateKillPct: QUALIFIED_RATE_KILL_PCT,
        bookedCallRateKillPct: BOOKED_CALL_RATE_KILL_PCT,
        minSampleForQualityRules: MIN_SAMPLE_FOR_QUALITY_RULES,
        noSpendWindowHours: 72,
        note: 'Frequency (3.5+) is a diagnostic signal, not an automatic kill — only matters alongside rising CPL or falling CTR, which needs daily history not pulled here. CTR-drop-over-2-weeks rule also needs that history — not evaluated.',
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
