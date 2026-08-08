// ============================================================================
// TRUNKIA (VIGILANT-H) - THE TRUTH TRIBUNAL (ZERO-TRUST MULTI-AGENT CORE)
// ============================================================================
import crypto from 'crypto';

/**
 * القاضي الحتمي: كود صارم (ليس ذكاء اصطناعي) لا يتأثر بالهلوسة.
 * وظيفته تقييم تقرير المدعي العام واتخاذ قرار قاطع بالرفض أو القبول.
 */
class DeterministicJudge {
    static deliverVerdict(generatorOutput, antagonistReport, originalPayloadHash) {
        // 1. التحقق من البصمة التشفيرية (منع تزوير تقرير المدعي العام)
        if (antagonistReport.payload_hash !== originalPayloadHash) {
            throw new Error("TRIBUNAL_VETO: Antagonist report hash mismatch. Possible memory tampering.");
        }

        // 2. الفحص الهيكلي الحتمي (هل المدعي العام تعرض للتسمم؟)
        if (!['CLEAN', 'POISONED', 'HALLUCINATION'].includes(antagonistReport.verdict)) {
            throw new Error("TRIBUNAL_VETO: Antagonist agent returned invalid verdict format.");
        }

        // 3. اتخاذ القرار السيادي
        if (antagonistReport.verdict !== 'CLEAN') {
            return {
                status: "VETOED",
                reason: antagonistReport.reason,
                confidence: antagonistReport.confidence
            };
        }

        return {
            status: "APPROVED",
            payload: generatorOutput
        };
    }
}

/**
 * المحكمة الثلاثية: تدير العزل (Sandboxing) بين المولد والمدعي العام.
 */
export class TruthTribunal {
    constructor(routerEngine) {
        this.router = routerEngine; // نستخدم الموجه السيادي الذي بنيناه سابقاً
    }

    async executeTrial(prompt, systemConstraints) {
        const startTime = Date.now();

        // 1. الجيل (Generator - Llama 3.3): يكتب الرد
        const generatorResult = await this.router.routeRequest({
            role: "GENERATOR",
            prompt: prompt
        });
        const generatedText = generatorResult.data.response;

        // إنشاء بصمة تشفيرية للرد لمنع التلاعب الجانبي
        const payloadHash = crypto.createHash('sha256').update(generatedText).digest('hex');

        // 2. المدعي العام (Antagonist - Gemma 2 / Mixtral): 
        // معزول تماماً. لا يرى الـ Prompt الأصلي. يرى فقط المخرجات والقيود.
        const antagonistResult = await this.router.routeRequest({
            role: "ANTAGONIST",
            task: "FIND_FLAWS_OR_POISON",
            constraints: systemConstraints,
            target_text: generatedText,
            hash_signature: payloadHash
        });

        // 3. الحكم (Deterministic Judge): الآلة التي لا ترحم
        const verdict = DeterministicJudge.deliverVerdict(
            generatedText,
            antagonistResult.data, // يجب أن يكون JSON مهيكل
            payloadHash
        );

        return {
            verdict: verdict,
            latency_ms: Date.now() - startTime,
            generator_model: generatorResult.active_model,
            antagonist_model: antagonistResult.active_model
        };
    }
}
