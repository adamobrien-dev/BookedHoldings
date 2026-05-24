// GET /api/pipeline-stages — temporary, delete after use
// Lists all pipelines and stages for the agency location

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const AGENCY_LOC = 'NKpzhLv8iNQ0c9Ge3QAR';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const pit = process.env.GHL_PIT_AGENCY || 'pit-50489259-62a0-4120-9323-81362a9806ac';

  const r = await fetch(`${GHL_API}/opportunities/search?location_id=${AGENCY_LOC}&limit=100`, {
    headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION },
  });
  const data = await r.json();
  const opps = data?.opportunities || [];

  // Extract unique stages from live opp data
  const seen = new Map();
  for (const o of opps) {
    if (o.pipelineStageId && !seen.has(o.pipelineStageId)) {
      seen.set(o.pipelineStageId, {
        stageId: o.pipelineStageId,
        stageName: o.pipelineStageName,
        pipelineId: o.pipelineId,
        pipelineName: o.pipeline?.name || null,
        contacts: [],
      });
    }
    if (o.pipelineStageId) {
      seen.get(o.pipelineStageId).contacts.push(o.contact?.name || 'unknown');
    }
  }

  res.status(200).json({ stageCount: seen.size, stages: Array.from(seen.values()) });
};
