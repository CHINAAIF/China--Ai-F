import { BaseAgent } from '../base-agent.js';
import { mutateData } from '../../lib/tools/sql-tool.js';
import { writeMemory } from '../../lib/blackboard.js';

class ArxivSentinelAgent extends BaseAgent {
  constructor() {
    super('arxiv_sentinel', 'intelligence');
  }

  async run(topic = 'Artificial Intelligence') {
    try {
      const prompt = `List the 3 most recent and important AI research papers about "${topic}". Return ONLY a valid JSON array: [{"title": "...", "abstract": "...", "url": "..."}]`;
      
      // 1. التفكير الآمن عبر البوابة (محمي من الـ Injection)
      const inference = await this.think(prompt, 'You are an AI research analyst.');
      if (inference.error || !inference.data) throw new Error(inference.error || 'Inference failed');

      const papers = inference.data;
      let inserted = 0;

      // 2. الكتابة السيادية في قاعدة البيانات
      for (const paper of papers) {
        const sql = `INSERT INTO intelligence_raw (agent_name, content_type, raw_content, title, category, is_verified, collected_at)
                     VALUES ($1, 'research', $2, $3, 'arxiv', false, NOW()) ON CONFLICT DO NOTHING`;
        const params = [this.name, paper.abstract || 'No abstract', paper.title || 'Untitled'];
        
        // النية: النظام هو من يكتب (origin: 'system')، وليس الـ LLM
        const intent = { agentName: this.name, userId: 'sovereign_system', action: 'execute_sql_write', layer: 'intelligence', origin: 'system', table: 'intelligence_raw' };
        
        const dbResult = await mutateData(sql, params, 'intelligence', this.name, 'sovereign_system', intent);
        if (dbResult.success) inserted++;
      }

      // 3. الإذاعة في الذاكرة المشتركة (إيقاظ وكلاء التحليل)
      if (inserted > 0) {
        await writeMemory('intel:new_research', { topic, count: inserted, timestamp: Date.now() }, 3600);
      }

      return { success: true, inserted, model: inference.model };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

export const arxivSentinelAgent = new ArxivSentinelAgent();
export default arxivSentinelAgent;
