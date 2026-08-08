import { BaseAgent } from '../base-agent.js';
import { mutateData } from '../../lib/tools/sql-tool.js';
import { writeMemory } from '../../lib/blackboard.js';

class ChinaNewsAgent extends BaseAgent {
  constructor() {
    super('china_news_agent', 'intelligence');
    this.topics = ['Chinese AI models 2025', 'DeepSeek latest news', 'Alibaba Qwen updates', 'Baidu ERNIE AI'];
  }

  async run() {
    let totalProcessed = 0;

    for (const topic of this.topics) {
      try {
        const prompt = `Summarize the latest news about: ${topic}. Return JSON: {"title":"...","summary":"...","importance":1-10,"sentiment":"positive|negative|neutral"}`;
        
        const inference = await this.think(prompt, 'You are a helpful AI news assistant.');
        if (inference.error || !inference.data) continue;

        const data = inference.data;
        const sql = `INSERT INTO intelligence_raw (agent_name, content_type, raw_content, title, category, importance_score, sentiment, is_verified, collected_at)
                     VALUES ($1, 'news', $2, $3, 'chinese_ai', $4, $5, false, NOW()) ON CONFLICT DO NOTHING`;
        const params = [this.name, data.summary, data.title, data.importance || 5, data.sentiment || 'neutral'];
        
        const intent = { agentName: this.name, userId: 'sovereign_system', action: 'execute_sql_write', layer: 'intelligence', origin: 'system', table: 'intelligence_raw' };
        
        const dbResult = await mutateData(sql, params, 'intelligence', this.name, 'sovereign_system', intent);
        if (dbResult.success) totalProcessed++;
        
      } catch (e) {
        console.error(`[${this.name}] Error processing ${topic}:`, e.message);
      }
    }

    if (totalProcessed > 0) {
      await writeMemory('intel:new_china_news', { count: totalProcessed, timestamp: Date.now() }, 3600);
    }

    return { success: true, processed: totalProcessed };
  }
}

export const chinaNewsAgent = new ChinaNewsAgent();
export default chinaNewsAgent;
