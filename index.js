import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

function fixDbUrl(u){var p=u.split('?');if(p.length<2)return u;var s=p[1].split('&'),f=[];for(var i=0;i<s.length;i++)if(s[i].indexOf('channel_binding=')!==0)f.push(s[i]);return p[0]+'?'+f.join('&');}

app.get('/health', (req, res) => {
  res.json({status:'ok', ready:true, port:PORT});
});

app.get('/ping', (req, res) => {
  res.json({pong:true, time:new Date().toISOString()});
});

app.get('/api/intelligence/geopolitical/:slug', async (req, res) => {
  try {
    const pool = new pg.Pool({
      connectionString: fixDbUrl(process.env.DATABASE_URL),
      ssl: {rejectUnauthorized:false}
    });
    const r = await pool.query("SELECT * FROM model_geopolitical_risk WHERE model_slug=$1", [req.params.slug]);
    await pool.end();
    res.json(r.rows[0] || {error:'not found'});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.get('/api/intelligence/cost-calculate', async (req, res) => {
  try {
    const pool = new pg.Pool({
      connectionString: fixDbUrl(process.env.DATABASE_URL),
      ssl: {rejectUnauthorized:false}
    });
    const r = await pool.query("SELECT m.slug, m.name, p.input_price, p.output_price FROM models m JOIN model_pricing_tiers p ON m.id=p.model_id WHERE m.slug=$1 LIMIT 1", [req.query.model||'gpt-4o']);
    await pool.end();
    var d=r.rows[0]||{};
    var input=(parseInt(req.query.input)||1000)/1000000;
    var output=(parseInt(req.query.output)||500)/1000000;
    var cost=(input*(d.input_price||0)+output*(d.output_price||0)).toFixed(6);
    res.json({model:req.query.model, cost_per_request:cost, currency:'USD'});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.listen(PORT, () => console.log('✅ TRUNKIA on :' + PORT));
