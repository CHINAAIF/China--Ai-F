import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: true } 
});

console.log('🧠 [النواة المركزية]: بدء عملية التطهير الهيكلي وحقن الـ 93 وكيل...');

async function run() {
    try {
        // 1. إسقاط الجداول القديمة المتضاربة لإنشاء قيود فريدة ونظيفة
        console.log('🧹 تصفير الهياكل القديمة المتضررة...');
        await pool.query(`
            DROP TABLE IF EXISTS agent_registry CASCADE;
            DROP TABLE IF EXISTS intelligence_sources CASCADE;
        `);

        // 2. إعادة البناء مع تحديد المفاتيح الأساسية (PRIMARY KEY) بشكل صارم
        console.log('🛠️ بناء الجداول السيادية بالقيود الصحيحة...');
        await pool.query(`
            CREATE TABLE agent_registry (
                agent_name TEXT PRIMARY KEY,
                agent_layer TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                model_provider TEXT DEFAULT 'groq'
            );
            CREATE TABLE intelligence_sources (
                source_name TEXT PRIMARY KEY,
                source_type TEXT,
                source_url TEXT,
                language TEXT,
                is_chinese_source BOOLEAN,
                reliability_score INT,
                crawl_frequency_hours INT
            );
        `);

        // 3. مصفوفة الـ 93 وكيل
        const agents = [
          { name: 'china_social_agent', layer: 'intelligence' },
          { name: 'china_policy_agent', layer: 'intelligence' },
          { name: 'china_company_agent', layer: 'intelligence' },
          { name: 'china_research_agent', layer: 'intelligence' },
          { name: 'china_investment_agent', layer: 'intelligence' },
          { name: 'china_patent_agent', layer: 'intelligence' },
          { name: 'china_sanctions_agent', layer: 'intelligence' },
          { name: 'china_media_agent', layer: 'intelligence' },
          { name: 'global_models_agent', layer: 'intelligence' },
          { name: 'global_comparison_agent', layer: 'intelligence' },
          { name: 'global_price_gap_agent', layer: 'intelligence' },
          { name: 'competitor_monitor_agent', layer: 'intelligence' },
          { name: 'supply_chain_agent', layer: 'intelligence' },
          { name: 'benchmark_analyst_agent', layer: 'analysis' },
          { name: 'pricing_tracker_agent', layer: 'analysis' },
          { name: 'competitor_analysis_agent', layer: 'analysis' },
          { name: 'sentiment_analysis_agent', layer: 'analysis' },
          { name: 'trend_prediction_agent', layer: 'analysis' },
          { name: 'price_prediction_agent', layer: 'analysis' },
          { name: 'release_prediction_agent', layer: 'analysis' },
          { name: 'gap_finder_agent', layer: 'analysis' },
          { name: 'content_writer_agent', layer: 'content' },
          { name: 'translation_ar_agent', layer: 'content' },
          { name: 'translation_zh_agent', layer: 'content' },
          { name: 'translation_es_agent', layer: 'content' },
          { name: 'translation_ru_agent', layer: 'content' },
          { name: 'translation_fr_agent', layer: 'content' },
          { name: 'seo_agent', layer: 'content' },
          { name: 'image_agent', layer: 'content' },
          { name: 'summary_agent', layer: 'content' },
          { name: 'distribution_agent', layer: 'content' },
          { name: 'adsense_agent', layer: 'content' },
          { name: 'prompt_optimizer_agent', layer: 'content' },
          { name: 'cyber_defense_agent', layer: 'security' },
          { name: 'threat_monitor_agent', layer: 'security' },
          { name: 'compliance_agent', layer: 'security' },
          { name: 'ip_protection_agent', layer: 'security' },
          { name: 'data_sovereignty_agent', layer: 'security' },
          { name: 'attack_prevention_agent', layer: 'security' },
          { name: 'fraud_detection_agent', layer: 'security' },
          { name: 'notification_agent', layer: 'service' },
          { name: 'email_agent', layer: 'service' },
          { name: 'price_alert_agent', layer: 'service' },
          { name: 'user_retention_agent', layer: 'service' },
          { name: 'personal_report_agent', layer: 'service' },
          { name: 'onboarding_agent', layer: 'service' },
          { name: 'support_agent', layer: 'service' },
          { name: 'search_agent', layer: 'service' },
          { name: 'recommendation_agent', layer: 'service' },
          { name: 'user_behavior_agent', layer: 'service' },
          { name: 'subscription_agent', layer: 'service' },
          { name: 'billing_agent', layer: 'service' },
          { name: 'webhook_agent', layer: 'service' },
          { name: 'master_orchestrator', layer: 'governance' },
          { name: 'task_distributor', layer: 'governance' },
          { name: 'quality_auditor', layer: 'governance' },
          { name: 'emergency_agent', layer: 'governance' },
          { name: 'scheduler_agent', layer: 'governance' },
          { name: 'filter_agent', layer: 'learning' },
          { name: 'verification_agent', layer: 'learning' },
          { name: 'approval_agent', layer: 'learning' },
          { name: 'learning_agent', layer: 'learning' },
          { name: 'platform_health_agent', layer: 'service' },
          { name: 'db_guardian_agent', layer: 'service' },
          { name: 'performance_agent', layer: 'service' },
          { name: 'backup_agent', layer: 'service' },
          { name: 'cache_agent', layer: 'service' },
          { name: 'cdn_agent', layer: 'service' },
          { name: 'api_monitor_agent', layer: 'service' },
          { name: 'error_recovery_agent', layer: 'service' },
          { name: 'session_agent', layer: 'service' },
          { name: 'rate_limit_agent', layer: 'service' },
          { name: 'ssl_agent', layer: 'service' },
          { name: 'log_analyzer_agent', layer: 'service' },
          { name: 'ui_optimizer_agent', layer: 'service' },
          { name: 'db_updater_agent', layer: 'service' },
          { name: 'auto_operator_agent', layer: 'service' },
          { name: 'dashboard_agent', layer: 'service' },
          { name: 'content_quality_agent', layer: 'content' },
          { name: 'editorial_agent', layer: 'content' },
          { name: 'consistency_agent', layer: 'analysis' },
          { name: 'truth_verifier_agent', layer: 'analysis' },
          { name: 'fact_checker_agent', layer: 'analysis' },
          { name: 'ab_testing_agent', layer: 'service' },
          { name: 'revenue_optimizer_agent', layer: 'service' },
          { name: 'geo_expansion_agent', layer: 'service' },
          { name: 'crisis_agent', layer: 'governance' },
          { name: 'reputation_agent', layer: 'service' },
          { name: 'partnership_agent', layer: 'service' },
          { name: 'dynamic_pricing_agent', layer: 'service' },
          { name: 'broken_links_agent', layer: 'service' },
          { name: 'sitemap_agent', layer: 'content' },
          { name: 'keyword_agent', layer: 'content' },
          { name: 'weekly_digest_agent', layer: 'content' }
        ];

        for (const agent of agents) {
            await pool.query(
                `INSERT INTO agent_registry (agent_name, agent_layer) VALUES ($1, $2)
                 ON CONFLICT (agent_name) DO NOTHING`, [agent.name, agent.layer]
            );
        }
        console.log(`✅ تم تسجيل وحقن عتاد الـ ${agents.length} وكيل بنجاح.`);

        // 4. حقن مصادر الاستخبارات
        const sources = [
          { name: 'Zhihu AI', url: 'https://www.zhihu.com/topic/19554298', type: 'social_media', lang: 'zh', chinese: true, score: 80 },
          { name: 'Weibo AI', url: 'https://weibo.com', type: 'social_media', lang: 'zh', chinese: true, score: 70 },
          { name: 'MIIT Official', url: 'https://www.miit.gov.cn', type: 'government', lang: 'zh', chinese: true, score: 95 },
          { name: 'CAS Research', url: 'https://www.cas.cn', type: 'research', lang: 'zh', chinese: true, score: 90 },
          { name: 'CNIPA Patents', url: 'https://www.cnipa.gov.cn', type: 'patent', lang: 'zh', chinese: true, score: 95 }
        ];

        for (const src of sources) {
            await pool.query(
                `INSERT INTO intelligence_sources 
                 (source_name, source_type, source_url, language, is_chinese_source, reliability_score, crawl_frequency_hours)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (source_name) DO NOTHING`,
                [src.name, src.type, src.url, src.lang, src.chinese, src.score, 3]
            );
        }
        console.log(`✅ تم تأمين وحقن ${sources.length} مصادر استخباراتية بنجاح وبدون أخطاء.`);

    } catch (err) {
        console.error('🛑 خطأ تدميري أثناء التهيئة:', err.message);
    } finally {
        await pool.end();
    }
}

run();
