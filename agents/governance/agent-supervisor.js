import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { tableExists } from '../utils/executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const MASTER_KEY = process.env.ENCRYPTION_KEY || 'trunkia-key';
const HEARTBEAT_TIMEOUT_MS = 5 * 60000;

async function writeEvent(type, agentId, payload) {
  try {
    const exists = await tableExists('event_log');
    if (!exists) return;
    const h = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const s = crypto.createHmac('sha256', MASTER_KEY).update(h).digest('hex');
    await pool.query(`INSERT INTO event_log (event_type,agent_id,payload,payload_hash,signature,created_at) VALUES ($1,$2,$3,$4,$5,NOW())`, [type, agentId, payload, h, s]);
  } catch(_) {}
}

class AgentSupervisor {
  constructor() { this.name='agent_supervisor'; this.layer='governance'; this.status='active'; }

  async initialize() {
    try {
      const exists = await tableExists('agent_supervision');
      if (!exists) {
        await pool.query(`
          CREATE TABLE agent_supervision (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_name   VARCHAR(200) NOT NULL UNIQUE,
            layer        VARCHAR(100),
            supervisor   VARCHAR(200),
            last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
            status       VARCHAR(50) DEFAULT 'active',
            failure_count SMALLINT DEFAULT 0,
            last_failure  TIMESTAMPTZ,
            auto_restart  BOOLEAN DEFAULT true,
            created_at   TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await pool.query(`CREATE INDEX idx_as_status ON agent_supervision(status,last_heartbeat)`);
        console.log('✅ agent_supervision created');
        await this.seedAgents();
      }
      return true;
    } catch(e) { this.status='db_error'; return false; }
  }

  async seedAgents() {
    const agents = [
      ['sovereign-mind','sovereign','agent_supervisor'],
      ['tactical_routing_agent','governance','agent_supervisor'],
      ['audit_gateway_v2','governance','agent_supervisor'],
      ['key_sentinel','governance','agent_supervisor'],
      ['threat_monitor_agent','security','agent_supervisor'],
      ['fraud_detection_agent','security','agent_supervisor'],
      ['platform_health_agent','service','agent_supervisor'],
      ['db_guardian_agent','service','agent_supervisor'],
      ['brain-acquisition-agent','intelligence','agent_supervisor'],
      ['epistemic-firewall-agent','learning','agent_supervisor'],
      ['knowledge_distillation_agent','learning','agent_supervisor'],
      ['china-news-agent','intelligence','agent_supervisor'],
      ['pricing-tracker-agent','intelligence','agent_supervisor'],
    ];
    for (const [name, layer, supervisor] of agents) {
      await pool.query(`
        INSERT INTO agent_supervision (agent_name,layer,supervisor)
        VALUES ($1,$2,$3) ON CONFLICT (agent_name) DO NOTHING
      `, [name, layer, supervisor]).catch(()=>{});
    }
    console.log('✅ agents seeded in supervision');
  }

  async heartbeat(agentName) {
    try {
      await pool.query(`
        UPDATE agent_supervision
        SET last_heartbeat=NOW(), status='active'
        WHERE agent_name=$1
      `, [agentName]);
    } catch(_) {}
  }

  async detectDead() {
    try {
      const {rows} = await pool.query(`
        SELECT agent_name, layer, last_heartbeat, failure_count
        FROM agent_supervision
        WHERE last_heartbeat < NOW() - ($1 || ' milliseconds')::INTERVAL
          AND status != 'dead'
      `, [HEARTBEAT_TIMEOUT_MS]);

      for (const r of rows) {
        await pool.query(`
          UPDATE agent_supervision
          SET status='dead', failure_count=failure_count+1, last_failure=NOW()
          WHERE agent_name=$1
        `, [r.agent_name]);

        await writeEvent('agent_dead', this.name, {
          agent: r.agent_name, layer: r.layer,
          last_seen: r.last_heartbeat, failures: r.failure_count + 1
        });

        await pool.query(`
          INSERT INTO diagnostic_repairs
            (component,issue_type,description,auto_repaired,created_at)
          VALUES ($1,'agent_dead',$2,false,NOW())
        `, [r.agent_name, `Dead detected — failures:${r.failure_count+1}`]).catch(()=>{});

        console.error(`🚨 DEAD: ${r.agent_name} [${r.layer}]`);
      }
      return rows;
    } catch(e) { return []; }
  }

  async getHealth() {
    try {
      const {rows} = await pool.query(`
        SELECT status, COUNT(*) as count
        FROM agent_supervision
        GROUP BY status
      `);
      return rows;
    } catch(_) { return []; }
  }

  async run(input={}) {
    try {
      await this.initialize();
      const dead = await this.detectDead();
      await this.heartbeat(this.name);

      await pool.query(`
        INSERT INTO agent_execution_logs
          (agent_name,action,input,output,confidence,status)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [this.name,'supervision_cycle','{}',
          JSON.stringify({dead_detected:dead.length}),
          90,'completed']).catch(()=>{});

      return {success:true, data:{dead_detected:dead.length, agents:dead.map(r=>r.agent_name)}};
    } catch(e) { return {success:false,error:e.message}; }
  }

  async runDiagnostic() {
    const r = await this.run({});
    const h = await this.getHealth();
    return {agent:this.name, status:r.success?'ok':'error', health:h, ...r};
  }
}

export const agentSupervisor = new AgentSupervisor();
export default agentSupervisor;
