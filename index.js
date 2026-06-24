import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
let ready = false;

function fixDbUrl(u){var p=u.split('?');if(p.length<2)return u;var s=p[1].split('&'),f=[];for(var i=0;i<s.length;i++)if(s[i].indexOf('channel_binding=')!==0)f.push(s[i]);return p[0]+'?'+f.join('&');}

let pool = null;
function getPool(){if(!pool)pool=new pg.Pool({connectionString:fixDbUrl(process.env.DATABASE_URL),ssl:{rejectUnauthorized:false},max:20,idleTimeoutMillis:30000,connectionTimeoutMillis:10000});return pool;}

// === HEALTH - responds immediately ===
app.get('/health', (req, res) => res.json({status:'ok', ready:ready, port:PORT, time:new Date().toISOString()}));
app.get('/ping', (req, res) => res.json({pong:true, ready:ready}));

// === API ROUTES ===
app.get('/api/intelligence/geopolitical/:slug', async (req, res) => {
  try{var r=await getPool().query("SELECT g.*, m.slug FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1",[req.params.slug]);res.json(r.rows[0]||{error:'not found'});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/cost-calculate', async (req, res) => {
  try{
    var slug=req.query.model||'gpt-4o';var inT=(parseInt(req.query.input)||1000)/1000000;var outT=(parseInt(req.query.output)||500)/1000000;
    var r=await getPool().query("SELECT tier_name, price FROM model_pricing_tiers t JOIN models m ON t.model_id=m.id WHERE m.slug=$1 AND t.active=true ORDER BY tier_name",[slug]);
    var inP=r.rows.find(x=>x.tier_name==='input')||{price:'0'};
    var outP=r.rows.find(x=>x.tier_name==='output')||{price:'0'};
    res.json({model:slug,input_tokens:inT*1000000,output_tokens:outT*1000000,cost_per_request:(inT*parseFloat(inP.price)+outT*parseFloat(outP.price)).toFixed(10),currency:'USD'});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/benchmarks', async (req, res) => {
  try{var r=await getPool().query("SELECT b.slug, b.name, b.category, mb.score, mb.percentile, m.slug as model_slug FROM benchmark_definitions b LEFT JOIN model_benchmarks mb ON b.id=mb.benchmark_definition_id LEFT JOIN models m ON mb.model_id=m.id ORDER BY b.category LIMIT 50");res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/compare', async (req, res) => {
  try{var slugs=(req.query.models||'gpt-4o').split(',');var r=await getPool().query("SELECT m.slug, m.name, COALESCE(AVG(mb.score),0) as avg_score FROM models m LEFT JOIN model_benchmarks mb ON m.id=mb.model_id WHERE m.slug=ANY($1) GROUP BY m.slug, m.name",[slugs]);res.json({models:r.rows,compared:slugs});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/safety/:slug', async (req, res) => {
  try{var r=await getPool().query("SELECT g.*, m.slug FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1",[req.params.slug]);var d=r.rows[0]||{};res.json({model:req.params.slug,trust_score:Math.max(0,100-(d.risk_score||0)),risk_score:d.risk_score||0,country:d.country_of_origin});}catch(e){res.status(500).json({error:e.message});}
});

// === START SERVER IMMEDIATELY ===
app.listen(PORT, () => {
  console.log('✅ TRUNKIA on :' + PORT);
  ready = true;
  
  // === BACKGROUND INIT (non-blocking) ===
  setTimeout(async () => {
    try {
      console.log('[DB] connecting...');
      var test = await getPool().query('SELECT 1 as ok');
      console.log('[OK] db_pool');
      
      // Load agents with error handling
      try { 
        var m = await import('./agents/registry.js'); 
        await m.loadAllAgents(); 
        console.log('[OK] agents'); 
      } catch(e) { 
        console.log('[SKIP] agents:', e.message); 
      }
      
      try { 
        var m2 = await import('./agents/governance/agent-supervisor.js'); 
        await m2.agentSupervisor.initialize(); 
        console.log('[OK] supervisor'); 
      } catch(e) { 
        console.log('[SKIP] supervisor:', e.message); 
      }
      
      try { 
        var m3 = await import('./utils/graceful-shutdown.js'); 
        m3.setupGracefulShutdown(getPool()); 
        console.log('[OK] shutdown'); 
      } catch(e) { 
        console.log('[SKIP] shutdown:', e.message); 
      }
      
      console.log('Init done');
    } catch(e) {
      console.error('[INIT ERROR]:', e.message);
      // Don't crash - keep running with basic features
    }
  }, 1000); // Start after 1 second
});
