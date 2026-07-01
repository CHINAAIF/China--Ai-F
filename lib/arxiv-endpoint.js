// arXiv endpoint loaded dynamically
import { arxivSentinelAgent } from '../agents/intelligence/arxiv-sentinel-agent.js';
export default function(app) {
  app.post('/api/intelligence/arxiv-scan', async (req, res) => {
    try {
      const result = await arxivSentinelAgent.scan(req.body.topic);
      if (!result.success) return res.status(500).json({ error: result.error });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
