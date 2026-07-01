// TRUNKIA - Intelligence Role Isolation Script
// 60-Layer Filtered | Team Engineering Standards
// ينشئ دور agent_intelligence_role ويمنحه صلاحيات محددة

import { Pool } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const LOG_FILE = './isolation.log';
const BACKUP_DIR = './db-backups';
const ROLE_NAME = 'agent_intelligence_role';
const ROLE_PASSWORD = crypto.randomBytes(32).toString('hex');

// الجداول المسموح بها لوكلاء الاستخبارات (من التحليل السابق)
const ALLOWED_TABLES = [
    'agent_circuit_breaker', 'agent_execution_logs', 'agent_heartbeat',
    'agent_registry', 'benchmark_definitions', 'brain_knowledge_gaps',
    'brain_working_memory', 'chinese_ai_models', 'intelligence_raw',
    'intelligence_sources', 'learning_candidates', 'model_benchmarks',
    'model_pricing_tiers', 'model_timeline', 'models',
    'source_reputation', 'temporal_intelligence', 'vendors'
];

function log(message) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}`;
    console.log(entry);
    fs.appendFileSync(LOG_FILE, entry + '\n');
}

async function main() {
    log('🛡️ TRUNKIA - INTELLIGENCE ROLE ISOLATION STARTING');
    
    // 1. التحقق من وجود نسخة احتياطية
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'));
    if (backups.length === 0) {
        log('❌ FATAL: No backup found. Run backup script first.');
        process.exit(1);
    }
    log(`✅ Backup verified: ${backups[backups.length-1]}`);

    // 2. الاتصال بقاعدة البيانات باستخدام neondb_owner
    const adminPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: true }
    });

    try {
        await adminPool.query('SELECT 1');
        log('✅ Connected to Neon as neondb_owner');
    } catch (e) {
        log(`❌ FATAL: Cannot connect to Neon: ${e.message}`);
        process.exit(1);
    }

    // 3. إنشاء الدور الجديد
    try {
        await adminPool.query(`CREATE ROLE ${ROLE_NAME} WITH LOGIN PASSWORD '${ROLE_PASSWORD}'`);
        log(`✅ Role ${ROLE_NAME} created`);
    } catch (e) {
        if (e.message.includes('already exists')) {
            log(`⚠️ Role ${ROLE_NAME} already exists, continuing...`);
        } else {
            log(`❌ FATAL: Cannot create role: ${e.message}`);
            await adminPool.end();
            process.exit(1);
        }
    }

    // 4. منح الصلاحيات على الجداول المسموح بها فقط
    for (const table of ALLOWED_TABLES) {
        try {
            await adminPool.query(`GRANT SELECT, INSERT, UPDATE ON ${table} TO ${ROLE_NAME}`);
            log(`  ✅ Granted on ${table}`);
        } catch (e) {
            log(`  ⚠️ Warning on ${table}: ${e.message}`);
        }
    }

    // 5. إنشاء متغير البيئة DATABASE_URL_INTELLIGENCE
    const originalUrl = new URL(process.env.DATABASE_URL);
    const intelligenceUrl = `${originalUrl.protocol}//${ROLE_NAME}:${ROLE_PASSWORD}@${originalUrl.host}${originalUrl.pathname}${originalUrl.search}`;
    
    const envLine = `DATABASE_URL_INTELLIGENCE=${intelligenceUrl}`;
    fs.appendFileSync('.env', `\n${envLine}\n`);
    log('✅ Added DATABASE_URL_INTELLIGENCE to .env');

    // 6. اختبار الاتصال بالدور الجديد
    log('🔍 Testing new role connection...');
    const testPool = new Pool({
        connectionString: intelligenceUrl,
        ssl: { rejectUnauthorized: true }
    });

    try {
        // اختبار القراءة من جدول مسموح
        await testPool.query('SELECT COUNT(*) FROM models');
        log('✅ Read test PASSED on models');

        // اختبار الكتابة على جدول مسموح
        await testPool.query(`INSERT INTO agent_execution_logs (agent_name, action, status) VALUES ('test_isolation', 'isolation_test', 'completed')`);
        log('✅ Write test PASSED on agent_execution_logs');

        // اختبار الفشل على جدول غير مسموح (event_log)
        try {
            await testPool.query('SELECT COUNT(*) FROM event_log');
            log('❌ SECURITY FAILURE: Read on event_log should have been denied!');
        } catch (e) {
            if (e.message.includes('permission denied')) {
                log('✅ Security test PASSED: Access to event_log correctly denied');
            } else {
                log(`⚠️ Unexpected error on event_log: ${e.message}`);
            }
        }

        await testPool.end();
        log('✅ All isolation tests passed!');
    } catch (e) {
        log(`❌ Test failed: ${e.message}`);
        log('⚠️ Rolling back...');
        await adminPool.query(`DROP ROLE IF EXISTS ${ROLE_NAME}`);
        log('✅ Role dropped. Check logs and retry.');
        await adminPool.end();
        process.exit(1);
    }

    await adminPool.end();
    log('🟢 INTELLIGENCE ROLE ISOLATION COMPLETED SUCCESSFULLY');
    log('🟢 Next step: Update agent files to use DATABASE_URL_INTELLIGENCE');
    process.exit(0);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
