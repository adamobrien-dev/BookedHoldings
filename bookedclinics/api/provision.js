// POST /api/provision
// Creates a GHL sub-account and optionally applies a snapshot,
// creates a contact, and adds a pipeline opportunity.
//
// Body (JSON):
//   name         string  — client full name
//   businessName string  — business / location name
//   email        string
//   phone        string  — E.164, e.g. +15125550100
//   niche        string  — e.g. 'Chiropractic'
//   city         string
//   state        string  — 2-letter
//   zip          string
//   website      string  — optional
//   timezone     string  — IANA, e.g. 'America/Chicago'
//   snapshotId   string? — GHL snapshot ID (omit to skip)
//   pipelineId   string? — GHL pipeline ID (omit to skip)
//   stageId      string? — first pipeline stage ID (omit to skip)
//   dealValue    number? — default 500

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

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
  if (!res.ok) throw new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function createLocation(client, agencyPit, companyId) {
  const data = await ghlRequest('POST', '/locations/', {
    name: client.businessName,
    companyId,
    email: client.email,
    phone: client.phone,
    website: client.website || '',
    city: client.city,
    state: client.state,
    postalCode: client.zip,
    country: 'US',
    timezone: client.timezone,
    settings: {
      allowDuplicateContact: false,
      allowDuplicateOpportunity: false,
    },
  }, agencyPit);

  const locationId = data?.location?.id;
  if (!locationId) throw new Error(`No locationId in response: ${JSON.stringify(data)}`);
  return locationId;
}

async function applySnapshot(locationId, snapshotId, agencyPit) {
  await ghlRequest('POST', '/snapshots/apply', {
    type: 'own_location',
    locationId,
    snapshotId,
    override: true,
  }, agencyPit);
}

async function createContact(client, locationId, clientPit) {
  const [firstName, ...rest] = client.name.split(' ');
  const data = await ghlRequest('POST', '/contacts/', {
    locationId,
    firstName,
    lastName: rest.join(' '),
    name: client.name,
    email: client.email,
    phone: client.phone,
    companyName: client.businessName,
    website: client.website || '',
    city: client.city,
    state: client.state,
    postalCode: client.zip,
    country: 'US',
    tags: ['bookedclinics-client', client.niche.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
    source: 'BookedClinics Onboarding',
  }, clientPit);

  const contactId = data?.contact?.id;
  if (!contactId) throw new Error(`No contactId in response: ${JSON.stringify(data)}`);
  return contactId;
}

async function createOpportunity(client, locationId, contactId, clientPit) {
  const data = await ghlRequest('POST', '/opportunities/', {
    locationId,
    name: `${client.businessName} — Onboarding`,
    pipelineId: client.pipelineId,
    pipelineStageId: client.stageId,
    contactId,
    status: 'open',
    monetaryValue: client.dealValue || 500,
    source: 'BookedClinics Onboarding',
  }, clientPit);

  const oppId = data?.opportunity?.id;
  if (!oppId) throw new Error(`No opportunityId in response: ${JSON.stringify(data)}`);
  return oppId;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AGENCY_PIT = process.env.GHL_PIT_AGENCY || 'pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b';
  const COMPANY_ID = process.env.GHL_COMPANY_ID || 'MSYotuf1a5FAsGdPRMfP';

  const client = req.body;
  const required = ['name', 'businessName', 'email', 'phone', 'niche', 'city', 'state', 'zip', 'timezone'];
  const missing = required.filter(f => !client[f]);
  if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

  const log = [];
  try {
    // Step 1 — create sub-account
    log.push('Creating sub-account...');
    const locationId = await createLocation(client, AGENCY_PIT, COMPANY_ID);
    log.push(`Sub-account created: ${locationId}`);

    // Step 2 — apply snapshot (optional)
    if (client.snapshotId) {
      log.push('Applying snapshot...');
      await applySnapshot(locationId, client.snapshotId, AGENCY_PIT);
      log.push('Snapshot applied.');
    }

    // Steps 3-4 require a client PIT — caller must provide it,
    // or skip by omitting pipelineId/stageId (contact still created with agency PIT)
    const clientPit = client.clientPit || AGENCY_PIT;

    // Step 3 — create contact
    log.push('Creating contact...');
    const contactId = await createContact(client, locationId, clientPit);
    log.push(`Contact created: ${contactId}`);

    // Step 4 — add to pipeline (optional)
    let oppId = null;
    if (client.pipelineId && client.stageId) {
      log.push('Adding to pipeline...');
      oppId = await createOpportunity(client, locationId, contactId, clientPit);
      log.push(`Opportunity created: ${oppId}`);
    }

    const clientKey = client.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const pitEnvKey = `GHL_PIT_${client.name.replace(/^Dr\.\s*/i, '').split(' ')[0].toUpperCase()}`;

    return res.status(200).json({
      success: true,
      locationId,
      contactId,
      oppId,
      log,
      dashboardEntry: {
        key: clientKey,
        name: client.name,
        biz: client.businessName,
        niche: `${client.niche} · ${client.city}, ${client.state}`,
        locationId,
        pitEnv: pitEnvKey,
        stripeId: null,
        status: 'setup',
      },
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
};
