// GET  /api/tasks?secret=bc2026               — fetch tasks
// POST /api/tasks?secret=bc2026               — save tasks  { tasks: [...] }
// GET  /api/tasks?secret=bc2026&type=onboarding — fetch onboarding state
// POST /api/tasks?secret=bc2026&type=onboarding — save onboarding state { data: {...} }
// Backed by Vercel KV. Enable KV in Vercel dashboard to activate.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.query.secret !== 'bc2026') return res.status(401).json({ error: 'unauthorized' });

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const isOnboarding = req.query.type === 'onboarding';
  const kvKey = isOnboarding ? 'bc-onboarding' : 'bc-tasks';

  if (!KV_URL || !KV_TOKEN) {
    if (req.method === 'GET') return res.status(200).json(isOnboarding ? { data: {}, kvConfigured: false } : { tasks: [], kvConfigured: false });
    return res.status(200).json({ ok: true, kvConfigured: false });
  }

  const kvHeaders = { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const r = await fetch(`${KV_URL}/get/${kvKey}`, { headers: kvHeaders });
    const { result } = await r.json();
    if (isOnboarding) {
      const data = result ? JSON.parse(result) : {};
      return res.status(200).json({ data, kvConfigured: true });
    }
    const tasks = result ? JSON.parse(result) : [];
    return res.status(200).json({ tasks, kvConfigured: true });
  }

  if (req.method === 'POST') {
    const body = isOnboarding ? JSON.stringify(req.body?.data ?? {}) : JSON.stringify(req.body?.tasks ?? []);
    await fetch(`${KV_URL}/set/${kvKey}`, { method: 'POST', headers: kvHeaders, body });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
};
