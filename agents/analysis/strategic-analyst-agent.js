import { BaseAgent } from '../base-agent.js';
import { queryData, mutateData } from '../../lib/tools/sql-tool.js';
import { readMemory, writeMemory } from '../../lib/blackboard.js';

/**
 * TRUNKIA Strategic Analyst Agent
 * Event-Driven: Wakes up when sensory agents broadcast new data.
 * Synthesizes raw intelligence into strategic market trends.
 */
class StrategicAnalystAgent extends BaseAgent {
  constructor() {
    super('strategic_analyst', 'analysis');
  }

  async run() {
    try {
      // 1. الاستيقاظ: فحص الذاكرة المشتركة للإشارات الجديدة
      const newIntelSignal = await readMemory('intel:new_china_news');
      if (!newIntelSignal) {
        return { success: true, message: 'No new intelligence signals. Analyst resting.' };
      }

      // 2. جلب البيانات الخام غير المعالجة (Read-Only, System Origin)
      const sql = "SELECT id, title, raw_content FROM intelligence_raw WHERE is_verified = false AND category = 'chinese_ai' ORDER BY collected_at DESC LIMIT 5";
      const readIntent = { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'analysis', origin: 'system' };
      
      const dbResult = await queryData(sql, [], 'intelligence', this.name, 'sovereign_system', readIntent);
      if (!dbResult.success || dbResult.rows.length === 0) {
        return { success: true, message: 'No unverified raw data to analyze.' };
      }

      // 3. التركيب المعرفي (Cognitive Synthesis) عبر البوابة الآمنة
      const rawData = dbResult.rows.map(r => `- ${r.title}: ${r.raw_content.substring(0, 100)}`).join('\n');
      const prompt = `Analyze the following AI intelligence snippets. Synthesize them into a single strategic summary. Return JSON ONLY: {"trend": "...", "impact": "low|medium|high", "confidence": 0-100}\nData:\n${rawData}`;
      
      const inference = await this.think(prompt, 'You are a strategic AI market analyst.');
      if (inference.error || !inference.data) throw new Error(inference.error || 'Synthesis failed');

      const analysis = inference.data;

      // 4. الكتابة السيادية: تحديث البيانات الخام بنتيجة التحليل (Verified)
      const updateSql = "UPDATE intelligence_raw SET is_verified = true, metadata = jsonb_set(COALESCE(metadata, '{}'), '{strategic_analysis}', $1::jsonb) WHERE id = ANY($2::int[])";
      const updateParams = [JSON.stringify(analysis), dbResult.rows.map(r => r.id)];
      const writeIntent = { agentName: this.name, userId: 'sovereign_system', action: 'execute_sql_write', layer: 'analysis', origin: 'system', table: 'intelligence_raw' };
      
      const writeResult = await mutateData(updateSql, updateParams, 'intelligence', this.name, 'sovereign_system', writeIntent);
      if (!writeResult.success) throw new Error('Failed to save strategic analysis to DB.');

      // 5. البث المعرفي: إيقاظ طبقة القرار (Orchestrator)
      await writeMemory('analysis:new_strategic_trend', { trend: analysis.trend, impact: analysis.impact, timestamp: Date.now() }, 3600);

      return { success: true, analyzed: dbResult.rows.length, trend: analysis.trend };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

export const strategicAnalystAgent = new StrategicAnalystAgent();
export default strategicAnalystAgent;
