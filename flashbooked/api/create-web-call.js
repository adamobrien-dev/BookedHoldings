// POST /api/create-web-call  { agent_id }
//   — creates a Retell browser-based web call session for testing an agent directly from the
//     numbers dashboard, so Adam doesn't need to dial a real number to try one out. Returns an
//     access_token (valid 30s) for the Retell Web SDK to start the call with.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.RETELL_API_KEY) {
    return res.status(500).json({ error: 'RETELL_API_KEY not configured' });
  }

  const { agent_id } = req.body || {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id is required' });

  try {
    const r = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    return res.status(200).json({
      access_token: data.access_token,
      call_id: data.call_id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
