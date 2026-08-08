// ============================================================================
// TRUNKIA (VIGILANT-H) - STRICT SCHEMA GUARD & CONTRACT ENFORCER
// ============================================================================

/**
 * يفحص كائن JSON ضد المخطط المصرح به ويقوم بتطهير الحقول غير المعروفة (Unrecognized Keys)
 * والتحقق من أنوع البيانات الحتمية.
 */
export function validateAndEnforceSchema(data, expectedSchema) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error("SCHEMA_VIOLATION: Data payload must be a non-null JSON object.");
    }

    const sanitizedData = {};

    // 1. فحص الحقول المصرح بها فقط (Disallow Unknown Keys & Injection Fields)
    for (const [key, rules] of Object.entries(expectedSchema)) {
        if (rules.required && !(key in data)) {
            throw new Error(`SCHEMA_VIOLATION: Missing required field '${key}'.`);
        }

        if (key in data) {
            const val = data[key];
            const actualType = typeof val;

            // التحقق من نوع البيانات المطابق
            if (rules.type && actualType !== rules.type) {
                throw new Error(`SCHEMA_VIOLATION: Invalid type for '${key}'. Expected ${rules.type}, got ${actualType}.`);
            }

            // التحقق من القيم المسموح بها حتمياً (Enum verification)
            if (rules.allowedValues && !rules.allowedValues.includes(val)) {
                throw new Error(`SCHEMA_VIOLATION: Value '${val}' for '${key}' is not in allowed list.`);
            }

            sanitizedData[key] = val;
        }
    }

    // 2. كشف الحقول المحقونة (Injected Fields Detection)
    const extraKeys = Object.keys(data).filter(k => !(k in expectedSchema));
    if (extraKeys.length > 0) {
        throw new Error(`SCHEMA_VIOLATION: Unauthorized extra keys injected: [${extraKeys.join(', ')}]`);
    }

    return Object.freeze(sanitizedData);
}
