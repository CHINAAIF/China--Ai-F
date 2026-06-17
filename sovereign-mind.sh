#!/bin/bash
cd ~/downloads/China--Ai-F
LOG="logs/sovereign-mind.log"
mkdir -p logs

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG; }

fix_and_test() {
  # اختبر السيرفر
  if ! curl -s --max-time 3 http://localhost:5000/health > /dev/null 2>&1; then
    log "⚠️ Server down — restarting..."
    pkill -f "node index.js" 2>/dev/null
    sleep 2
    node index.js >> logs/server.log 2>&1 &
    sleep 8
    if curl -s --max-time 3 http://localhost:5000/health > /dev/null 2>&1; then
      log "✅ Server restored"
    else
      log "❌ Server failed — checking errors..."
      ERROR=$(node index.js 2>&1 | grep -i "error\|Error" | head -3)
      log "Error: $ERROR"
      # إصلاح تلقائي لمشكلة الـ routes
      node --input-type=module << 'FIXEOF'
import { readFileSync, writeFileSync } from 'fs';
const c = readFileSync('index.js','utf8');
const listenPos = c.indexOf('const server = app.listen');
const handlerPos = c.indexOf('app.use((err, req, res, next)');
if (listenPos > handlerPos && handlerPos > -1) {
  const fixed = c.replace('const server = app.listen', '//TEMP').replace('app.use((err, req, res, next)', 'const server = app.listen(process.env.PORT||5000,"0.0.0.0",()=>{});\napp.use((err, req, res, next)').replace('//TEMP','');
  writeFileSync('index.js', fixed);
  console.log('AUTO-FIXED: route order');
}
FIXEOF
    fi
  fi

  # تحقق من قاعدة البيانات
  node --input-type=module << 'DBEOF' >> $LOG 2>&1
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const tables = ['intelligence_raw','agent_registry','agent_heartbeat','agent_task_queue','brain_long_memory'];
for (const t of tables) {
  try { await pool.query(`SELECT 1 FROM ${t} LIMIT 1`); }
  catch(e) { console.log(`MISSING TABLE: ${t} — ${e.message}`); }
}
await pool.end();
DBEOF

  # شغّل الوكلاء المجدولة
  HOUR=$(date +%H)
  MIN=$(date +%M)
  
  # كل ساعة — news agent
  if [ "$MIN" = "00" ]; then
    log "🤖 Running china_news_agent..."
    node agents/intelligence/china-news-agent.js >> logs/agents.log 2>&1 &
  fi

  # كل 6 ساعات — pricing
  if [ "$MIN" = "00" ] && ([ "$HOUR" = "00" ] || [ "$HOUR" = "06" ] || [ "$HOUR" = "12" ] || [ "$HOUR" = "18" ]); then
    log "💰 Running pricing_tracker_agent..."
    node agents/intelligence/pricing-tracker-agent.js >> logs/agents.log 2>&1 &
  fi

  # ارفع التغييرات لـ GitHub كل 6 ساعات
  if [ "$MIN" = "30" ] && ([ "$HOUR" = "06" ] || [ "$HOUR" = "18" ]); then
    log "📤 Auto-pushing to GitHub..."
    git add . && git commit -m "auto: sovereign mind update $(date)" && git push origin main >> $LOG 2>&1
  fi
}

log "🧠 Sovereign Mind Started — Full Auto Mode"
while true; do
  fix_and_test
  sleep 300
done
