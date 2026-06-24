/**
 * TRUNKIA Geopolitical Risk API v1.0
 * GET /api/risk/:model_slug
 */
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});

class GeoRiskAPI {
  constructor(){this.name='geo_risk_api';this.version='1.0.0';}

  async getRisk(slug){
    const start=Date.now();
    try{
      // Get model + risk data JOIN
      const r=await pool.query(`
        SELECT m.slug,m.name,v.name as vendor_name,
               gr.country_of_origin,gr.risk_score,
               gr.data_law_risk,gr.sanctions_risk,
               gr.blocking_risk,gr.censorship_risk,
               gr.notes,gr.assessed_at
        FROM models m
        JOIN vendors v ON m.vendor_id=v.id
        LEFT JOIN model_geopolitical_risk gr ON gr.model_id=m.id
        WHERE m.slug=$1
      `,[slug]);
      
      if(r.rowCount===0){
        return{error:'Model not found',slug,status:404};
      }
      
      const m=r.rows[0];
      
      // Calculate composite trust score
      const benchAvg=(await pool.query(`
        SELECT AVG(score)::numeric(5,2) as avg FROM model_benchmarks WHERE model_id=(
          SELECT id FROM models WHERE slug=$1
        )
      `,[slug])).rows[0].avg||70;
      
      const trustScore=Math.round(
        (benchScore*0.30)+
        ((10-m.risk_score)*10*0.30)+
        ((10-m.data_law_risk)*10*0.25)+
        ((10-m.blocking_risk)*10*0.15)
      );
      
      // Determine recommendation
      let rec='USABLE',recColor='green',warnings=[];
      if(m.risk_score>=7){rec='CAUTION';recColor='orange';warnings.push('High geopolitical risk');}
      if(m.data_law_risk>=7){rec='CAUTION';recColor='orange';warnings.push('Data law compliance concerns');}
      if(m.blocking_risk>=7){rec='RISKY';recColor='red';warnings.push('May be blocked in some regions');}
      if(m.censorship_risk>=7){warnings.push('Potential censorship applied');}
      
      return{
        status:200,
        slug:m.slug,
        name:m.name,
        vendor:m.vendor_name?.en||m.vendor_name,
        origin:{country:m.country_of_origin,risk_score:m.risk_score},
        risks:{
          data_law:m.data_law_risk,
          sanctions:m.sanctions_risk,
          blocking:m.blocking_risk,
          censorship:m.censorship_risk
        },
        trust_score:trustScore,
        max_score:100,
        recommendation:{level:rec,color:recColor,warnings},
        assessed_at:m.assessed_at,
        response_time_ms:Date.now()-start
      };
    }catch(e){
      return{error:e.message.split(String.fromCharCode(10))[0],status:500};
    }
  }

  async getTopRisks(limit=10){
    const r=await pool.query(`
      SELECT m.slug,m.name,v.name as vn,
             gr.country_of_origin,gr.risk_score,
             gr.blocking_risk,gr.censorship_risk
      FROM model_geopolitical_risk gr
      JOIN models m ON gr.model_id=m.id
      JOIN vendors v ON m.vendor_id=v.id
      ORDER BY gr.risk_score DESC
      LIMIT $1
    `,[limit]);
    return{count:r.rowCount,risky_models:r.rows};
  }

  async getSafest(limit=10){
    const r=await pool.query(`
      SELECT m.slug,m.name,v.name as vn,
             gr.country_of_origin,gr.risk_score
      FROM model_geopolitical_risk gr
      JOIN models m ON gr.model_id=m.id
      JOIN vendors v ON m.vendor_id=v.id
      ORDER BY gr.risk_score ASC
      LIMIT $1
    `,[limit]);
    return{count:r.rowCount,safe_models:r.rows};
  }

  async health(){
    const total=(await pool.query('SELECT COUNT(*)c FROM model_geopolitical_risk')).rows[0].c;
    const models=(await pool.query('SELECT COUNT(*)c FROM models')).rows[0].c;
    return{api:this.name,v:this.version,coverage:total+'/'+models,ratio:Math.round((total/models)*100)+'%'};
  }
}

const api=new GeoRiskAPI();

// Test
console.log('=== GEOPOLITICAL RISK API TEST ===
');

api.getRisk('deepseek-v3').then(res=>{
  console.log('Test1: deepseek-v3');
  console.log('  Status:',res.status);
  if(res.error){console.log('  Error:',res.error);}
  else{
    console.log('  Origin:',res.origin.country,'| Risk:',res.origin.risk_score);
    console.log('  Trust Score:',res.trust_score,'| Rec:',res.recommendation.level,'('+res.recommendation.color+')');
    console.log('  Warnings:',res.recommendation.warnings.length?res.recommendation.warnings:'none');
    console.log('  Time:',res.response_time_ms,'ms');
  }
  
  console.log('
--- Top 5 Riskiest ---');
  return api.getTopRisks(5);
}).then(risky=>{
  for(const m of risky.risky_models){
    console.log(' ',m.slug.padEnd(20),'|',m.country_of_origin.padEnd(15),'| risk:',m.risk_score);
  }
  
  console.log('
--- Top 5 Safest ---');
  return api.getSafest(5);
}).then(safe=>{
  for(const m of safe.safe_models){
    console.log(' ',m.slug.padEnd(20),'|',m.country_of_origin.padEnd(15),'| risk:',m.risk_score);
  }
  
  return api.health();
}).then(h=>{
  console.log('
📊 API Health:',h.api,'| Coverage:',h.coverage,'(',h.ratio,'of models)');
    console.log('
🎉 GEOPOLITICAL RISK API OPERATIONAL!');
    process.exit(0));
});

export default api;
