import { SovereignRouter } from './lib/sovereign-router.js';

console.log("=================================================");
console.log("🌌 TRUNKIA SOVEREIGN ROUTER & FAILOVER TEST");
console.log("=================================================\n");

// محاكاة واجهة برمجة التطبيقات (API Mock) لإثبات قوة الموجه
const mockGroqNetwork = async (modelId, payload) => {
    // محاكاة تأخير الشبكة
    await new Promise(resolve => setTimeout(resolve, 50));

    // افتعال عطل في النموذج الأساسي لإثبات قدرة النظام على التعافي الذاتي
    if (modelId === "llama-3.3-70b-versatile") {
        throw new Error("HTTP 429: Rate Limit Exceeded (Server Overload)");
    }
    
    // النموذج البديل سينجح
    return { response: "Generated securely from fallback model." };
};

const router = new SovereignRouter(mockGroqNetwork);
const testPayload = { prompt: "Analyze this secure data." };

async function runRoutingTest() {
    console.log("--- 🛡️ INITIATING CASCADING FAILOVER TEST ---");
    console.log("Scenario: Primary Model (Llama-3.3) is suffering a DDoS / Rate Limit attack.\n");

    try {
        const result = await router.routeRequest(testPayload);
        
        if (result.status === "SUCCESS" && result.active_model === "mixtral-8x7b-32768") {
            console.log(`[PASS] ✅ Cascading Failover Successful!`);
            console.log(`       ℹ️ Active Model Used: ${result.active_model}`);
            console.log(`       ℹ️ Latency: ${result.latency_ms}ms`);
            console.log(`       🚨 Audit Trail (Failures bypassed):`);
            console.table(result.audit_trail);
            
            console.log("\n=================================================");
            console.log(`🏆 ROUTER TEST COMPLETE: 1/1 PASSED`);
            console.log("=================================================");
        } else {
            console.error(`[FAIL] ❌ Unexpected routing behavior. Model used: ${result.active_model}`);
            process.exit(1);
        }
    } catch (err) {
        console.error(`[FAIL] ❌ System crashed instead of failing over:`, err.message);
        process.exit(1);
    }
}

runRoutingTest();
