const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

const STAGE = {
  DC_UPCOMING:   'd0065956-d245-4c34-8bcd-4414a3a2c408',
  DC_CANCELLED:  '44c55d3b-9351-4fd0-9a24-5d3e54b22dc6',
  DC_NOSHOW:     'f7a093f3-799e-4c00-826b-886c41199063',
  DC_FOLLOWUP:   'b721a3f8-6fd8-4d7e-9b6b-267794569ebe',
  SC_UPCOMING:   '8216ee1d-73eb-4a3e-b53b-8b8cf0942256',
  SC_CANCELLED:  '49b17194-16e9-41a8-9f9e-5f61b398ed17',
  SC_NOSHOW:     'b3d8ff2c-e3e0-4349-9431-26d626296ecb',
  SC_FOLLOWUP:   '3c017890-c47c-4059-8c11-02d85817fc6f',
  WON:           'f76147d8-36e3-4f87-8634-72669c00be4a',
  LOST:          '7189147d-1d8d-4e90-aba5-e733fd88c836',
};

// Stages that mean the DC happened (contact showed up)
const DC_SHOWED = new Set([STAGE.DC_FOLLOWUP, STAGE.SC_UPCOMING, STAGE.SC_CANCELLED, STAGE.SC_NOSHOW, STAGE.SC_FOLLOWUP, STAGE.WON, STAGE.LOST]);
// Stages that mean the SC happened (contact showed up for SC)
const SC_SHOWED = new Set([STAGE.SC_FOLLOWUP, STAGE.WON, STAGE.LOST]);

async function getOpps(pit) {
  const r = await fetch(`${GHL_API}/opportunities/search?location_id=${LOC}&limit=100`, {
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
  });
  if (!r.ok) return [];
  const d = await r.json();
  return d.opportunities || [];
}

async function getStripeWeek() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return 0;
  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
  const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const r = await fetch(`https://api.stripe.com/v1/payment_intents?limit=100&created[gte]=${since}`, {
    headers: { Authorization: auth },
  });
  if (!r.ok) return 0;
  const d = await r.json();
  return (d.data || []).filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount, 0) / 100;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pit = process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';
  const { days, start, end } = req.query || {};
  let cutoff, periodEnd;
  if (start && end) {
    cutoff = new Date(start);
    periodEnd = new Date(end);
    periodEnd.setHours(23, 59, 59, 999);
  } else {
    const d = parseInt(days) || 7;
    cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    periodEnd = new Date();
  }

  const [opps, cashCollected] = await Promise.all([getOpps(pit), getStripeWeek()]);

  // createdAt = when the opportunity was first created = when the lead first booked a DC
  // lastStageChangeAt = when they last moved stages
  const createdInWindow = (o) => {
    const t = new Date(o.createdAt);
    return t >= cutoff && t <= periodEnd;
  };
  const stageChangedInWindow = (o) => {
    const t = new Date(o.lastStageChangeAt);
    return t >= cutoff && t <= periodEnd;
  };

  // First calls booked = opportunity created in window (DC was booked when opp was created)
  const dcBooked = opps.filter(o => createdInWindow(o) && o.status !== 'lost');

  // First calls showed = had a DC and progressed past it (currently in SC stages, follow-up, won, lost)
  // within window: either created in window and already past DC, or stage changed into a DC_SHOWED stage
  const dcShowed = opps.filter(o => DC_SHOWED.has(o.pipelineStageId) && stageChangedInWindow(o));

  // First calls cancelled/rescheduled = moved to DC: Cancelled or DC: No Show in window
  const dcCancelled = opps.filter(o => o.pipelineStageId === STAGE.DC_CANCELLED && stageChangedInWindow(o));
  const dcNoShow    = opps.filter(o => o.pipelineStageId === STAGE.DC_NOSHOW    && stageChangedInWindow(o));

  // Qualified = moved to SC: Upcoming in window (DC went well, booked a sales call)
  const dcQualified = opps.filter(o => o.pipelineStageId === STAGE.SC_UPCOMING && stageChangedInWindow(o));

  // Second calls booked = same as qualified
  const scBooked = dcQualified;

  // Second calls cancelled/no-show = moved to SC: Cancelled or SC: No Show in window
  const scCancelledOrNoShow = opps.filter(o =>
    (o.pipelineStageId === STAGE.SC_CANCELLED || o.pipelineStageId === STAGE.SC_NOSHOW) && stageChangedInWindow(o)
  );

  // Second calls taken = progressed past SC in window
  const scTaken = opps.filter(o => SC_SHOWED.has(o.pipelineStageId) && stageChangedInWindow(o));

  // Closed = Won in window
  const closed = opps.filter(o => o.status === 'won' && stageChangedInWindow(o));

  // Totals currently in pipeline (for context)
  const totalDCUpcoming = opps.filter(o => o.pipelineStageId === STAGE.DC_UPCOMING).length;
  const totalSCUpcoming = opps.filter(o => o.pipelineStageId === STAGE.SC_UPCOMING).length;

  const fmt = (arr) => arr.map(o => o.contact?.name || 'Unknown');

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    weekStart: cutoff.toISOString(),
    weekEnd: periodEnd.toISOString(),
    metrics: {
      dcBooked:          { count: dcBooked.length,            names: fmt(dcBooked) },
      dcShowed:          { count: dcShowed.length,            names: fmt(dcShowed) },
      dcCancelledOrNoShow: { count: dcCancelled.length + dcNoShow.length, names: fmt([...dcCancelled, ...dcNoShow]) },
      dcQualified:       { count: dcQualified.length,         names: fmt(dcQualified) },
      scBooked:          { count: scBooked.length,            names: fmt(scBooked) },
      scTaken:           { count: scTaken.length,             names: fmt(scTaken) },
      scCancelledOrNoShow: { count: scCancelledOrNoShow.length, names: fmt(scCancelledOrNoShow) },
      closed:            { count: closed.length,              names: fmt(closed) },
      cashCollected,
    },
    pipeline: {
      dcUpcoming: totalDCUpcoming,
      scUpcoming: totalSCUpcoming,
    },
  });
};
