import dotenv from 'dotenv'; dotenv.config();
import cron from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runScript(scriptPath) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('node', [scriptPath], { env: process.env, stdio: 'pipe' });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', code => {
      const ms = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${path.basename(scriptPath)} exit=${code} ms=${ms}`);
      if (err) console.warn('stderr:', err.slice(0,200));
      resolve({ code, out, err, ms });
    });
    child.on('error', e => { console.error('spawn_error:', e.message); resolve({ code:-1, err:e.message }); });
  });
}

const SCRIPTS = [
  path.join(__dirname, 'agents/intelligence/china-news-agent.js'),
  path.join(__dirname, 'agents/governance/verification-agent.js'),
  path.join(__dirname, 'agents/intelligence/pricing-tracker-agent.js'),
];

async function runPipeline() {
  console.log(`\n🔄 [${new Date().toISOString()}] Pipeline START`);
  for (const s of SCRIPTS) {
    try { await runScript(s); }
    catch(e) { console.error(`❌ ${path.basename(s)}: ${e.message}`); }
  }
  console.log(`✅ [${new Date().toISOString()}] Pipeline END\n`);
}

// كل 6 ساعات
cron.schedule('0 */6 * * *', runPipeline, { timezone: 'Asia/Riyadh' });

// تشغيل فوري عند البدء
runPipeline();

console.log('⏰ cron-runner started — every 6h (Asia/Riyadh)');
