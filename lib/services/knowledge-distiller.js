import { mutateData } from '../tools/sql-tool.js';
import crypto from 'crypto';

/**
 * TRUNKIA Governed Knowledge Distiller
 * Secures the learning process against Data Poisoning attacks.
 * Any knowledge insertion must pass through the Constitution and Sovereign Kernel.
 */
export async function distill(agentName, prompt, responseData, confidence, intentSignature) {
  if (!responseData || confidence < 80) return;

  try {
    const ruleText = typeof responseData === 'string'
      ? responseData.slice(0, 500)
      : JSON.stringify(responseData).slice(0, 500);

    const ruleHash = crypto.createHash('sha256')
      .update(agentName + ruleText)
      .digest('hex').slice(0, 64);

    const queryHash = crypto.createHash('sha256')
      .update(prompt.trim().toLowerCase())
      .digest('hex').slice(0, 64);

    // 1. فحص الدستور والنواة قبل كتابة المعرفة المحلية
    const localIntent = {
      agentName,
      userId: 'sovereign_system', // التعلم هو عملية على مستوى النظام
      action: 'execute_sql_write',
      layer: 'learning',
      table: 'sovereign_memory_local',
      signature: intentSignature // يجب أن يُمرر التوقيع من الوكيل المستدعي
    };

    const localSql = `
      INSERT INTO sovereign_memory_local 
        (query_hash, query_text, response_data, model_used, confidence, verified)
      VALUES ($1,$2,$3,$4,$5,true)
      ON CONFLICT (query_hash) DO UPDATE
        SET usage_count = sovereign_memory_local.usage_count + 1,
            last_used   = NOW(),
            confidence  = GREATEST(sovereign_memory_local.confidence, EXCLUDED.confidence)
    `;
    
    const localParams = [
      queryHash,
      prompt.slice(0, 1000),
      typeof responseData === 'object' ? responseData : { raw: responseData },
      agentName,
      Math.min(100, Math.max(0, Math.round(confidence)))
    ];

    const localResult = await mutateData(localSql, localParams, 'learning', agentName, 'sovereign_system', localIntent);
    if (!localResult.success) {
      throw new Error(`Constitution blocked local distillation: ${localResult.error}`);
    }

    // 2. فحص الدستور والنواة قبل ترقية المعرفة لقاعدة صلبة
    const ruleIntent = {
      agentName,
      userId: 'sovereign_system',
      action: 'execute_sql_write',
      layer: 'governance',
      table: 'knowledge_distillation',
      signature: intentSignature
    };

    const ruleSql = `
      INSERT INTO knowledge_distillation
        (rule_hash, rule_text, source_agent, confidence, is_permanent)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (rule_hash) DO UPDATE
        SET applied_count = knowledge_distillation.applied_count + 1
    `;
    
    const ruleParams = [
      ruleHash,
      ruleText,
      agentName,
      Math.min(100, Math.max(0, Math.round(confidence))),
      confidence >= 90
    ];

    const ruleResult = await mutateData(ruleSql, ruleParams, 'governance', agentName, 'sovereign_system', ruleIntent);
    if (!ruleResult.success) {
      throw new Error(`Constitution blocked rule distillation: ${ruleResult.error}`);
    }

    console.log(`[KnowledgeDistiller] Successfully distilled and verified rule from ${agentName}.`);

  } catch(e) {
    console.warn(`[KnowledgeDistiller] Distill error: ${e.message}`);
  }
}

export default { distill };
