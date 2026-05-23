// BookedClinics — GHL Client Provisioning Script
// Run: node provision-client.js
//
// Step 1: Set GHL_AGENCY_KEY + GHL_COMPANY_ID, then run → creates the sub-account.
// Step 2: Paste the returned Location ID below, set GHL_CLIENT_PIT, then re-run →
//         applies the snapshot (if set), creates the contact, and adds the opportunity.
//
// Optional fields (snapshotId, pipelineId, stageId) can be left null to skip those steps.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ── CLIENT CONFIG ─────────────────────────────────────────────────────────────
// Current config: TEST — Thompson Chiropractic (Austin, TX)
// Replace all values with the real client before running for production.
const CLIENT = {
  name:         'Dr. Alex Thompson',
  businessName: 'Thompson Chiropractic',
  email:        'alex@thompsonchiro.test',
  phone:        '+15125550100',
  niche:        'Chiropractic',
  city:         'Austin',
  state:        'TX',
  zip:          '78701',
  website:      'https://thompsonchiro.com',
  timezone:     'America/Chicago',

  // Optional GHL IDs — set to null to skip that step
  snapshotId:   null,   // paste snapshot ID here once built in GHL (see GHL_SETUP_GUIDE below)
  pipelineId:   null,   // paste pipeline ID from GHL agency dashboard
  stageId:      null,   // paste first pipeline stage ID (e.g. 'Setting Up')
  dealValue:    500,    // monthly retainer $ — adjust per deal

  // Filled automatically after Step 1 — paste locationId here before re-running Step 2
  locationId:   null,
};

// ── GHL SETUP GUIDE ───────────────────────────────────────────────────────────
// After Step 1 creates the sub-account, log into GHL and build the following
// inside the new sub-account. When done, save everything as a snapshot so
// future clients can be fully provisioned automatically.
//
// SURVEY (Sites → Surveys → New Survey)
// ──────────────────────────────────────
// Name: "New Patient Intake"
// Pages: 1 page, 10 questions
//
//  Q1  Short Answer  — "What's your full name?" [required]
//  Q2  Short Answer  — "Email address?" [required]
//  Q3  Short Answer  — "Best phone number?" [required]
//  Q4  Single Select — "What's your main concern?"
//        Back pain | Neck pain | Headaches/migraines | Sciatica | Sports injury | Other
//  Q5  Single Select — "How long have you had this issue?"
//        Less than a week | 1–4 weeks | 1–3 months | More than 3 months
//  Q6  Single Select — "Rate your pain right now (1–10)"
//        1–2 (mild) | 3–5 (moderate) | 6–8 (severe) | 9–10 (unbearable)
//  Q7  Single Select — "Have you seen a chiropractor before?"
//        Yes | No
//  Q8  Single Select — "Are you currently insured?"
//        Yes | No | Not sure
//  Q9  Single Select — "How did you hear about us?"
//        Google search | Google Maps | Facebook/Instagram | Friend or family | Other
//  Q10 Single Select — "Ready to book your free consultation?"
//        Yes, contact me to book | I have a few questions first
//
// Redirect on submit → Thank You page URL (see site structure below)
// Notification → email to client + internal lead notification
//
// SITE / FUNNEL (Sites → Funnels → New Funnel)
// ─────────────────────────────────────────────
// Name: "Thompson Chiro — New Patient"
// Domain: connect client's domain or use GHL subdomain for test
//
// Page 1 — Home / Landing Page (path: /)
//   Hero:    "Get Out of Pain. Book Your Free Chiropractic Consultation."
//   Sub:     "We help Austin patients with back pain, neck pain, sciatica & more.
//             No pressure. Same-week appointments available."
//   CTA btn: "Take the Free Pain Assessment →" → links to Survey page
//   Section: 3 trust icons (Licensed, Insurance Accepted, Same-Week Appts)
//   Section: Before/After or pain-relief photo + short bio of Dr. Thompson
//   Section: Services (Back & Neck Pain, Sciatica, Headaches, Sports Injuries)
//   Section: Google reviews widget (min 5 stars shown)
//   Section: Final CTA — "Ready to feel better? Take 60 seconds →" button
//
// Page 2 — Survey / Intake (path: /intake)
//   Embed the "New Patient Intake" survey built above
//   Headline: "Tell us about your pain — takes 60 seconds"
//
// Page 3 — Thank You (path: /thank-you)
//   Headline: "We got it! Expect a call within 24 hours."
//   Sub:     "While you wait, save our number: [phone]"
//   Optional: embed a Calendly/GHL calendar for self-booking
//
// WORKFLOW (Automations → Workflows → New)
// ─────────────────────────────────────────
// Trigger: Survey submitted (New Patient Intake)
// Actions:
//   1. Create / update contact (map Q1=name, Q2=email, Q3=phone)
//   2. Add tag: "new-lead"
//   3. Add to pipeline: New Patient → stage "New Lead"
//   4. Wait 5 min → SMS: "Hi [name], Dr. Thompson's team here! We saw your intake form.
//      Are you free for a quick call today or tomorrow?"
//   5. Wait 1 day (no reply) → SMS: follow-up
//   6. Internal notification → email to clinic
//
// Once ALL of the above is built and tested, save the sub-account as a GHL snapshot,
// then paste the snapshot ID into CLIENT.snapshotId above.
// ─────────────────────────────────────────────────────────────────────────────

const AGENCY_KEY = process.env.GHL_AGENCY_KEY;   // agency-level API key
const COMPANY_ID = process.env.GHL_COMPANY_ID;   // your GHL company/agency ID
const CLIENT_PIT = process.env.GHL_CLIENT_PIT;   // client sub-account PIT (for Steps 2-4)

async function ghlRequest(method, path, body, token) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

