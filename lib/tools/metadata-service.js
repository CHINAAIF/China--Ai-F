import { getPool, generateDbToken } from '../db.js';

export async function listAvailableTables(poolName = 'main') {
  try {
    const pool = getPool(poolName, generateDbToken('lib/tools/metadata-service.js'));
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    return { success: true, tables: result.rows.map(r => r.table_name) };
  } catch (err) {
    return { success: false, tables: [], error: err.message };
  }
}

export async function getTableSchema(tableName, poolName = 'main') {
  try {
    const pool = getPool(poolName, generateDbToken('lib/tools/metadata-service.js'));
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
    `, [tableName]);
    return { success: true, table: tableName, columns: result.rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
