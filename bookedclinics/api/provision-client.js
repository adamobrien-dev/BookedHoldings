// BookedClinics — GHL Client Provisioning Script
// Run: node provision-client.js
//
// Step 1: Set GHL_AGENCY_KEY + GHL_COMPANY_ID, then run → creates the sub-account.
// Step 2: Paste the returned Location ID below, set GHL_CLIENT_PIT, then re-run →
//         applies the snapshot, creates the contact, and adds the opportunity.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ── CLIENT CONFIG ─────────────────────────────────────────────────────────────
const CLIENT = {
  name:         'TODO: Full Name',          // e.g. 'Jane Smith'
  businessName: 'TODO: Business Name',      // e.g. 'Smith Chiropractic'
  email:        'TODO: client@email.com',
  phone:        'TODO: +1XXXXXXXXXX',
  niche:        'TODO: Niche',              // e.g. 'Chiropractic'
  city:         'TODO: City',
  state:        'TODO: ST',                 // 2-letter, e.g. 'TX'
  zip:          'TODO: ZIP',
  website:      'TODO: https://...',
  timezone:     'TODO: America/Chicago',    // IANA timezone

  // Fill these in from your GHL agency dashboard:
  snapshotId:   'TODO: GHL snapshot ID',
  pipelineId:   'TODO: GHL pipeline ID',
  stageId:      'TODO: first stage ID',     // e.g. 'Setting Up' stage
  dealValue:    500,                         // monthly retainer $ — adjust as needed

  // Fill after Step 1 completes:
  locationId:   null,                        // paste returned location ID here before Step 2
};
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
  console.log('\n[1/4] Creating sub-account (location)...');

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
  console.log(`    1. Paste the Location ID into CLIENT.locationId in this file.`);
  console.log(`    2. Generate a PIT for the new sub-account in GHL Settings → Integrations.`);
  console.log(`    3. Set GHL_CLIENT_PIT=<pit> and re-run to finish provisioning.`);

  return locationId;
}

// ── STEP 2: Apply snapshot ────────────────────────────────────────────────────
async function applySnapshot(locationId) {
  console.log('\n[2/4] Applying snapshot...');

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
  console.log('\n[3/4] Creating client contact...');

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

// ── STEP 4: Add to pipeline ───────────────────────────────────────────────────
async function createOpportunity(locationId, contactId) {
  console.log('\n[4/4] Adding to pipeline...');

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
  // Validate required env vars
  if (!AGENCY_KEY) { console.error('Error: GHL_AGENCY_KEY is not set.'); process.exit(1); }
  if (!COMPANY_ID) { console.error('Error: GHL_COMPANY_ID is not set.'); process.exit(1); }

  // Validate TODOs in CLIENT config
  const missingFields = Object.entries(CLIENT)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('TODO:'))
    .map(([k]) => k);

  // Allow locationId to be null on first run (Step 1)
  const critical = missingFields.filter(f => f !== 'locationId');
  if (critical.length > 0) {
    console.error(`Error: Fill in the following CLIENT fields before running:\n  ${critical.join(', ')}`);
    process.exit(1);
  }

  try {
    // ── STEP 1 ────────────────────────────────────────────────
    let { locationId } = CLIENT;

    if (!locationId) {
      await createLocation();
      process.exit(0); // pause for user to fill in locationId + PIT
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
    const clientKey = CLIENT.businessName.split(' ')[0].toLowerCase();
    const pitEnvKey = `GHL_PIT_${CLIENT.name.split(' ')[0].toUpperCase()}`;
    console.log('\n  Client provisioned successfully!\n');
    console.log('  Add this entry to CLIENTS in dashboard-data.js:');
    console.log(`  {`);
    console.log(`    key: '${clientKey}',`);
    console.log(`    name: '${CLIENT.name}',`);
    console.log(`    biz: '${CLIENT.businessName}',`);
    console.log(`    niche: '${CLIENT.niche} · ${CLIENT.city}, ${CLIENT.state}',`);
    console.log(`    locationId: '${locationId}',`);
    console.log(`    pitEnv: '${pitEnvKey}',`);
    console.log(`    stripeId: null,`);
    console.log(`    status: 'setup',`);
    console.log(`  }`);
    console.log(`\n  Also set env var: ${pitEnvKey}=<pit>\n`);

  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
}

main();
