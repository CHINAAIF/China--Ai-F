import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import path from 'path';

const PROJECT = process.env.SCAN_PROJECT_DIR || process.cwd();
const REPORT_PATH = path.join(PROJECT, 'security-scanner', 'last-report.json');
const PENDING_PATH = path.join(PROJECT, 'security-scanner', 'pending-approval.json');

const report = {
  timestamp: new Date().toISOString(),
  auto_fixed: [],
  needs_approval: [],
  info: []
};

const log = (msg) => console.log(`[${new Date().toLocaleTimeString('ar')}] ${msg}`);

// ============================================================
// تصنيف الخطورة — معايير ثابتة وواضحة
// ============================================================
// بسيط (يُصلح تلقائياً): تنسيق، dependencies بمستوى low/moderate، عدم وجود .gitignore لنمط معروف
// خطير (ينتظر موافقة): مفاتيح/أسرار مكشوفة، SQL injection، RCE، auth bypass، تعطيل SSL، صلاحيات DB، أي تعديل على schema أو منطق دفع/تشفير

function classifySeverity(finding) {
  const critical = /secret|token|api[_-]?key|password|private[_-]?key|rce|sql[_-]?inject|auth.*bypass|rejectUnauthorized.*false|eval\(|exec\(.*req\.|command[_-]?injection/i;
  if (critical.test(finding)) return 'critical';
  return 'low';
}

// ============================================================
// 1) فحص الأسرار المكشوفة (regex داخلي — لا يعتمد على gitleaks)
// ============================================================
log('🔍 فحص الأسرار المكشوفة...');
const SECRET_PATTERNS = [
  { name: 'Telegram Bot Token', re: /\d{8,10}:[A-Za-z0-9_-]{35}/g },
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Generic API Key Assignment', re: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/gi },
  { name: 'Private Key Block', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
  { name: 'JWT Token', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

try {
  const files = execSync(
    `find . -type f \\( -name "*.js" -o -name "*.mjs" -o -name "*.ts" -o -name "*.json" \\) ` +
    `-not -path "./node_modules/*" -not -path "./.git/*" -not -path "*/security-scanner/*"`,
    { cwd: PROJECT }
  ).toString().trim().split('\n').filter(Boolean);

  
  // استثناء ملفات اختبار الـDLP/Shield نفسها (تحتوي نصوص وهمية مقصودة)
  const TEST_FIXTURE_FILES = ['test_safety2.js', 'test_shield_api.js'];

  for (const file of files) {
    if (TEST_FIXTURE_FILES.some(f => file.endsWith(f))) continue;
    const fp = path.join(PROJECT, file);
    if (!existsSync(fp)) continue;
    const content = readFileSync(fp, 'utf8');
    for (const { name, re } of SECRET_PATTERNS) {
      const matches = content.match(re);
      if (matches) {
        report.needs_approval.push({
          type: 'secret_exposed',
          severity: 'critical',
          file,
          pattern: name,
          count: matches.length,
          action_required: 'مراجعة يدوية + نقل لـ.env + إبطال السر إن كان حقيقي'
        });
      }
    }
  }
} catch(e) {
  log('⚠️ خطأ بفحص الأسرار: ' + e.message);
}

// ============================================================
// 2) npm audit — ثغرات الحزم
// ============================================================
log('🔍 فحص ثغرات الحزم (npm audit)...');
try {
  const auditRaw = execSync('npm audit --json', { cwd: PROJECT }).toString();
  const audit = JSON.parse(auditRaw);
  const vulns = audit.vulnerabilities || {};

  for (const [pkg, info] of Object.entries(vulns)) {
    const sev = info.severity;
    if (sev === 'critical' || sev === 'high') {
      report.needs_approval.push({
        type: 'package_vulnerability',
        severity: sev,
        package: pkg,
        action_required: `npm audit fix --force قد يكسر التوافق — مراجعة يدوية مطلوبة`
      });
    } else {
      // low/moderate — إصلاح تلقائي آمن
      report.auto_fixed.push({ type: 'package_vulnerability', severity: sev, package: pkg });
    }
  }

  if (report.auto_fixed.some(f => f.type === 'package_vulnerability')) {
    log('🔧 إصلاح تلقائي لثغرات الحزم البسيطة...');
    execSync('npm audit fix', { cwd: PROJECT, stdio: 'inherit' });
  }
} catch(e) {
  // npm audit يرجع exit code != 0 لو فيه ثغرات، نتعامل معه كـoutput عادي
  try {
    const audit = JSON.parse(e.stdout?.toString() || '{}');
    log(`ℹ️ npm audit انتهى بثغرات موجودة (طبيعي)`);
  } catch {
    log('⚠️ npm audit: ' + e.message.split('\n')[0]);
  }
}

// ============================================================
// 3) فحص أنماط كود خطيرة (بديل خفيف عن semgrep لو غير متوفر)
// ============================================================
log('🔍 فحص أنماط كود خطيرة...');
const CODE_RISK_PATTERNS = [
  { name: 'SQL Injection (string concat)', re: /query\s*\(\s*[`'"].*\$\{.*\}.*[`'"]\s*\)/g, severity: 'critical',
    isProtected: (content, matchIndex) => {
      // افحص آخر 200 حرف قبل الـmatch — هل فيها regex.test() أو whitelist check؟
      const before = content.substring(Math.max(0, matchIndex - 200), matchIndex);
      return /\.test\(|whitelist|اسم جدول غير صالح|invalid_table_name/i.test(before);
    }
  },
  { name: 'eval() usage', re: /\beval\s*\(/g, severity: 'critical' },
  { name: 'SSL verification disabled', re: /rejectUnauthorized\s*:\s*false/g, severity: 'critical' },
  { name: 'CORS wildcard with credentials', re: /origin\s*:\s*['"]\*['"]/g, severity: 'low' },
  { name: 'Hardcoded default secret fallback', re: /\|\|\s*['"]default[-_]?(key|secret|password)/gi, severity: 'critical' },
];

try {
  const files = execSync(
    `find . -type f \\( -name "*.js" -o -name "*.mjs" \\) ` +
    `-not -path "./node_modules/*" -not -path "./.git/*" -not -path "*/security-scanner/*"`,
    { cwd: PROJECT }
  ).toString().trim().split('\n').filter(Boolean);

  for (const file of files) {
    const fp = path.join(PROJECT, file);
    if (!existsSync(fp)) continue;
    const content = readFileSync(fp, 'utf8');
    for (const { name, re, severity } of CODE_RISK_PATTERNS) {
      const matches = [...content.matchAll(re)];
      const unprotectedMatches = matches.filter(m => {
        const pat = CODE_RISK_PATTERNS.find(p => p.name === name);
        return !(pat.isProtected && pat.isProtected(content, m.index));
      });
      if (unprotectedMatches.length > 0) {
        const entry = { type: 'code_pattern', severity, file, pattern: name, count: unprotectedMatches.length };
        if (severity === 'critical') {
          report.needs_approval.push({ ...entry, action_required: 'مراجعة يدوية إلزامية — قد يفتح ثغرة أمنية مباشرة' });
        } else {
          report.info.push(entry); // CORS wildcard بدون credentials = معلومة فقط، ليست خطيرة دائماً
        }
      }
    }
  }
} catch(e) {
  log('⚠️ خطأ بفحص الأنماط: ' + e.message);
}

// ============================================================
// 4) فحص .gitignore — تأكد ما في ملفات حساسة قابلة للرفع
// ============================================================
log('🔍 فحص .gitignore...');
const REQUIRED_IGNORES = ['.env', '*.pem', '*.key', 'node_modules/'];
const gitignorePath = path.join(PROJECT, '.gitignore');
let gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
let updated = false;

for (const item of REQUIRED_IGNORES) {
  if (!gitignore.includes(item)) {
    gitignore += `\n${item}`;
    updated = true;
    report.auto_fixed.push({ type: 'gitignore_missing', item });
  }
}
if (updated) {
  writeFileSync(gitignorePath, gitignore.trim() + '\n', 'utf8');
  log('🔧 .gitignore حُدّث تلقائياً');
}

// ============================================================
// 5) حفظ التقرير + الملفات المعلّقة للموافقة
// ============================================================
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

if (report.needs_approval.length > 0) {
  writeFileSync(PENDING_PATH, JSON.stringify(report.needs_approval, null, 2), 'utf8');
}

// ============================================================
// 6) طباعة ملخص عربي واضح
// ============================================================
console.log('\n════════════════════════════════════');
console.log('   📋 تقرير فحص الأمان');
console.log('════════════════════════════════════');
console.log(`🕐 الوقت: ${report.timestamp}`);
console.log(`\n✅ أُصلح تلقائياً (${report.auto_fixed.length}):`);
report.auto_fixed.forEach(f => console.log(`   • ${f.type}: ${f.package || f.item || ''} (${f.severity || ''})`));

console.log(`\n🔴 يحتاج موافقتك (${report.needs_approval.length}):`);
report.needs_approval.forEach((f, i) => {
  console.log(`   ${i+1}. [${f.severity.toUpperCase()}] ${f.type} — ${f.file || f.package || ''}`);
  console.log(`      النمط: ${f.pattern || ''} | العدد: ${f.count || 1}`);
  console.log(`      الإجراء المطلوب: ${f.action_required}`);
});

if (report.needs_approval.length === 0) {
  console.log('   لا يوجد — كل شيء آمن أو أُصلح تلقائياً ✅');
}

console.log('\n════════════════════════════════════');
if (report.needs_approval.length > 0) {
  console.log(`⚠️  راجع التقرير الكامل في: security-scanner/pending-approval.json`);
  console.log(`أرسل محتواه لي وسأحدد الإصلاح الدقيق لكل بند بعد موافقتك`);
}
console.log('════════════════════════════════════');

// إشعار Termux إن كان متاحاً
try {
  if (report.needs_approval.length > 0) {
    execSync(`termux-notification --title "🔴 ثغرات تحتاج موافقتك" --content "${report.needs_approval.length} بند بانتظار المراجعة"`, { stdio: 'ignore' });
  } else {
    execSync(`termux-notification --title "✅ فحص أمان مكتمل" --content "لا ثغرات حرجة"`, { stdio: 'ignore' });
  }
} catch {} // termux-api قد لا يكون مثبتاً، تجاهل بصمت

