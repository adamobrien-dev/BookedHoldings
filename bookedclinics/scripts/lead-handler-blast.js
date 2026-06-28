#!/usr/bin/env node
// Sends the lead-handler SMS to all open pipeline prospects
// Run: node scripts/lead-handler-blast.js
// Add --dry-run to preview without sending

const path = require('path');
const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';
const PIT = process.env.GHL_PIT_AGENCY;
if (!PIT) { console.error('Missing GHL_PIT_AGENCY env var'); process.exit(1); }
const DRY_RUN = process.argv.includes('--dry-run');

// Load DNC list — checked before every send
const DNC_GLOBAL = require(path.join(__dirname, '../config/dnc-global.json'));
const dncPhones = new Set(DNC_GLOBAL.contacts.map(c => c.phone.replace(/\D/g, '')));
const dncNames  = new Set(DNC_GLOBAL.contacts.map(c => c.name.toLowerCase()));

function isDNC(contact) {
  const phone = (contact.phone || '').replace(/\D/g, '');
  const name  = (contact.name  || '').toLowerCase();
  return dncPhones.has(phone) || dncNames.has(name);
}

const MESSAGE = (name) =>
  `Hey ${name.split(' ')[0]}, putting together something for the clinics we work with and wanted to share it with you too.\n\nIt's a lead management system — phone script, objection handling, the whole thing. Give it to your front desk and apply what's inside, and you'll see a shift fast.\n\nbookedclinics.ca/lead-handler\n\nFree call link at the bottom if you ever want us to walk through your setup.`;

async function ghlFetch(path, options = {}) {
  const r = await fetch(`${GHL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PIT}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GHL ${r.status}: ${text}`);
  }
  return r.json();
}

async function getAllOpportunities() {
  const contacts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await ghlFetch(
      `/opportunities/search?location_id=${AGENCY_LOC}&limit=100&page=${page}&status=open`
    );
    const opps = data?.opportunities || [];
    for (const o of opps) {
      // Skip won deals — prospects only
      if (o.status === 'won') continue;
      if (o.contact?.id && o.contact?.name) {
        contacts.push({
          contactId: o.contact.id,
          name: o.contact.name,
          phone: o.contact.phone || null,
          stage: o.stage?.name || 'Unknown',
        });
      }
    }
    hasMore = opps.length === 100;
    page++;
  }

  // Dedupe by contactId
  const seen = new Set();
  return contacts.filter(c => {
    if (seen.has(c.contactId)) return false;
    seen.add(c.contactId);
    return true;
  });
}

async function sendSMS(contactId, message) {
  return ghlFetch(`/conversations/messages`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'SMS',
      contactId,
      message,
    }),
  });
}

async function main() {
  console.log(`\n🔍 Fetching pipeline opportunities...${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const contacts = await getAllOpportunities();
  // Apply global DNC
  const dnc = contacts.filter(c => isDNC(c));
  const eligible = contacts.filter(c => !isDNC(c));
  const withPhone = eligible.filter(c => c.phone);
  const noPhone = eligible.filter(c => !c.phone);

  console.log(`Found ${contacts.length} open prospects — ${dnc.length} DNC skipped, ${withPhone.length} eligible\n`);

  if (dnc.length > 0) {
    console.log('🚫 DNC (skipped):');
    dnc.forEach(c => console.log(`   - ${c.name}`));
    console.log('');
  }

  if (noPhone.length > 0) {
    console.log('⚠️  Skipping (no phone):');
    noPhone.forEach(c => console.log(`   - ${c.name}`));
    console.log('');
  }

  if (DRY_RUN) {
    console.log('📋 Would send to:');
    withPhone.forEach(c => console.log(`   ✓ ${c.name} (${c.phone}) — ${c.stage}`));
    console.log(`\nMessage preview:\n---\n${MESSAGE('John Smith')}\n---`);
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const contact of withPhone) {
    try {
      await sendSMS(contact.contactId, MESSAGE(contact.name));
      console.log(`✓ Sent to ${contact.name} (${contact.phone})`);
      sent++;
      // Rate limit: 1 per second
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`✗ Failed for ${contact.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done — ${sent} sent, ${failed} failed`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
