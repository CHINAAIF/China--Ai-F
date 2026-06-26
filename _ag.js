import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
var url = process.env.DATABASE_URL.split('?')[0] + '?' + process.env.DATABASE_URL.split('?').slice(1).join('?').split('&').filter(function(p){return p.indexOf('channel_binding=')!==0;}).join('&');
var pool = new pg.Pool({connectionString:url,ssl:{rejectUnauthorized:false}});
var r = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",['public','agent_registry']);
if(r.rows.length===0){console.log('TABLE EMPTY OR MISSING');}else{
  console.log('--- agent_registry (' + r.rows.length + ' cols) ---');
  for(var i=0;i<r.rows.length;i++){console.log('  '+r.rows[i].column_name+' | '+r.rows[i].data_type);}
}
var c = await pool.query("SELECT count(*) as cnt FROM agent_registry");
console.log('rows: '+c.rows[0].cnt);
await pool.end();
