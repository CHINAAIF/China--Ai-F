import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Enterprise-grade Environment Loader (ESM Compatible)
 * Enforces strict environment separation and Fail-Fast for missing secrets.
 * Auto-executes on import to guarantee env vars are set before dependent modules load.
 */
export function loadEnvironment() {
    const NODE_ENV = process.env.NODE_ENV;
    
    // Determine the environment file to load
    const envFile = NODE_ENV === 'production' ? '.env.production' : '.env.staging';
    const envPath = path.resolve(process.cwd(), envFile);

    // Fail-Fast: If the specific env file doesn't exist, halt the system.
    if (!fs.existsSync(envPath)) {
        console.error(`[FATAL] Environment file '${envFile}' not found. Refusing to start in an unmanaged state.`);
        console.error(`[FATAL] Current NODE_ENV is set to: '${NODE_ENV}'. Ensure the file exists.`);
        process.exit(1);
    }

    // Load the specific environment file
    dotenv.config({ path: envPath });

    // Mandatory secrets for the system to function securely
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
        console.error(`[FATAL] Missing mandatory environment secrets in '${envFile}':`);
        missingSecrets.forEach(key => console.error(`  -> ${key}`));
        console.error(`[FATAL] System cannot start without these secrets. No default secrets will be used.`);
        process.exit(1);
    }

    console.log(`[INFO] Environment '${NODE_ENV}' loaded successfully from ${envFile}. All critical secrets verified.`);
}

// Auto-execute immediately upon import (Side-effect)
loadEnvironment();
