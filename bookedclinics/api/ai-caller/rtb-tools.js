// Called by Bland.ai mid-call to check calendar availability and book appointments.
// Bland.ai sends tool call requests as POST with a JSON body.
//
// Required env vars:
//   RTB_PIT           — GHL private integration token for RTB sub-account
//   RTB_CALENDAR_ID   — GHL calendar ID to query and book into

const GHL_API     = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const RTB_PIT         = process.env.RTB_PIT;
const RTB_CALENDAR_ID = process.env.RTB_CALENDAR_ID;

async function ghlFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${RTB_PIT}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${GHL_API}${path}`, opts);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// Returns next 5 available slots starting from today (or near the stated preference)
async function checkAvailability(preference) {
  const now = new Date();
  const startTime = now.toISOString();
  // Look 14 days out to find slots
  const endDate = new Date(now.getTime() + 14 * 86400000).toISOString();

  const data = await ghlFetch(
    `/calendars/${RTB_CALENDAR_ID}/free-slots?startDate=${encodeURIComponent(startTime)}&endDate=${encodeURIComponent(endDate)}&timezone=America%2FChicago`
  );

  if (!data || !data.slots) {
    return { slots: 'I was unable to pull the calendar right now. Let me take note of your preference and have Stephanie confirm with you.' };
  }

  // Flatten and format the first 6 slots
  const slots = [];
  const days = Object.entries(data.slots).sort(([a], [b]) => new Date(a) - new Date(b));

  for (const [, times] of days) {
    for (const slot of times) {
      if (slots.length >= 6) break;
      const d = new Date(slot.startTime);
      const label = d.toLocaleString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      });
      slots.push({ id: slot.id || slot.startTime, label, startTime: slot.startTime });
    }
    if (slots.length >= 6) break;
  }

  if (!slots.length) {
    return { slots: 'There are no open slots in the next two weeks. Let me have Stephanie reach out to confirm a time directly.' };
  }

  const formatted = slots.map((s, i) => `${i + 1}. ${s.label} (id: ${s.id})`).join(' | ');
  return { slots: formatted };
}

async function bookAppointment(contactId, slotId, serviceInterest) {
  if (!contactId || contactId === '') {
    return { confirmation: 'I was unable to book automatically, but I have noted your preferred time. Stephanie will confirm shortly.' };
  }

  const payload = {
    calendarId: RTB_CALENDAR_ID,
    contactId,
    startTime: slotId, // GHL accepts ISO string or slot ID
    title: `RTB Spa — ${serviceInterest || 'Consultation'}`,
    appointmentStatus: 'confirmed',
  };

  const data = await ghlFetch('/calendars/events/appointments', 'POST', payload);

  if (!data || !data.id) {
    return { confirmation: 'The booking ran into an issue, but your time is noted. Stephanie will confirm via text.' };
  }

  const apptTime = new Date(data.startTime).toLocaleString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  });

  return { confirmation: `You are booked for ${apptTime} at RTB Spa. You will receive a confirmation text shortly.` };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const action    = req.headers['x-tool-action'];
  const contactId = req.headers['x-contact-id'] || '';
  const body      = req.body || {};

  if (action === 'check_availability') {
    const result = await checkAvailability(body.preference || '');
    return res.status(200).json(result);
  }

  if (action === 'book_appointment') {
    const result = await bookAppointment(contactId, body.slot_id, body.service_interest);
    return res.status(200).json(result);
  }

  return res.status(400).json({ error: 'Unknown tool action' });
};
