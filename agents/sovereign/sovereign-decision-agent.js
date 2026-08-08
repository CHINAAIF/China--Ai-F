import { BaseAgent } from '../base-agent.js';
import { queryData } from '../../lib/tools/sql-tool.js';
import { readMemory } from '../../lib/blackboard.js';
import { cognitiveGovernment } from '../../lib/cognitive-government.js';

class SovereignDecisionAgent extends BaseAgent {
  constructor() {
    super('sovereign_decision', 'sovereign');
  }

  async run() {
    try {
      const verificationSignal = await readMemory('analysis:verification_complete');
      if (!verificationSignal) {
        return { success: true, message: 'No verified analyses. Decision agent resting.' };
      }

      const sql = `SELECT id FROM intelligence_raw 
                   WHERE metadata->'verification'->>'verdict' = 'SURVIVED'
                   AND metadata->'sovereign_decision' IS NULL
                   ORDER BY collected_at DESC LIMIT 1`;
      
      const readIntent = { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' };
      const dbResult = await queryData(sql, [], 'intelligence', this.name, 'sovereign_system', readIntent);
      
      if (!dbResult.success || dbResult.rows.length === 0) {
        return { success: true, message: 'No survived analyses awaiting decision.' };
      }

      const itemId = dbResult.rows[0].id;
      const result = await cognitiveGovernment.processDecision(itemId);

      return result;
    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

export const sovereignDecisionAgent = new SovereignDecisionAgent();
export default sovereignDecisionAgent;
