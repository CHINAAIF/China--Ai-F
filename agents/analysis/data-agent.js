import { BaseAgent } from '../base-agent.js';
import { multiModel } from '../governance/multi-model.js';
import { listAvailableTables, getTableSchema } from '../../lib/tools/metadata-service.js';
import { queryData } from '../../lib/tools/sql-tool.js';

class DataAgent extends BaseAgent {
  constructor() {
    super('data_agent', 'analysis');
  }

  /**
   * تنفيذ سؤال بلغة طبيعية واسترجاع البيانات
   * @param {string} question - سؤال المستخدم
   */
  async run(question) {
    try {
      // 1. جلب الميتاداتا (الجداول المتاحة)
      const tablesResult = await listAvailableTables('main');
      if (!tablesResult.success) throw new Error('Failed to fetch metadata');
      
      const availableTables = tablesResult.tables.slice(0, 20).join(', '); // نحدد 20 جدول لتوفير السياق
      
      // 2. توليد استعلام SQL عبر بوابة الاستدلال
      const prompt = `You are a SQL expert. Based on the question, generate a single read-only PostgreSQL query.
Available tables: ${availableTables}
Question: "${question}"

Rules:
- Return ONLY a JSON object: {"sql": "SELECT ...", "explanation": "..."}
- Use ONLY SELECT statements.
- Do not use any DDL or DML (DROP, INSERT, UPDATE).`;

      const inferenceResult = await multiModel.runSingle('sql_generation', prompt, 'You are a helpful SQL assistant.');
      
      if (!inferenceResult?.approved || !inferenceResult.content) {
        throw new Error('Inference failed during SQL generation.');
      }

      let sqlData;
      try {
        const cleanJson = inferenceResult.content.replace(/```json|```/g, '').trim();
        sqlData = JSON.parse(cleanJson);
      } catch (e) {
        throw new Error('Failed to parse SQL JSON from LLM.');
      }

      const sqlQuery = sqlData.sql;

      // 3. تنفيذ الاستعلام عبر الأداة الموحدة (SQL Tool)
      // الأداة ستقوم بفحص الأمان وتمنع أي استعلام خطير
      const executionResult = await queryData(sqlQuery, [], 'main', this.name);

      if (!executionResult.success) {
        throw new Error(`SQL Execution failed: ${executionResult.error}`);
      }

      // 4. إرجاع النتيجة النهائية
      return {
        success: true,
        question: question,
        sql_used: sqlQuery,
        explanation: sqlData.explanation,
        row_count: executionResult.rowCount,
        data: executionResult.rows
      };

    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

export const dataAgent = new DataAgent();
export default dataAgent;
