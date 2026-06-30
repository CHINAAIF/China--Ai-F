import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function run() {
  await pool.query("UPDATE data_sensitivity_rules SET active=false");
  console.log('Deactivated old rules');
  var rules = [
    ['email_pii','pii','[\\w.-]+@[\\w.-]+\\.\\w{2,}',7,'warn','بريد إلكتروني'],
    ['phone_pii','pii','\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b',6,'warn','رقم هاتف'],
    ['national_id_pii','pii','\\b(?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB|EG|MA|DZ|TN|LY|SD)\\d{6,12}\\b',9,'warn','رقم هوية وطنية'],
    ['ssn_pii','pii','\\b\\d{3}-\\d{2}-\\d{4}\\b',9,'warn','رقم ضمان اجتماعي'],
    ['passport_pii','pii','\\b[A-Z]{1,2}\\d{6,9}\\b',8,'warn','رقم جواز سفر'],
    ['dob_pii','pii','\\b(?:19|20)\\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\\d|3[01])\\b',5,'warn','تاريخ ميلاد'],
    ['full_name_pii','pii','(?:الاسم|اسمي|أنا)\\s+[\\u0600-\\u06FF\\s]{3,20}',4,'flag','اسم شخصي'],
    ['credit_card_financial','financial','\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b',10,'block','بطاقة ائتمان'],
    ['cvv_financial','financial','\\b\\d{3,4}\\b(?:\\s*(?:CVV|CVC|PIN|رمز))',10,'block','رمز CVV'],
    ['iban_financial','financial','\\b[A-Z]{2}\\d{2}[A-Z0-9]{4,30}\\b',9,'warn','رقم IBAN'],
    ['bank_account_financial','financial','\\b(?:حساب|account)\\s*[:\\s]?\\d{8,20}\\b',9,'warn','حساب بنكي'],
    ['crypto_wallet_financial','financial','\\b(?:0x)[a-fA-F0-9]{40}\\b',8,'warn','محفظة كريبتو'],
    ['crypto_private_financial','financial','\\b(?:5[HJK])[1-9A-Za-z]{49}\\b',10,'block','مفتاح كريبتو خاص'],
    ['aws_key_creds','proprietary','\\bAKIA[0-9A-Z]{16}\\b',10,'block','مفتاح AWS'],
    ['aws_secret_creds','proprietary','\\b[A-Za-z0-9/+=]{40}\\b',10,'block','مفتاح AWS Secret'],
    ['gcp_key_creds','proprietary','\\bAIza[0-9A-Za-z_-]{35}\\b',10,'block','مفتاح GCP'],
    ['openai_key_creds','proprietary','\\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\\b',10,'block','مفتاح OpenAI'],
    ['groq_key_creds','proprietary','\\bgsk_[A-Za-z0-9]{20,}\\b',10,'block','مفتاح Groq'],
    ['generic_api_key_creds','proprietary','\\b(?:api[_-]?key|apikey|bearer|token)\\s*[:=]\\s*[\\w-]{20,}',9,'warn','مفتاح API عام'],
    ['jwt_token_creds','proprietary','\\beyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b',10,'block','JWT Token'],
    ['private_key_creds','proprietary','-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',10,'block','مفتاح تشفير خاص'],
    ['db_password_creds','proprietary','\\b(?:password|passwd|pwd|كلمة المرور|رمز الدخول)\\s*[:=]\\s*[\\w!@#$%^&*]{4,}',8,'warn','كلمة مرور'],
    ['connection_string_creds','proprietary','\\b(?:mongodb|postgres|mysql|redis)://[\\w:]+@[\\w.-]+\\b',10,'block','سلسلة اتصال DB'],
    ['diagnosis_health','health','\\b(?:تشخيص|diagnosis|مرضي|مريض|patient|سرطان|HIV|إيدز)\\b',7,'warn','تشخيص طبي'],
    ['medication_health','health','\\b(?:دواء|علاج|medication|جرعة|dosage|مضاد حيوي)\\b',5,'flag','أدوية'],
    ['mental_health','health','\\b(?:اكتئاب|انتحار|suicide|depression|اضطراب نفسي)\\b',8,'warn','صحة نفسية'],
    ['classified_gov','government','\\b(?:سري للغاية|top secret|classified|سرية للغاية)\\b',10,'block','مستند سري'],
    ['military_gov','government','\\b(?:عسكري|military|قاعدة عسكرية|صاروخ|missile|ذخيرة)\\b',9,'block','معلومات عسكرية'],
    ['intelligence_gov','government','\\b(?:مخابرات|intelligence|CIA|MI6|موساد|NSA|FBI)\\b',8,'warn','استخبارات'],
    ['nuclear_gov','government','\\b(?:نووي|nuclear|يورانيوم|uranium|بلوتونيوم)\\b',10,'block','أسلحة نووية'],
    ['sql_injection_attack','attack',"\\b(?:\\x27\\s*OR\\s*\\x27|UNION\\s+SELECT|DROP\\s+TABLE)\\b",10,'block','SQL Injection'],
    ['xss_attack','attack','<script[^>]*>[\\s\\S]*?</script>',10,'block','XSS'],
    ['path_traversal_attack','attack','\\b(?:\\.\\./|\\.\\.\\\\|%2e%2e)\\b',9,'block','Path Traversal'],
    ['cmd_injection_attack','attack','\\b[;|](?:rm|wget|curl|bash|sh|python|nc)\\b',10,'block','Command Injection'],
    ['reverse_shell_attack','attack','\\b(?:bash -i|/dev/tcp|nc -[elv])\\b',10,'block','Reverse Shell'],
    ['phishing_attack','attack','\\b(?:اضغط هنا|click here|فز برايز|لقد فزت|verify your)\\b',7,'warn','تصيد احتيالي'],
    ['social_eng_attack','attack','\\b(?:ارسل لي رمز|send me the code|ما هو OTP|اعطني كلمة المرور)\\b',9,'block','هندسة اجتماعية'],
    ['brute_force_attack','attack','\\b(?:crack|فك التشفير|brute force|hashcat|john the ripper)\\b',8,'warn','كسر تشفير'],
    ['ddos_attack','attack','\\b(?:DDoS|هجوم إغراق|botnet|LOIC|HOIC)\\b',9,'block','هجوم إغراق'],
    ['corp_breach_attack','attack','\\b(?:اختراق الشركة|اختراق الخادم|access the server)\\b',10,'block','اختراق مؤسسي'],
    ['data_exfil_attack','attack','\\b(?:سحب البيانات|data exfiltration|export database)\\b',10,'block','سرقة بيانات'],
    ['ransomware_attack','attack','\\b(?:فدية|ransomware|تشفير الملفات|encrypt all)\\b',10,'block','رانسوموير'],
    ['supply_chain_attack','attack','\\b(?:سلسلة التوريد|supply chain|poisoned package)\\b',8,'warn','سلسلة توريد'],
    ['phone_hack_attack','attack','\\b(?:اختراق هاتفي|hack my phone|spyware|تتبع موقعي)\\b',10,'block','اختراق هاتف'],
    ['imei_device','pii','\\b\\d{15}\\b',5,'flag','رقم IMEI'],
    ['mac_address_device','pii','\\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\\b',5,'flag','عنوان MAC'],
    ['gps_location_pii','pii','\\b(?:خط العرض|latitude|خط الطول|longitude)\\s*[:\\s]?-?\\d+\\.?\\d*',7,'warn','إحداثيات موقع'],
    ['ip_address_pii','pii','\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b',5,'flag','عنوان IP'],
    ['internal_ip_network','attack','\\b(?:10\\.|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b',9,'warn','IP داخلي'],
    ['port_scan_network','attack','\\b(?:nmap|port scan|مسح المنافذ)\\s*\\d{1,5}\\b',8,'warn','مسح منافذ']
  ];
  var added = 0;
  for (var i = 0; i < rules.length; i++) {
    try {
      await pool.query("INSERT INTO data_sensitivity_rules (rule_name,category,pattern,risk_level,action,description) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (rule_name) DO UPDATE SET active=true, pattern=$3, risk_level=$4, action=$5, description=$6", rules[i]);
      added++;
    } catch(e) { console.log('ERR: ' + rules[i][0] + ' ' + e.message); }
  }
  console.log('OK: ' + added + ' rules');
  var c = await pool.query("SELECT category, count(*) as c FROM data_sensitivity_rules WHERE active=true GROUP BY category ORDER BY c DESC");
  c.rows.forEach(function(r) { console.log('  ' + r.category + ': ' + r.c); });
  await pool.end();
}
run();
