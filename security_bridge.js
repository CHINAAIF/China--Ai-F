import SovereignOutputScanner from './core/security/scanner.js';

const scanner = new SovereignOutputScanner();

// عملية الربط التلقائي في الـ Pipeline
export const secureOutput = async (text, context) => {
    const result = await scanner.scan(text, context);
    if (!result.clean) {
        console.warn(`[SECURITY] Violation detected: ${result.violations.map(v => v.type).join(', ')}`);
    }
    return result.output;
};

console.log('[SECURITY] Sovereign Scanner Bridge Active.');
