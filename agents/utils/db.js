/**
 * إصلاح: الاعتماد على `pool` كمتغير مُصدَّر مباشرة من lib/db.js كان هشاً
 * (استدعاء فوري لـ getPool('main', generateDbToken('agents/utils/db.js')) وقت تحميل الوحدة، عرضة لمشاكل ترتيب
 * الاستيراد الدائري). الحل: استدعاء getPool('main', generateDbToken('agents/utils/db.js')) هنا كذلك، بشكل كسول (lazy).
 */
import { getPool, query, withTransaction, closePool, generateDbToken } from '../../lib/db.js';

const pool = getPool('main', generateDbToken('agents/utils/db.js'));

export { pool, query, withTransaction, closePool };
export default pool;
