import dotenv from 'dotenv'; import pg from 'pg'; dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized: true}});
class ReputationAgent{
  constructor(){this.name='reputation_updater';this.version='1.0.0';}
  async updateReputation(){
    const sources=(await pool.query("SELECT id,reputation_score,accurate_citations,total_citations FROM sources")).rows;
    let updated=0;
    for(const s of sources){
      const newScore=s.total_citations>0?Math.min(100,Math.round((s.accurate_citations/s.total_citations)*100)):s.reputation_score;
      if(Math.abs(newScore-s.reputation_score)>=5){
        await pool.query("UPDATE sources SET reputation_score=$1,updated_at=NOW() WHERE id=$2",[newScore,s.id]);
        updated++;
      }
    }
    return{sources_checked:sources.length,updated,new_avg:(await pool.query("SELECT AVG(reputation_score)::numeric(5,2) as avg FROM sources")).rows[0].avg};
  }
}
const ra=new ReputationAgent();
ra.updateReputation().then(r=>{
  console.log('=== REPUTATION UPDATER ===');
  console.log('Sources checked:',r.sources_checked,'| Updated:',r.updated);
  console.log('New avg reputation:',r.new_avg);
  console.log('REPUTATION OPERATIONAL!');
  process.exit(0);
});
export default ra;
