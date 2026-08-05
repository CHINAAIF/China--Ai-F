// ============================================================================
// TRUNKIA (VIGILANT-H) - SOVEREIGN INTELLIGENCE ROUTER
// ============================================================================

// مصفوفة النماذج المتاحة مرتبة حسب الأولوية والقوة (Cascading Matrix)
const MODEL_MATRIX = [
    { id: "llama-3.3-70b-versatile", type: "PRIMARY", maxTimeoutMs: 5000 },
    { id: "mixtral-8x7b-32768", type: "FALLBACK_1", maxTimeoutMs: 3000 },
    { id: "gemma-2-9b-it", type: "FALLBACK_2", maxTimeoutMs: 2000 }
];

/**
 * دالة مساعدة لتغليف أي استدعاء شبكي بقاطع تيار زمني (Timeout Circuit Breaker)
 */
const withTimeout = (promise, ms, modelId) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`ROUTER_TIMEOUT: Model ${modelId} exceeded ${ms}ms limit.`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

/**
 * الموجه الذكي: يحاول الاتصال بالنموذج الأساسي، وفي حال الفشل أو الضغط،
 * ينتقل فوراً للنموذج البديل دون كسر جلسة المستخدم.
 */
export class SovereignRouter {
    constructor(aiClientMock) {
        // نستخدم mock هنا للاختبار، وفي الإنتاج سيتم حقن دالة الـ Fetch الفعلية لـ Groq
        this.fetchAI = aiClientMock; 
    }

    async routeRequest(sanitizedPayload) {
        const auditTrail = [];

        for (const model of MODEL_MATRIX) {
            try {
                const startTime = Date.now();
                
                // تنفيذ الطلب مع قاطع التيار الزمني
                const response = await withTimeout(
                    this.fetchAI(model.id, sanitizedPayload),
                    model.maxTimeoutMs,
                    model.id
                );

                const latency = Date.now() - startTime;
                
                return {
                    status: "SUCCESS",
                    active_model: model.id,
                    latency_ms: latency,
                    audit_trail: auditTrail,
                    data: response
                };

            } catch (error) {
                // تسجيل الفشل والانتقال للنموذج التالي صمتاً (Silent Failover)
                auditTrail.push({ model: model.id, failed_reason: error.message });
                continue; 
            }
        }

        // إذا فشلت كل النماذج (حالة كارثية)
        throw new Error(`CRITICAL_SYSTEM_FAILURE: All models in the matrix failed. Trail: ${JSON.stringify(auditTrail)}`);
    }
}
