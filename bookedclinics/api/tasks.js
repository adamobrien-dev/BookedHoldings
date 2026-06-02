// GET  /api/tasks?secret=bc2026          — fetch all tasks
// POST /api/tasks?secret=bc2026          — overwrite all tasks (body: { tasks: [...] })
// Backed by Vercel KV (Upstash REST). Enable KV in Vercel dashboard to activate.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.query.secret !== 'bc2026') return res.status(401).json({ error: 'unauthorized' });

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    // KV not configured — return empty store so client falls back to localStorage
    if (req.method === 'GET') return res.status(200).json({ tasks: [], kvConfigured: false });
    return res.status(200).json({ ok: true, kvConfigured: false });
  }

  const kvHeaders = { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const r = await fetch(`${KV_URL}/get/bc-tasks`, { headers: kvHeaders });
    const { result } = await r.json();
    const tasks = result ? JSON.parse(result) : [];
    return res.status(200).json({ tasks, kvConfigured: true });
  }

  if (req.method === 'POST') {
    const tasks = req.body?.tasks ?? [];
    await fetch(`${KV_URL}/set/bc-tasks`, {
      method: 'POST',
      headers: kvHeaders,
      body: JSON.stringify(tasks),
    });
    return res.status(200).json({ ok: true, saved: tasks.length });
  }

  return res.status(405).end();
};
