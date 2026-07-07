import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

/**
 * Enterprise-grade Environment Loader (CI/CD & Railway Compatible)
 * - Reads .env files if they exist (Local Termux).
 * - Relies on injected env vars if files are missing (GitHub Actions, Railway).
 * - Enforces strict Fail-Fast for missing secrets.
 */
export function loadEnvironment() {
    const NODE_ENV = process.env.NODE_ENV || 'development';

    const envFile = NODE_ENV === 'production' ? '.env.production' : '.env.staging';
    const envPath = path.resolve(process.cwd(), envFile);

    // Load the specific environment file if it exists (for local dev).
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        console.log(`[INFO] Environment file '${envFile}' loaded.`);
    } else {
        console.log(`[INFO] Environment file '${envFile}' not found. Relying on injected environment variables (CI/CD or Railway).`);
    }

    // Mandatory secrets validation
    const requiredSecrets = [
        'DATABASE_URL',
        'DATABASE_URL_LEARNING',
        'DATABASE_URL_INTELLIGENCE',
        'DATABASE_URL_GOVERNANCE',
        'DATABASE_URL_SECURITY',
        'ENCRYPTION_KEY',
        'GOVERNANCE_HMAC_SECRET',
        'GROQ_API_KEY',
        'TRUNKIA_API_KEY'
    ];

    const missingSecrets = requiredSecrets.filter(key => !process.env[key]);

    // Fail-Fast: No default secrets allowed. If a secret is missing, crash immediately.
    if (missingSecrets.length > 0) {
        console.error(`[FATAL] Missing mandatory environment secrets:`);
        missingSecrets.forEach(key => console.error(`  -> ${key}`));
        console.error(`[FATAL] System cannot start without these secrets.`);                                                                                  
        process.exit(1);
    }                                                                                                                                                  
    
    // Optional variables (Observability & Alerting)
    // These do not crash the system if missing, but print a warning.
    const optionalVars = ['SENTRY_DSN', 'ALERT_WEBHOOK_URL'];
    optionalVars.forEach(varName => {
        if (!process.env[varName]) {
            console.warn(`[WARN] Optional variable ${varName} is not set. Monitoring features may be degraded.`);
        }
    });

    console.log(`[INFO] Environment '${NODE_ENV}' verified. All critical secrets are present.`);                                                       }
                                                                                                                                                       
// Auto-execute immediately upon import (Side-effect)
loadEnvironment();
