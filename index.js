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
    var slug=req.query.model||'gpt-4o';
    var inT=(parseInt(req.query.input)||1000)/1000000;
    var outT=(parseInt(req.query.output)||500)/1000000;
    var r=await pool.query("SELECT tier_name, price FROM model_pricing_tiers t JOIN models m ON t.model_id=m.id WHERE m.slug=$1 AND t.active=true",[slug]);
    await pool.end();
    var inP=r.rows.find(x=>x.tier_name.includes('input'))||{price:0};
    var outP=r.rows.find(x=>x.tier_name.includes('output'))||{price:0};
    var cost=(inT*inP.price+outT*outP.price).toFixed(6);
    res.json({model:slug,input_tokens:req.query.input,output_tokens:req.query.output,cost_per_request:cost,currency:'USD',input_rate:inP.price,output_rate:outP.price});
  }catch(e){await pool.end();res.status(500).json({error:e.message});}
});

app.listen(PORT, () => console.log('✅ TRUNKIA on :'+PORT));
