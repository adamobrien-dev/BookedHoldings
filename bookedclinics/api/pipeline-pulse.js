const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

async function ghlFetch(path, pit) {
  try {
    const r = await fetch(`${GHL_API}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-4c3b0e38-6f82-4429-a33a-b54628e9a03d';
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayEnd   = new Date().setHours(23, 59, 59, 999);

  const [oppsData, convosData, eventsData] = await Promise.all([
    ghlFetch(`/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, pit),
    ghlFetch(`/conversations/search?locationId=${AGENCY_LOC}&limit=100&sortBy=last_message_date&sortOrder=desc`, pit),
    ghlFetch(`/calendars/events?locationId=${AGENCY_LOC}&startTime=${todayStart}&endTime=${todayEnd}`, pit),
  ]);

  const opps   = (oppsData?.opportunities  || []).filter(o => o.status !== 'lost');
  const convos = convosData?.conversations || [];
  const events = eventsData?.events        || [];

  // Index conversations by contactId
  const convoByContact = {};
  for (const c of convos) {
    if (c.contactId) convoByContact[c.contactId] = c;
  }

  // Today's calls
  const callsToday = events
    .filter(e => e.status !== 'cancelled')
    .map(e => {
      const convo = convoByContact[e.contactId] || {};
      const lastMsg = (convo.lastMessageBody || '').toLowerCase();
      const confirmed = lastMsg.includes('confirm') || lastMsg === 'received' ||
        lastMsg.includes('see you') || lastMsg.includes('yes') || lastMsg.includes('i\'ll be there');
      return {
        contactId:    e.contactId,
        name:         e.title || 'Unknown',
        phone:        convo.phone || null,
        time:         e.startTime,
        confirmed,
        lastMessage:  convo.lastMessageBody || null,
        unreadCount:  convo.unreadCount || 0,
      };
    })
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  // Unread messages (inbound replies waiting on response)
  const unreadMessages = convos
    .filter(c => c.unreadCount > 0)
    .map(c => ({
      id:            c.id,
      contactId:     c.contactId,
      name:          c.contactName || c.fullName || 'Unknown',
      phone:         c.phone || null,
      lastMessage:   c.lastMessageBody,
      lastMessageAt: c.lastMessageDate,
      unreadCount:   c.unreadCount,
    }));

  // Stuck leads — same stage for 5+ days
  const stuckLeads = opps
    .map(o => {
      const convo = convoByContact[o.contact?.id] || {};
      return {
        contactId:   o.contact?.id,
        name:        o.contact?.name || 'Unknown',
        phone:       o.contact?.phone || null,
        stage:       o.pipelineStageName,
        daysInStage: Math.floor((now - new Date(o.lastStageChangeAt).getTime()) / 86400000),
        lastMessage: convo.lastMessageBody || null,
        unreadCount: convo.unreadCount || 0,
      };
    })
    .filter(o => o.daysInStage >= 5)
    .sort((a, b) => b.daysInStage - a.daysInStage);

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    callsToday,
    unreadMessages,
    stuckLeads,
    summary: {
      callsToday: callsToday.length,
      unread:     unreadMessages.length,
      stuck:      stuckLeads.length,
    },
  });
};
