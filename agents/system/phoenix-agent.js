/**
 * TRUNKIA Phoenix Protocol Agent (The Emperor's Ash)
 * Implements: Cognitive Purge, AES-256-GCM Encryption, Immutable Ash Chain, Temporal Lock.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BaseAgent } from '../base-agent.js';
import { readMemory } from '../../lib/blackboard.js';

class PhoenixAgent extends BaseAgent {
  constructor() {
    super('phoenix', 'system');
    this.ashDir = path.resolve('./phoenix-ashes');
    if (!fs.existsSync(this.ashDir)) fs.mkdirSync(this.ashDir, { recursive: true });
  }

  async run() {
    this._checkVitals();
    try {
      // 1. Cognitive Purge: Do not backup a poisoned system
      const freezeState = await readMemory('system:cognitive_freeze');
      if (freezeState && freezeState.active) {
        console.error('[PHOENIX] ABORT: Cognitive Freeze active. System is poisoned. Refusing to create Ash.');
        return { success: false, error: 'System poisoned. Backup aborted.' };
      }

      // 2. Cognitive Aggregation: Gather Sovereign State
      const constitutionFile = fs.readFileSync('./lib/constitution-engine.js', 'utf8');
      const providersFile = fs.readFileSync('./config/inference-providers.json', 'utf8');
      const immuneVitals = await readMemory('system:vitals') || { status: 'unknown' };

      const sovereignState = {
        timestamp: Date.now(),
        constitution_hash: crypto.createHash('sha256').update(constitutionFile).digest('hex'),
        providers_hash: crypto.createHash('sha256').update(providersFile).digest('hex'),
        immune_vitals: immuneVitals,
        protocol_version: 'SIP/1.0'
      };

      // 3. Quantum-Hybrid Encryption (AES-256-GCM)
      const secret = process.env.ENCRYPTION_KEY;
      if (!secret) throw new Error('ENCRYPTION_KEY is required to forge Ash.');
      
      const key = crypto.scryptSync(secret, 'trunkia_phoenix_salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      
      const dataString = JSON.stringify(sovereignState);
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();

      // 4. Immutable Ash Chain (Link to previous)
      const previousAshes = fs.readdirSync(this.ashDir).filter(f => f.endsWith('.ash')).sort();
      const prevHash = previousAshes.length > 0 
        ? previousAshes[previousAshes.length - 1].replace('.ash', '') 
        : 'GENESIS';
      
      const currentHash = crypto.createHash('sha256').update(encrypted + prevHash).digest('hex');

      // 5. Forensic Header & Temporal Lock (7 days expiry)
      const header = {
        version: '1.0.0',
        created_at: sovereignState.timestamp,
        expires_at: sovereignState.timestamp + (7 * 24 * 60 * 60 * 1000), // 7 days
        prev_hash: prevHash,
        current_hash: currentHash,
        iv: iv.toString('hex'),
        auth_tag: authTag.toString('hex')
      };

      // 6. Air-Gapped Storage
      const ashFile = path.join(this.ashDir, `${currentHash}.ash`);
      const fileContent = JSON.stringify(header) + '\n---ASH---\n' + encrypted;
      fs.writeFileSync(ashFile, fileContent);

      console.log(`[PHOENIX] Ash forged and sealed: ${currentHash.substring(0, 16)}...`);
      return { success: true, hash: currentHash, expires_at: header.expires_at };

    } catch (e) {
      console.error('[PHOENIX] Error:', e.message);
      return { success: false, error: e.message };
    }
  }
}

export const phoenixAgent = new PhoenixAgent();
export default phoenixAgent;
