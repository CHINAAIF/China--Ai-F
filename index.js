import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

function fixDbUrl(u){var p=u.split('?');if(p.length<2)return u;var s=p[1].split('&'),f=[];for(var i=0;i<s.length;i++)if(s[i].indexOf('channel_binding=')!==0)f.push(s[i]);return p[0]+'?'+f.join('&');}

function getPool(){return new pg.Pool({connectionString:fixDbUrl(process.env.DATABASE_URL),ssl:{rejectUnauthorized:false}});}

app.get('/health', (req, res) => res.json({status:'ok', ready:true, port:PORT}));

app.get('/ping', (req, res) => res.json({pong:true}));

app.get('/api/intelligence/geopolitical/:slug', async (req, res) => {
  var pool=getPool();
  try{
    var r=await pool.query("SELECT g.*, m.slug FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1",[req.params.slug]);
    await pool.end();
    res.json(r.rows[0]||{error:'not found'});
  }catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/cost-calculate', async (req, res) => {
  var pool=getPool();
  try{
    var r=await pool.query("SELECT m.slug, p.input_price, p.output_price FROM models m JOIN model_pricing_tiers p ON m.id=p.model_id WHERE m.slug=$1 AND p.active=true LIMIT 1",[req.query.model||'gpt-4o']);
    await pool.end();
    var d=r.rows[0]||{};
    var inT=(parseInt(req.query.input)||1000)/1000000;
    var outT=(parseInt(req.query.output)||500)/1000000;
    var cost=((inT*(d.input_price||0))+(outT*(d.output_price||0))).toFixed(6);
    res.json({model:req.query.model,input_tokens:req.query.input,output_tokens:req.query.output,cost_per_request:cost,currency:'USD'});
  }catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.listen(PORT, () => console.log('✅ TRUNKIA on :'+PORT));
