// تم تحويل هذا الملف ليوجه الاستيرادات إلى المزود المركزي lib/db.js
import * as CentralDB from '../../lib/db.js';

export const pool = CentralDB.pool;
export const query = CentralDB.query;
export const withTransaction = CentralDB.withTransaction;
export const closePool = CentralDB.closePool;
export default CentralDB.pool;
