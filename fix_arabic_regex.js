import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function run() {
  // \b word boundary doesn't work with Arabic characters
  // Fix all rules that contain Arabic text by removing \b
  var fixes = [
    ['social_eng_attack', '(?:ارسل لي رمز|send me the code|ما هو OTP|اعطني كلمة المرور|ما PIN)'],
    ['ransomware_attack', '(?:فدية|ransomware|تشفير الملفات|encrypt all files|bitcoin payment)'],
    ['phone_hack_attack', '(?:اختراق هاتفي|hack my phone|spyware|تتبع موقعي|read my whatsapp)'],
    ['corp_breach_attack', '(?:اختراق الشركة|اختراق الخادم|access the server|ssh into|RDP into)'],
    ['data_exfil_attack', '(?:سحب البيانات|data exfiltration|export database|dump database)'],
    ['supply_chain_attack', '(?:سلسلة التوريد|supply chain|poisoned package|malicious dependency)'],
    ['diagnosis_health', '(?:تشخيص|diagnosis|مرضي|مريض|patient|سرطان|HIV|إيدز)'],
    ['medication_health', '(?:دواء|علاج|medication|جرعة|dosage|مضاد حيوي|أدوية مضادة)'],
    ['mental_health', '(?:اكتئاب|انتحار|suicide|depression|اضطراب نفسي|psychiatric)'],
    ['classified_gov', '(?:سري للغاية|top secret|classified|سرية للغاية)'],
    ['military_gov', '(?:عسكري|military|قاعدة عسكرية|صاروخ|missile|ذخيرة|ammunition)'],
    ['intelligence_gov', '(?:مخابرات|intelligence agency|CIA|MI6|موساد|Mossad|NSA|FBI)'],
    ['nuclear_gov', '(?:نووي|nuclear|يورانيوم|uranium|بلوتونيوم|plutonium)'],
    ['phishing_attack', '(?:اضغط هنا|click here|فز برايز|لقد فزت|verify your account|تأكيد حسابك)'],
    ['brute_force_attack', '(?:crack|فك التشفير|brute force|wordlist|hashcat|john the ripper)'],
    ['bank_account_financial', '(?:حساب|account)\\s*[:\\s]?\\d{8,20}'],
    ['db_password_creds', '(?:password|passwd|pwd|كلمة المرور|رمز الدخول)\\s*[:=]\\s*[\\w!@#$%^&*]{4,}'],
    ['address_pii', '(?:شارع|حي|مدينة|صندوق بريد|PO Box)\\s*[\\w\\d\\s,-]{5,}'],
    ['full_name_pii', '(?:الاسم|اسمي|أنا|我叫|my name is)\\s+[\\u0600-\\u06FF\\s]{3,20}'],
    ['mitm_attack', '(?:man in the middle|ARP spoof|dns spoof|wireshark|tcpdump)'],
    ['insider_threat_attack', '(?:بصفتي موظف|as an employee|internal access|صلاحياتي الداخلية)'],
    ['ddos_attack', '(?:DDoS|هجوم إغراق|botnet|僵尸网络|LOIC|HOIC)']
  ];
  var fixed = 0;
  for (var i = 0; i < fixes.length; i++) {
    try {
      var r = await pool.query('UPDATE data_sensitivity_rules SET pattern=$1 WHERE rule_name=$2', [fixes[i][1], fixes[i][0]]);
      if (r.rowCount > 0) { console.log('OK: ' + fixes[i][0]); fixed++; }
    } catch(e) { console.log('ERR: ' + fixes[i][0] + ' ' + e.message); }
  }
  console.log('\nFixed: ' + fixed + '/' + fixes.length);
  // Clear cache
  console.log('NOTE: restart needed to clear rules cache');
  await pool.end();
}
run();
