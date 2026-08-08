import { getPool, generateDbToken } from '../../lib/db.js';
if (!process.env.DATABASE_URL_LEARNING) {
  throw new Error('CRITICAL: DATABASE_URL_LEARNING غير معرّف — وكلاء التعلم لا يمكنها العمل بدون دور مخصص');
}

export const pool = getPool('learning', generateDbToken('agents/learning/db-learning.js'));

pool.on('error', (err) => {
  console.error('[agent_learning_role pool] error:', err.message);
});

export default pool;
