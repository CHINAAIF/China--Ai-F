import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

function fixDbUrl(u){var p=u.split('?');if(p.length<2)return u;var s=p[1].split('&'),f=[];for(var i=0;i<s.length;i++)if(s[i].indexOf('channel_binding=')!==0)f.push(s[i]);return p[0]+'?'+f.join('&');}

function getPool(){return new pg.Pool({connectionString:fixDbUrl(process.env.DATABASE_URL),ssl:{rejectUnauthorized:false}});}

function cleanNum(v){return parseInt(String(v).replace(/[^0-9]/g,''))||0;}

app.get('/health', (req, res) => res.json({status:'ok', ready:true, port:PORT}));
app.get('/ping', (req, res) => res.json({pong:true}));

app.get('/api/intelligence/geopolitical/:slug', async (req, res) => {
  var pool=getPool();
  try{var r=await pool.query("SELECT g.*, m.slug FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1",[req.params.slug]);await pool.end();res.json(r.rows[0]||{error:'not found'});}catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/cost-calculate', async (req, res) => {
  var pool=getPool();
  try{
    var slug=req.query.model||'gpt-4o';var inT=(cleanNum(req.query.input)||1000)/1000000;var outT=(cleanNum(req.query.output)||500)/1000000;
    var r=await pool.query("SELECT tier_name, price FROM model_pricing_tiers t JOIN models m ON t.model_id=m.id WHERE m.slug=$1 AND t.active=true ORDER BY t.tier_name",[slug]);await pool.end();
    var inP=r.rows.find(x=>x.tier_name==='input')||{price:'0'};
    var outP=r.rows.find(x=>x.tier_name==='output')||{price:'0'};
    var inR=parseFloat(inP.price)||0;
    var outR=parseFloat(outP.price)||0;
    var cost=(inT*inR+outT*outR).toFixed(10);
    res.json({model:slug,input_tokens:inT*1000000,output_tokens:outT*1000000,cost_per_request:cost,currency:'USD',per_1m_input:inR,per_1m_output:outR});
  }catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/benchmarks', async (req, res) => {
  var pool=getPool();
  try{var r=await pool.query("SELECT b.slug, b.name, b.category, mb.score, mb.percentile, m.slug as model_slug FROM benchmark_definitions b LEFT JOIN model_benchmarks mb ON b.id=mb.benchmark_definition_id LEFT JOIN models m ON mb.model_id=m.id ORDER BY b.category, b.slug LIMIT 50");await pool.end();res.json(r.rows);}catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/compare', async (req, res) => {
  var pool=getPool();
  try{
    var slugs=(req.query.models||'gpt-4o').split(',');
    var r=await pool.query("SELECT m.slug, m.name, COALESCE(AVG(mb.score),0) as avg_score, COUNT(DISTINCT bd.slug) as benchmarks_count FROM models m LEFT JOIN model_benchmarks mb ON m.id=mb.model_id LEFT JOIN benchmark_definitions bd ON mb.benchmark_definition_id=bd.id WHERE m.slug=ANY($1) GROUP BY m.slug, m.name",[slugs]);await pool.end();res.json({models:r.rows,compared:slugs});
  }catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/safety/:slug', async (req, res) => {
  var pool=getPool();
  try{
    var r=await pool.query("SELECT g.*, m.slug FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1",[req.params.slug]);await pool.end();
    var d=r.rows[0]||{};res.json({model:req.params.slug,trust_score:Math.max(0,100-(d.risk_score||0)),risk_score:d.risk_score||0,data_law_risk:d.data_law_risk||0,sanctions_risk:d.sanctions_risk||0,blocking_risk:d.blocking_risk||0,censorship_risk:d.censorship_risk||0,country:d.country_of_origin,assessed_at:d.assessed_at});
  }catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.listen(PORT, () => console.log('✅ TRUNKIA on :'+PORT));
