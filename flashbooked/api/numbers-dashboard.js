// GET /api/numbers-dashboard
//   — Cross-references every Twilio number on the FlashBooked account with Retell's phone
//     number registry, so "which number is used by who" is always answered from live state
//     instead of a manually-maintained list that drifts. Read-only.

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TRUNKING_API = 'https://trunking.twilio.com/v1';
const RETELL_API = 'https://api.retellai.com';

async function twilioGet(path) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`${path}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Twilio GET ${path} -> ${res.status}`);
  return res.json();
}

async function retellGet(path) {
  const res = await fetch(`${RETELL_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Retell GET ${path} -> ${res.status}`);
  return res.json();
}

async function retellPost(path, body) {
  const res = await fetch(`${RETELL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Retell POST ${path} -> ${res.status}`);
  return res.json();
}

const INCLUDED_MINUTES_PER_MONTH = 300; // standard FlashBooked founding-client package allowance

// Pulls this-agent's calls and sums duration for the current calendar month. Fetches the most
// recent 200 calls (descending) and filters client-side by start_timestamp, rather than relying
// on server-side date filtering — simpler and plenty for early-stage call volumes.
async function monthToDateUsage(agentId) {
  const calls = await retellPost('/v2/list-calls', {
    filter_criteria: { agent_id: [agentId] },
    sort_order: 'descending',
    limit: 200,
  });

  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  const thisMonth = (Array.isArray(calls) ? calls : []).filter(
    c => (c.start_timestamp || 0) >= monthStart
  );

  const totalMs = thisMonth.reduce((sum, c) => sum + (c.duration_ms || 0), 0);
  return {
    calls_this_month: thisMonth.length,
    minutes_used: Math.round((totalMs / 60000) * 10) / 10,
    included_minutes: INCLUDED_MINUTES_PER_MONTH,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (!sid || !process.env.TWILIO_AUTH_TOKEN) {
    return res.status(500).json({ error: 'Twilio credentials not configured' });
  }
  if (!process.env.RETELL_API_KEY) {
    return res.status(500).json({ error: 'RETELL_API_KEY not configured' });
  }

  try {
    const [twilioNumbers, retellNumbers, trunks] = await Promise.all([
      twilioGet(`${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`)
        .then(d => d.incoming_phone_numbers || []),
      retellGet('/list-phone-numbers'),
      twilioGet(`${TRUNKING_API}/Trunks`).then(d => d.trunks || []),
    ]);

    const trunkById = Object.fromEntries(trunks.map(t => [t.sid, t]));
    const retellByNumber = Object.fromEntries(retellNumbers.map(n => [n.phone_number, n]));

    // Agent names for any connected agents (nickname is usually descriptive enough, but the
    // real agent_name is a useful cross-check).
    const agentIds = [...new Set(
      retellNumbers.flatMap(n => (n.inbound_agents || []).map(a => a.agent_id))
    )];
    const agents = await Promise.all(
      agentIds.map(id => retellGet(`/get-agent/${id}`).catch(() => null))
    );
    const agentNameById = Object.fromEntries(
      agents.filter(Boolean).map(a => [a.agent_id, a.agent_name])
    );

    // Usage lookups only make sense for numbers with a live agent — fetch them in parallel,
    // keyed by agent_id, tolerating individual failures without breaking the whole response.
    const liveAgentIds = [...new Set(
      twilioNumbers
        .filter(tw => tw.trunk_sid && retellByNumber[tw.phone_number]?.inbound_agents?.[0])
        .map(tw => retellByNumber[tw.phone_number].inbound_agents[0].agent_id)
    )];
    const usageEntries = await Promise.all(
      liveAgentIds.map(id => monthToDateUsage(id).then(u => [id, u]).catch(() => [id, null]))
    );
    const usageByAgentId = Object.fromEntries(usageEntries);

    const numbers = twilioNumbers.map(tw => {
      const e164 = tw.phone_number;
      const retell = retellByNumber[e164];
      const trunk = tw.trunk_sid ? trunkById[tw.trunk_sid] : null;
      const inboundAgent = retell?.inbound_agents?.[0];

      let status, usedBy, note;
      if (retell && trunk && inboundAgent) {
        status = 'live-ai-agent';
        usedBy = retell.nickname || agentNameById[inboundAgent.agent_id] || inboundAgent.agent_id;
        note = `Routed via Twilio trunk "${trunk.friendly_name}" → Retell agent`;
      } else if (retell && !trunk) {
        status = 'retell-registered-not-routed';
        usedBy = retell.nickname || '(unnamed)';
        note = 'Registered in Retell but no Twilio trunk found — calls will not reach the agent yet';
      } else if (tw.voice_url && tw.voice_url.includes('twiml-forward')) {
        status = 'manual-forward';
        usedBy = 'Adam (personal testing line)';
        note = `Forwards to a real phone via twiml-forward.js — not an AI agent`;
      } else if (tw.voice_url === 'https://demo.twilio.com/welcome/voice/' || !tw.voice_url) {
        status = 'unconfigured';
        usedBy = null;
        note = 'Not wired to anything — Twilio default demo greeting';
      } else {
        status = 'other';
        usedBy = null;
        note = `Voice URL: ${tw.voice_url}`;
      }

      const usage = inboundAgent ? usageByAgentId[inboundAgent.agent_id] : null;

      return {
        phone_number: e164,
        friendly_name: tw.friendly_name,
        status,
        used_by: usedBy,
        retell_agent_id: inboundAgent?.agent_id || null,
        retell_agent_name: inboundAgent ? (agentNameById[inboundAgent.agent_id] || null) : null,
        twilio_trunk_name: trunk?.friendly_name || null,
        voice_url: tw.voice_url || null,
        note,
        usage_this_month: usage,
      };
    });

    return res.status(200).json({ generatedAt: new Date().toISOString(), numbers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
