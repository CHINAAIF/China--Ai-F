import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { tableExists } from '../utils/executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
const MASTER_KEY = process.env.ENCRYPTION_KEY || 'trunkia-key';

function encryptKey(raw) {
  const iv = crypto.randomBytes(16);
  const k  = crypto.createHash('sha256').update(MASTER_KEY).digest();
  const c  = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(raw,'utf8'), c.final()]);
  return `${iv.toString('hex')}.${enc.toString('hex')}.${c.getAuthTag().toString('hex')}`;
}

function decryptKey(enc) {
  const [iv,e,tag] = enc.split('.').map(x=>Buffer.from(x,'hex'));
  const k = crypto.createHash('sha256').update(MASTER_KEY).digest();
  const d = crypto.createDecipheriv('aes-256-gcm',k,iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(e),d.final()]).toString('utf8');
}

class KeySentinel {
  constructor() { this.name='key_sentinel'; this.layer='governance'; this.status='active'; }

  async initialize() {
    try {
      const exists = await tableExists('byok_keys');
      if (!exists) {
        await pool.query(`CREATE TABLE byok_keys (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL, provider VARCHAR(100) NOT NULL, key_hash VARCHAR(128) NOT NULL, key_encrypted TEXT NOT NULL, valid_until TIMESTAMPTZ, revoked BOOLEAN DEFAULT false, last_accessed TIMESTAMPTZ, access_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await pool.query(`CREATE INDEX idx_byok_customer ON byok_keys(customer_id,provider)`);
        console.log('✅ byok_keys created');
      }
      return true;
    } catch(e) { this.status='db_error'; return false; }
  }

  async verifyKey(customerId, provider) {
    try {
      const {rows} = await pool.query(`SELECT id,access_count FROM byok_keys WHERE customer_id=$1 AND provider=$2 AND revoked=false AND (valid_until IS NULL OR valid_until>NOW()) LIMIT 1`,[customerId,provider]);
      if (!rows[0]) return {valid:false,reason:'no_active_key'};
      await pool.query(`UPDATE byok_keys SET last_accessed=NOW(),access_count=access_count+1 WHERE id=$1`,[rows[0].id]).catch(()=>{});
      return {valid:true,key_id:rows[0].id};
    } catch(e) { return {valid:false,reason:e.message}; }
  }

  async useKey(customerId, provider) {
    try {
      const v = await this.verifyKey(customerId,provider);
      if (!v.valid) return {success:false,error:v.reason};
      const {rows} = await pool.query(`SELECT key_encrypted FROM byok_keys WHERE id=$1`,[v.key_id]);
      return {success:true,key:decryptKey(rows[0].key_encrypted)};
    } catch(e) { return {success:false,error:e.message}; }
  }

  async run(input={}) {
    try {
      await this.initialize();
      const {rows} = await pool.query(`UPDATE byok_keys SET revoked=true WHERE valid_until<NOW() AND revoked=false RETURNING id`);
      await pool.query(`INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status) VALUES ($1,$2,$3,$4,$5,$6)`,[this.name,'key_audit','{}',JSON.stringify({expired:rows.length}),90,'completed']).catch(()=>{});
      return {success:true,data:{expired:rows.length}};
    } catch(e) { return {success:false,error:e.message}; }
  }

  async runDiagnostic() { const r=await this.run({}); return {agent:this.name,status:r.success?'ok':'error',...r}; }
}

export const keySentinel = new KeySentinel();
export default keySentinel;
