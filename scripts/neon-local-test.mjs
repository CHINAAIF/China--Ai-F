#!/usr/bin/env node
/**
 * أداة اختبار اتصال Neon محلياً عبر HTTP Driver
 * السبب: شبكة Termux تحجب TCP/5432 و6543 و443 (PostgreSQL Wire Protocol)
 * الحل: @neondatabase/serverless يتصل عبر HTTP بدل TCP — يعمل على الجوال
 * ملاحظة: للاستخدام المحلي فقط، الإنتاج يستخدم lib/db.js العادي
 */
import dotenv from 'dotenv'; dotenv.config();
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT NOW() as t, current_database() as db, version() as ver`;
console.log('✅ Neon متصل عبر HTTP');
console.log('الوقت:', r[0].t);
console.log('قاعدة البيانات:', r[0].db);
console.log('PostgreSQL:', r[0].ver.split(' ').slice(0,2).join(' '));
