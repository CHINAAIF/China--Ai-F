import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
function fixDbUrl(u){var p=u.split('?');if(p.length<2)return u;var s=p[1].split('&'),f=[];for(var i=0;i<s.length;i++)if(s[i].indexOf('channel_binding=')!==0)f.push(s[i]);return p[0]+'?'+f.join('&');}
let pool=null;
export function getPool(){if(!pool)pool=new pg.Pool({connectionString:fixDbUrl(process.env.DATABASE_URL),ssl:{rejectUnauthorized:false},max:20});return pool;}
export function query(t,p){return getPool().query(t,p);}
export function getClient(){return getPool().connect();}
export async function shutdownPool(){if(pool){await pool.end();pool=null;}}
