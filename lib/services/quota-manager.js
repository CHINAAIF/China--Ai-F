import { getPool, generateDbToken } from '../db.js';

const pool = getPool('main', generateDbToken('lib/services/quota-manager.js'));

/**
 * Atomic Quota Hold (Pre-Execution)
 * Prevents race conditions using PostgreSQL Row Locking (RETURNING).
 */
export async function holdQuota(userId, amount, requestId) {
  if (!userId || amount <= 0) return { success: false, error: 'INVALID_INPUT' };
  try {
    const res = await pool.query(
      `UPDATE user_quota 
       SET remaining_quota = remaining_quota - $1, 
           held_quota = held_quota + $1 
       WHERE user_id = $2 AND remaining_quota >= $1 
       RETURNING remaining_quota, held_quota;`,
      [amount, userId]
    );
    if (res.rows.length === 0) {
      // Either user doesn't exist or insufficient quota
      return { success: false, error: 'INSUFFICIENT_QUOTA' };
    }
    return { success: true, heldAmount: amount, remaining: res.rows[0].remaining_quota };
  } catch (err) {
    console.error('[QuotaManager] Hold failed:', err.message);
    return { success: false, error: 'DB_ERROR' };
  }
}

/**
 * Atomic Quota Settlement (Post-Execution)
 * Must be called in a `finally` block to prevent quota leaks.
 */
export async function settleQuota(userId, heldAmount, actualCost, requestId) {
  if (!userId || heldAmount <= 0) return { success: false, error: 'INVALID_INPUT' };
  
  // Ensure actualCost is not negative and does not exceed heldAmount
  const safeCost = Math.max(0, Math.min(actualCost, heldAmount));
  const refund = heldAmount - safeCost;
  
  try {
    const res = await pool.query(
      `UPDATE user_quota 
       SET remaining_quota = remaining_quota + $1, 
           held_quota = held_quota - $2,
           total_consumed = total_consumed + $3
       WHERE user_id = $4 
       RETURNING remaining_quota, held_quota;`,
      [refund, heldAmount, safeCost, userId]
    );
    
    if (res.rows.length === 0) {
      return { success: false, error: 'USER_NOT_FOUND' };
    }
    return { 
      success: true, 
      refunded: refund, 
      charged: safeCost, 
      remaining: res.rows[0].remaining_quota 
    };
  } catch (err) {
    console.error('[QuotaManager] Settle failed:', err.message);
    return { success: false, error: 'DB_ERROR' };
  }
}

export default { holdQuota, settleQuota };
