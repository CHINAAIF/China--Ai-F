
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = (msg) => console.log('['+new Date().toISOString()+'] '+msg);

const isValid = (row) => {
  if(!row.raw_content || row.raw_content.trim()==='analysis') {
    if(!row.content || row.content.trim().length < 20) return {valid:false};
  }
  const actual = row.content || row.raw_content || '';
  if(actual.trim().length < 20) return {valid:false};
  return {valid:true};
};

const getImpact = (row) => {
  const c = row.confidence || 50;
  if(c >= 80) return 'high';
  if(c >= 60) return 'medium';
  return 'low';
};

const pending = await pool.query("SELECT id,agent_name,content_type,confidence,title,raw_content,content,collected_at FROM intelligence_raw WHERE filter_status='pending' ORDER BY collected_at DESC");
log('pending: '+pending.rows.length);

let promoted=0,rejected=0,err=0;
const now = new Date().toISOString();

for(const row of pending.rows){
  try{
    const check = isValid(row);
    if(!check.valid){
      await pool.query("UPDATE intelligence_raw SET filter_status='rejected' WHERE id=$1",[row.id]);
      rejected++;
      continue;
    }
    const actual = row.content || row.raw_content;
    const vc = {title:row.title||'Untitled',content:actual,agent:row.agent_name,content_type:row.content_type,confidence:row.confidence||50,collected_at:row.collected_at};
    const exists = await pool.query('SELECT id FROM intelligence_verified WHERE raw_id=$1',[row.id]);
    if(exists.rows.length>0){
      await pool.query("UPDATE intelligence_raw SET filter_status='passed' WHERE id=$1",[row.id]);
      promoted++;
      continue;
    }
    await pool.query('INSERT INTO intelligence_verified(raw_id,verified_content,verification_count,impact_level,published,created_at) VALUES($1,$2,$3,$4,$5,$6)',[row.id,vc,1,getImpact(row),false,now]);
    await pool.query("UPDATE intelligence_raw SET filter_status='passed',is_verified=true WHERE id=$1",[row.id]);
    promoted++;
  }catch(e){log('ERROR '+row.id+': '+e.message);err++;}
}

const rawStats = await pool.query("SELECT filter_status,COUNT(*) as c FROM intelligence_raw GROUP BY filter_status");
const verCount = await pool.query('SELECT COUNT(*) FROM intelligence_verified');
const sample = await pool.query("SELECT iv.impact_level,iv.verified_content->>'title' as title,iv.verified_content->>'agent' as agent FROM intelligence_verified iv ORDER BY iv.created_at DESC LIMIT 8");
log('promoted:'+promoted+' rejected:'+rejected+' err:'+err);
log('intelligence_verified total: '+verCount.rows[0].count);
log('raw by status:');
rawStats.rows.forEach(x=>log('  '+x.filter_status+': '+x.c));
log('sample:');
sample.rows.forEach(x=>log('  ['+x.impact_level+'] '+x.agent+' | '+x.title));
await pool.end();