// ── STEP 1: Create sub-account ────────────────────────────────────────────────
async function createLocation() {
  console.log('\n[1] Creating sub-account (location)...');

  const data = await ghlRequest('POST', '/locations/', {
    name: CLIENT.businessName,
    companyId: COMPANY_ID,
    email: CLIENT.email,
    phone: CLIENT.phone,
    website: CLIENT.website,
    city: CLIENT.city,
    state: CLIENT.state,
    postalCode: CLIENT.zip,
    country: 'US',
    timezone: CLIENT.timezone,
    settings: {
      allowDuplicateContact: false,
      allowDuplicateOpportunity: false,
    },
  }, AGENCY_KEY);

  const locationId = data?.location?.id;
  if (!locationId) throw new Error(`Unexpected response: ${JSON.stringify(data)}`);

  console.log(`\n  Sub-account created!`);
  console.log(`  Location ID: ${locationId}`);
  console.log(`\n  Next steps:`);
  console.log(`    1. Paste the location ID into CLIENT.locationId in this file.`);
  console.log(`    2. Log into GHL and build the survey + funnel inside this sub-account`);
  console.log(`       (see GHL_SETUP_GUIDE in this file for the exact structure).`);
  console.log(`    3. Generate a PIT: GHL → Settings → Integrations → Private Integrations.`);
  console.log(`    4. Set GHL_CLIENT_PIT=<pit> and re-run to finish.`);

  return locationId;
}

// ── STEP 2: Apply snapshot (optional) ────────────────────────────────────────
async function applySnapshot(locationId) {
  if (!CLIENT.snapshotId) {
    console.log('\n[2] Snapshot — skipped (no snapshotId set).');
    return;
  }

  console.log('\n[2] Applying snapshot...');

  await ghlRequest('POST', '/snapshots/apply', {
    type: 'own_location',
    locationId,
    snapshotId: CLIENT.snapshotId,
    override: true,
  }, AGENCY_KEY);

  console.log('  Snapshot applied.');
}

// ── STEP 3: Create contact ────────────────────────────────────────────────────
async function createContact(locationId) {
  console.log('\n[3] Creating client contact...');

  const [firstName, ...rest] = CLIENT.name.split(' ');
  const lastName = rest.join(' ');
  const nicheTag = CLIENT.niche.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const data = await ghlRequest('POST', '/contacts/', {
    locationId,
    firstName,
    lastName,
    name: CLIENT.name,
    email: CLIENT.email,
    phone: CLIENT.phone,
    companyName: CLIENT.businessName,
    website: CLIENT.website,
    city: CLIENT.city,
    state: CLIENT.state,
    postalCode: CLIENT.zip,
    country: 'US',
    tags: ['bookedclinics-client', nicheTag],
    source: 'BookedClinics Onboarding',
  }, CLIENT_PIT);

  const contactId = data?.contact?.id;
  if (!contactId) throw new Error(`Unexpected response: ${JSON.stringify(data)}`);

  console.log(`  Contact created: ${contactId}`);
  return contactId;
}

// ── STEP 4: Add to pipeline (optional) ───────────────────────────────────────
async function createOpportunity(locationId, contactId) {
  if (!CLIENT.pipelineId || !CLIENT.stageId) {
    console.log('\n[4] Pipeline — skipped (no pipelineId/stageId set).');
    return null;
  }

  console.log('\n[4] Adding to pipeline...');

  const data = await ghlRequest('POST', '/opportunities/', {
    locationId,
    name: `${CLIENT.businessName} — Onboarding`,
    pipelineId: CLIENT.pipelineId,
    pipelineStageId: CLIENT.stageId,
    contactId,
    status: 'open',
    monetaryValue: CLIENT.dealValue,
    source: 'BookedClinics Onboarding',
  }, CLIENT_PIT);

  const oppId = data?.opportunity?.id;
  if (!oppId) throw new Error(`Unexpected response: ${JSON.stringify(data)}`);

  console.log(`  Opportunity created: ${oppId}`);
  return oppId;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!AGENCY_KEY) { console.error('Error: GHL_AGENCY_KEY is not set.'); process.exit(1); }
  if (!COMPANY_ID) { console.error('Error: GHL_COMPANY_ID is not set.'); process.exit(1); }

  try {
    let { locationId } = CLIENT;

    // ── STEP 1 ────────────────────────────────────────────────
    if (!locationId) {
      await createLocation();
      process.exit(0);
    }

    // ── STEPS 2-4 (requires CLIENT_PIT) ───────────────────────
    if (!CLIENT_PIT) {
      console.error('Error: GHL_CLIENT_PIT is not set. Generate a PIT for the sub-account and re-run.');
      process.exit(1);
    }

    await applySnapshot(locationId);
    const contactId = await createContact(locationId);
    await createOpportunity(locationId, contactId);

    // ── DONE ───────────────────────────────────────────────────
    const clientKey = CLIENT.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const pitEnvKey = `GHL_PIT_${CLIENT.name.replace(/^Dr\.\s*/i, '').split(' ')[0].toUpperCase()}`;
    console.log('\n  Done! Add this to CLIENTS in dashboard-data.js:\n');
    console.log(`  {`);
    console.log(`    key: '${clientKey}',`);
    console.log(`    name: '${CLIENT.name}',`);
    console.log(`    biz: '${CLIENT.businessName}',`);
    console.log(`    niche: '${CLIENT.niche} · ${CLIENT.city}, ${CLIENT.state}',`);
    console.log(`    locationId: '${locationId}',`);
    console.log(`    pitEnv: '${pitEnvKey}',`);
    console.log(`    stripeId: null,`);
    console.log(`    status: 'setup',`);
    console.log(`  }\n`);
    console.log(`  Also add env var: ${pitEnvKey}=<pit>\n`);

  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
}

main();
