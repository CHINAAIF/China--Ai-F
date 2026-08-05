import { validateAndEnforceSchema } from './lib/sovereign-schema-guard.js';

console.log("=================================================");
console.log("🧬 TRUNKIA STRICT SCHEMA POISONING DEFENSE TEST");
console.log("=================================================\n");

let passed = 0;
let total = 0;

function assertResult(testName, condition, detail = "") {
    total++;
    if (condition) {
        passed++;
        console.log(`[PASS] ✅ Test #${total}: ${testName}`);
        if (detail) console.log(`       ℹ️ Detail: ${detail}`);
    } else {
        console.error(`[FAIL] ❌ Test #${total}: ${testName}`);
        if (detail) console.error(`       🚨 Failure Detail: ${detail}`);
        process.exit(1);
    }
}

// العقد المعتمد لإجابات النموذج
const TARGET_SCHEMA = {
    status: { type: "string", required: true, allowedValues: ["SUCCESS", "FAILED", "PENDING"] },
    routing_node: { type: "string", required: true },
    confidence_score: { type: "number", required: true }
};

// -------------------------------------------------------------
// TEST 1: Valid Schema Response
// -------------------------------------------------------------
console.log("--- 🛡️ PHASE 1: VALID SCHEMA ENFORCEMENT ---");
const validResponse = {
    status: "SUCCESS",
    routing_node: "groq-llama-3.3-70b",
    confidence_score: 0.98
};

try {
    const clean = validateAndEnforceSchema(validResponse, TARGET_SCHEMA);
    assertResult("Valid JSON Structure Accepted", clean.status === "SUCCESS", "Strict contract matched perfectly.");
} catch (err) {
    assertResult("Valid JSON Structure Accepted", false, err.message);
}

// -------------------------------------------------------------
// TEST 2: Schema Injection (Unrecognized Poisoned Key)
// -------------------------------------------------------------
console.log("\n--- 🛡️ PHASE 2: EXTRA FIELD INJECTION BLOCK ---");
const poisonedResponse = {
    status: "SUCCESS",
    routing_node: "groq-llama-3.3-70b",
    confidence_score: 0.98,
    override_admin: true // حقل طفيلي مسموم يحاول النموذج إقحامه
};

try {
    validateAndEnforceSchema(poisonedResponse, TARGET_SCHEMA);
    assertResult("Injected Schema Key Rejection", false, "Poisoned key bypassed schema filter!");
} catch (err) {
    assertResult(
        "Injected Schema Key Rejection",
        err.message.includes("Unauthorized extra keys injected"),
        `Blocked attempt to inject key: 'override_admin'.`
    );
}

// -------------------------------------------------------------
// TEST 3: Type Mismatch Attack (Type Poisoning)
// -------------------------------------------------------------
console.log("\n--- 🛡️ PHASE 3: DATA TYPE POISONING ATTACK ---");
const typePoisoned = {
    status: "SUCCESS",
    routing_node: "groq-llama-3.3-70b",
    confidence_score: "0.98; DROP TABLE users;" // محاولة حقن نص في حقل رقمي
};

try {
    validateAndEnforceSchema(typePoisoned, TARGET_SCHEMA);
    assertResult("Data Type Poisoning Rejection", false, "String injected into numeric field!");
} catch (err) {
    assertResult(
        "Data Type Poisoning Rejection",
        err.message.includes("Invalid type for 'confidence_score'"),
        "Blocked type distortion attack on schema boundary."
    );
}

console.log("\n=================================================");
console.log(`🏆 SCHEMA POISONING TEST COMPLETE: ${passed}/${total} PASSED`);
console.log("=================================================");
