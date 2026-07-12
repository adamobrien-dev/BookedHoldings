// testimonial-campaign-ziani.js
// 3-message SMS sequence pointing to the new Dr. Ziani testimonial on the
// testimonials page (anonymized real client — video to be added once the
// file is in hand; swap /testimonial-rafael-ziani-* paths in
// testimonials/index.html before this campaign's links go live).
//
// Message 1: Sat Jul 4 — social proof only
// Message 2: Sun Jul 5 — video + calendar link
// Message 3: Wed Jul 8 — straight CTA, no video
//
// Targets all non-won, non-lost agency pipeline contacts:
//   SC: Upcoming, DC: Upcoming, DC No-Show, SC No-Show, DC Cancelled, DC Follow-Up
//
// Usage (dry run — shows who would receive what):
//   node scripts/testimonial-campaign-ziani.js
//
// Usage (send message 1 now):
//   node scripts/testimonial-campaign-ziani.js --send --msg=1
//
// Usage (send message 2 now):
//   node scripts/testimonial-campaign-ziani.js --send --msg=2
//
// Usage (send message 3 now):
//   node scripts/testimonial-campaign-ziani.js --send --msg=3

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const PIT = process.env.GHL_PIT_AGENCY || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';

const TESTIMONIALS_URL = 'bookedclinics.ca/testimonials';
const CALENDAR_URL = 'go.bookedclinics.ca/calendar';

function firstName(name = '') {
  return name.trim().replace(/^Dr\.\s*/i, '').split(' ')[0] || name;
}

const MESSAGES = {
  1: (name) =>
    `Hey ${firstName(name)} — one of our clients just did 500+ patient inquiries and 70 new patients in his first 60 days with us. Hear it from him directly: ${TESTIMONIALS_URL}`,

  2: (name) =>
    `Hey ${firstName(name)}, sharing this in case you missed it — Dr. Ziani generated 500+ inquiries, 120 consultations, and 70 new patients in his first 60 days. ${TESTIMONIALS_URL} — if you want to see what that could look like for your clinic, grab a free call here: ${CALENDAR_URL}`,

  3: (name) =>
    `Hey ${firstName(name)} — last one from me. If you're thinking about getting more patients through the door, this is the fastest way I know how to do it: ${CALENDAR_URL} — happy to map out a plan for your clinic on a free call.`,
};

// Stage IDs from Master Pipeline (NKpzhLv8iNQ0c9Ge3QAR)
const TARGET_STAGE_IDS = new Set([
  'd0065956-d245-4c34-8bcd-4414a3a2c408', // 📞 DC: Upcoming
  '44c55d3b-9351-4fd0-9a24-5d3e54b22dc6', // ❌ DC: Cancelled
  'f7a093f3-799e-4c00-826b-886c41199063', // 👻 DC: No Show
  'b721a3f8-6fd8-4d7e-9b6b-267794569ebe', // 💲 DC: Follow Up
  '8216ee1d-73eb-4a3e-b53b-8b8cf0942256', // 📞 SC: Upcoming
  'b3d8ff2c-e3e0-4349-9431-26d626296ecb', // 👻 SC: No Show
  '3c017890-c47c-4059-8c11-02d85817fc6f', // 💲 SC: Follow Up
  '4cf8fedb-3cbb-488c-9794-f48d4de357e0', // Contract Sent
  '0fd2f7e4-ab16-4f75-b322-9f603996386d', // 💬 Convo: Responded
  '546af97e-c29b-42b7-9a93-010bb57969e6', // 👥 Leads: New
]);

function classify(stageId = '') {
  return TARGET_STAGE_IDS.has(stageId) ? 'INCLUDE' : 'SKIP';
}

async function ghl(method, path, body) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PIT}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function sendSms(contactId, message) {
  const { ok, status, data } = await ghl('POST', '/conversations/messages', {
    type: 'SMS',
    contactId,
    locationId: AGENCY_LOC,
    message,
  });
  return { ok, status, messageId: data?.messageId || data?.id || null, error: ok ? null : JSON.stringify(data).slice(0, 200) };
}

async function run() {
  const args = process.argv.slice(2);
  const dry = !args.includes('--send');
  const msgNum = parseInt((args.find(a => a.startsWith('--msg=')) || '--msg=1').split('=')[1]);

  if (!MESSAGES[msgNum]) {
    console.error(`Invalid --msg value. Use 1, 2, or 3.`);
    process.exit(1);
  }

  console.log(`\n📋 Ziani Testimonial Campaign — Message ${msgNum}`);
  console.log(dry ? '🔍 DRY RUN (add --send to fire for real)\n' : '🚀 LIVE SEND\n');

  const oppsResult = await ghl('GET', `/opportunities/search?location_id=${AGENCY_LOC}&limit=100`);
  if (!oppsResult.ok) {
    console.error('GHL API error:', oppsResult.status, oppsResult.data);
    process.exit(1);
  }

  const opps = (oppsResult.data?.opportunities || []).filter(o => o.status !== 'lost');

  const targets = [];
  const skipped = [];

  for (const opp of opps) {
    const { id: contactId, name, phone } = opp.contact || {};
    const stage = classify(opp.pipelineStageId || '');

    if (stage === 'SKIP') {
      skipped.push({ name, stageId: opp.pipelineStageId, reason: 'won/lost/other stage' });
      continue;
    }

    if (!contactId || !phone) {
      skipped.push({ name, stageId: opp.pipelineStageId, reason: 'no phone number' });
      continue;
    }

    // Exclude existing/past Stripe customers — paying or previously paid clients
    const EXCLUDE_NAMES = ['japa', 'carlos meneses', 'sarah purdy', 'stephanie alvarenga'];
    if (EXCLUDE_NAMES.some(ex => (name || '').toLowerCase().includes(ex))) {
      skipped.push({ name, stageId: opp.pipelineStageId, reason: 'existing stripe customer' });
      continue;
    }

    targets.push({ contactId, name, phone, stageId: opp.pipelineStageId });
  }

  console.log(`Targets (${targets.length}):`);
  for (const t of targets) {
    console.log(`  ✉️  ${t.name} ${t.phone}`);
    console.log(`     → "${MESSAGES[msgNum](t.name)}"\n`);
  }

  if (skipped.length) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  ⏭️  ${s.name} — ${s.reason}`);
    }
  }

  if (dry) {
    console.log(`\n✅ Dry run complete. Run with --send --msg=${msgNum} to send for real.`);
    return;
  }

  console.log(`\nSending message ${msgNum} to ${targets.length} contacts...\n`);
  const results = { sent: 0, failed: 0 };

  for (const t of targets) {
    const result = await sendSms(t.contactId, MESSAGES[msgNum](t.name));
    if (result.ok) {
      console.log(`  ✅ ${t.name} — sent (${result.messageId})`);
      results.sent++;
    } else {
      console.log(`  ❌ ${t.name} — FAILED: ${result.error}`);
      results.failed++;
    }
    // Brief pause to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n📊 Done — ${results.sent} sent, ${results.failed} failed`);
}

run().catch(err => { console.error(err); process.exit(1); });
