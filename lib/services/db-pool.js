// تم تحويل هذا الملف ليوجه الاستيرادات إلى المزود المركزي lib/db.js
import * as CentralDB from '../../lib/db.js';

export const getPool = (name = 'main') => CentralDB.getPool(name, CentralDB.generateDbToken('lib/services/db-pool.js'));
export const query = CentralDB.query;
export const getClient = () => CentralDB.getPool().connect();
export const shutdownPool = CentralDB.closePool;
export default CentralDB.pool;
