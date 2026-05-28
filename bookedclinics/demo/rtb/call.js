#!/usr/bin/env node
// Usage: node call.js +17135556789 "Stephanie"

const phone = process.argv[2];
const name  = process.argv[3] || 'Stephanie';

if (!phone) {
  console.log('Usage: node call.js <phone_number> [name]');
  console.log('Example: node call.js +17135556789 Stephanie');
  process.exit(1);
}

const BLAND_KEY = 'org_1c8afa05088719a61da277d3364429f9c3bc28df73bbeff6944ccd82d8bcc8820a78c511da88d39a82ba69';

const task = `You are Tina, a booking coordinator at RTB Spa, a wellness studio in West Houston. You're calling ${name} because they recently reached out about getting a massage.

Your personality: warm, unhurried, genuine. You talk like a real person — not a script. Use casual language, short sentences, natural pauses. Say "totally" and "absolutely" and "yeah for sure." You genuinely care about helping people feel better.

Your only goal is to find out what they need and get them booked with Stephanie this week.

Start the conversation by introducing yourself and asking if they have a second. Then find out what's going on with their body — are they stressed and need to unwind, or do they have actual tension or pain somewhere specific? Let them talk. Respond to what they say before moving forward.

Once you know what they're dealing with, naturally mention the right type of massage — Swedish if they need to relax, deep tissue if they have tight muscles, neck and scalp work if they carry tension in their upper body. Keep it simple, one recommendation.

Then let them know Stephanie has been doing this for nearly 10 years and is really good at what she does. Ask if mornings or afternoons tend to work better, then offer two specific slots this week — like Tuesday at 2 or Thursday morning at 11. Confirm whichever works for them and let them know they'll get a text with the details.

If they ask about price, sessions start around 95 dollars. If they're not ready to book, that's totally fine — just be warm about it.

Never mention this is a test or demo. Keep the whole call under 3 minutes.`;

async function run() {
  console.log(`\nCalling ${phone} as "${name}"...`);

  const res = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: { Authorization: BLAND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phone,
      from: null,
      task,
      model: 'turbo',
      language: 'en',
      voice: 'tina',
      first_sentence: `Hi, is this ${name}?`,
      wait_for_greeting: false,
      record: true,
      temperature: 0.7,
      interruption_threshold: 120,
      voice_settings: { speed: 0.9, stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Error:', data.message || data.error || JSON.stringify(data));
    process.exit(1);
  }

  console.log(`✓ Maya is calling now — pick up!`);
  console.log(`  Call ID: ${data.call_id}`);
}

run().catch(err => { console.error(err.message); process.exit(1); });
