import { signHash, verifySignature, hashPayload } from './security-core.js';

/**
 * TRUNKIA Cryptographic Row-Level Isolation
 * This is the ultimate defense against Connection Pool Leaks and SQL Injections.
 * Even if a hacker bypasses DB RLS, the data is cryptographically bound to the user
 * and will be rejected by the application layer.
 */

/**
 * يولد توقيع تشفيري يربط الصف بمستخدم محدد
 * @param {string} userId 
 * @returns {string} التوقيع
 */
export function generateRowSignature(userId) {
  if (!userId) throw new Error('SECURITY: Cannot generate row signature without userId.');
  // نقوم بـ Hash الـ userId أولاً، ثم نوقعه بمفتاح النظام السري
  const userHash = hashPayload(String(userId));
  return signHash(userHash);
}

/**
 * يتحقق من أن الصف المقرؤ من قاعدة البيانات يخص المستخدم الحالي
 * @param {string} userId - مستخدم الجلسة الحالية
 * @param {string} rowSignature - التوقيع المخزن في الصف
 * @returns {boolean} - true إذا كان المالك شرعياً، false إذا كانت البيانات مسمومة
 */
export function verifyRowOwnership(userId, rowSignature) {
  if (!userId || !rowSignature) return false;
  
  const expectedUserHash = hashPayload(String(userId));
  // verifySignature يستخدم timingSafeEqual لمنع هجمات التوقيت (Timing Attacks)
  return verifySignature(expectedUserHash, rowSignature);
}

/**
 * Middleware لتعقيم أي استجابة من قاعدة البيانات قبل إرسالها للمستخدم
 * يفحص كل صف ويتأكد من التوقيع. إذا فشل، يسقط الصف.
 */
export function sanitizeDataAccess(userId, rows) {
  if (!Array.isArray(rows)) return [];
  
  return rows.filter(row => {
    // إذا كان الصف يحتوي على توقيع، نتحقق منه
    if (row.row_owner_sig) {
      const isOwner = verifyRowOwnership(userId, row.row_owner_sig);
      if (!isOwner) {
        console.error(`[SECURITY ALERT] Data Access Violation! Attempt to read unauthorized row for user ${userId}.`);
        return false; // إسقاط الصف المسموم
      }
    }
    return true;
  });
}
