// تم تحويل هذا الملف ليوجه الاستيرادات إلى المزود المركزي lib/db.js
import { pool, query, withTransaction, closePool } from '../../lib/db.js';

export { pool, query, withTransaction, closePool };
export default pool;
