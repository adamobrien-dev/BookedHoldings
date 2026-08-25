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
      };
    });

    return res.status(200).json({ generatedAt: new Date().toISOString(), numbers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
