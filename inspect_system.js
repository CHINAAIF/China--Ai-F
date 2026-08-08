import fs from 'fs';
import path from 'path';

// هذا الكود يبحث عن ملفات التكوين والوكلاء
function inspect() {
  console.log("🔍 Running System Diagnostics...");
  
  // نفترض أن الوكلاء موجودون في مجلد agents
  const agentsPath = './agents'; 
  if (fs.existsSync(agentsPath)) {
    const agents = fs.readdirSync(agentsPath);
    console.log(`✅ Found ${agents.length} agent modules.`);
    agents.forEach(agent => console.log(`   - Agent: ${agent}`));
  } else {
    console.log("⚠️ No 'agents' folder found. Searching root...");
  }

  // فحص ملف package.json لمعرفة المكتبات المستخدمة (هل هو OpenAI أو LangChain أو AutoGPT؟)
  if (fs.existsSync('./package.json')) {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    console.log("\n📦 Core Dependencies:");
    console.log(pkg.dependencies);
  }
}

inspect();
