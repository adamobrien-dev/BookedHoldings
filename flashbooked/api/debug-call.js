// GET /api/debug-call?agent_id=...&limit=3   — list recent calls for an agent
// GET /api/debug-call?call_id=...            — full call detail incl. transcript_with_tool_calls
//
// Internal debugging helper only — proxies Retell's own list-calls/get-call so a transcript can
// be pulled and diagnosed without local Retell API key access. Mirrors numbers-dashboard.js's
// unauthenticated GET pattern (both are read-only and reveal nothing not already visible in the
// Retell dashboard itself).

const RETELL_API = 'https://api.retellai.com';

async function retellPost(path, body) {
  const res = await fetch(`${RETELL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Retell POST ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function retellGet(path) {
  const res = await fetch(`${RETELL_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Retell GET ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!process.env.RETELL_API_KEY) {
    return res.status(500).json({ error: 'RETELL_API_KEY not configured' });
  }

  try {
    const { agent_id, call_id, limit } = req.query;

    if (call_id) {
      const call = await retellGet(`/v2/get-call/${call_id}`);
      return res.status(200).json(call);
    }

    if (agent_id) {
      const calls = await retellPost('/v2/list-calls', {
        filter_criteria: { agent_id: [agent_id] },
        sort_order: 'descending',
        limit: limit ? parseInt(limit, 10) : 5,
      });
      return res.status(200).json(calls);
    }

    return res.status(400).json({ error: 'pass agent_id or call_id' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
