/**
 * إصلاح: الاعتماد على `pool` كمتغير مُصدَّر مباشرة من lib/db.js كان هشاً
 * (استدعاء فوري لـ getPool() وقت تحميل الوحدة، عرضة لمشاكل ترتيب
 * الاستيراد الدائري). الحل: استدعاء getPool() هنا كذلك، بشكل كسول (lazy).
 */
import { getPool, query, withTransaction, closePool } from '../../lib/db.js';

const pool = getPool('main');

export { pool, query, withTransaction, closePool };
export default pool;
