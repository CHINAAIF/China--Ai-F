export const LANGS={ar:{n:'العربية',d:'rtl'},en:{n:'English',d:'ltr'},zh:{n:'中文',d:'ltr'},es:{n:'Español',d:'ltr'},fr:{n:'Français',d:'ltr'},de:{n:'Deutsch',d:'ltr'},ja:{n:'日本語',d:'ltr'},ko:{n:'한국어',d:'ltr'},pt:{n:'Português',d:'ltr'},ru:{n:'Русский',d:'ltr'},it:{n:'Italiano',d:'ltr'},nl:{n:'Nederlands',d:'ltr'},pl:{n:'Polski',d:'ltr'},tr:{n:'Türkçe',d:'ltr'},vi:{n:'Tiếng Việt',d:'ltr'},th:{n:'ภาษาไทย',d:'ltr'},id:{n:'Bahasa Indonesia',d:'ltr'},he:{n:'עברית',d:'rtl'},fa:{n:'فارسی',d:'rtl'},ur:{n:'اردو',d:'rtl'},hi:{n:'हिन्दी',d:'ltr'},bn:{n:'বাংলা',d:'ltr'},ta:{n:'தமிழ்',d:'ltr'},sv:{n:'Svenska',d:'ltr'},da:{n:'Dansk',d:'ltr'},fi:{n:'Suomi',d:'ltr'}};
export const TERM={model:{ar:'نموذج',zh:'模型',ja:'モデル',ko:'모델',de:'Modell',fr:'Modèle',es:'Modelo',ru:'Модель',tr:'Model',fa:'مدل',he:'מודל',hi:'मॉडल'},benchmark:{ar:'معيار',zh:'基准',ja:'ベンチマーク',ko:'벤치마크',fr:'Benchmark',es:'Referencia',ru:'Бенчмарк',fa:'بنچمارک',hi:'बेंचमार्क'},accuracy:{ar:'دقة',zh:'准确度',ja:'精度',ko:'정확도',de:'Genauigkeit',fr:'Précision',es:'Precisión',ru:'Точность',tr:'Doğruluk',fa:'دقت',hi:'सटीकता'},latency:{ar:'كمون',zh:'延迟',ja:'レイテンシ',ko:'지연',de:'Latenz',fr:'Latence',es:'Latencia',ru:'Задержка',tr:'Gecikme',fa:'تأخیر',hi:'विलंब'},token:{ar:'توكن',zh:'令牌',ja:'トークン',ko:'토큰',de:'Token',fr:'Jeton',es:'Token',ru:'Токен',fa:'توکن',hi:'टोकन'},pricing:{ar:'تسعير',zh:'定价',ja:'価格設定',ko:'가격',de:'Preisgestaltung',fr:'Tarification',es:'Precios',ru:'Цены',tr:'Fiyat',fa:'قیمت',hi:'मूल्य'},security:{ar:'أمان',zh:'安全',ja:'セキュリティ',ko:'보안',de:'Sicherheit',fr:'Sécurité',es:'Seguridad',ru:'Безопасность',tr:'Güvenlik',fa:'امنیت',hi:'सुरक्षा'}};

class PolyglotEngine{
  constructor(){this.cache=new Map();}
  
  detect(text){
    if(!text)return{lang:'en',conf:0};
    const t=text.trim();
    // Arabic/Persian/Urdu detection
    if(/[\u0600-\u06FF]/.test(t)){
      if(/[\u0671-\u06D3]/.test(t))return{lang:'ar',conf:95,dir:'rtl'};
      if(/[\u06A9-\u06D5]/.test(t))return{lang:'fa',conf:92,dir:'rtl'};
      return{lang:'ar',conf:88,dir:'rtl'};
    }
    // Hebrew
    if(/[\u0590-\u05FF]/.test(t))return{lang:'he',conf:95,dir:'rtl'};
    // CJK
    if(/[\u4E00-\u9FFF]/.test(t)){if(/[\u3040-\u309F]/.test(t))return{lang:'ja',conf:90,dir:'ltr'};return{lang:'zh',conf:90,dir:'ltr'};}
    // Korean
    if(/[\uAC00-\uD7AF]/.test(t))return{lang:'ko',conf:92,dir:'ltr'};
    // Devanagari (Hindi)
    if(/[\u0900-\u097F]/.test(t))return{lang:'hi',conf:90,dir:'ltr'};
    // Thai
    if(/[\u0E00-\u0E7F]/.test(t))return{lang:'th',conf:90,dir:'ltr'};
    // Cyrillic
    if(/[\u0400-\u04FF]/.test(t))return{lang:'ru',conf:85,dir:'ltr'};
    // Latin-based heuristics
    const latinWords={'el':/^(el|la|los|las|un|una|unos|unas|que|por|para|con|de|del|en|es|son|está|están)\b/i,
      'fr':/^(le|la|les|un|une|des|que|pour|avec|de|du|en|est|sont|dans|sur)\b/i,
      'de':/^(der|die|das|den|dem|ein|eine|und|oder|aber|mit|von|zu|auf|in|an|ist|sind)\b/i,
      'pt':/^(o|a|os|as|um|uma|uns|umas|que|por|para|com|de|do|em|é|são)\b/i,
      'it':/^(il|lo|la|i|gli|le|un|una|che|di|del|in|con|su|per|è|sono)\b/i,
      'nl':/^(de|het|een|van|met|op|aan|voor|is|zijn|er|wat|dat)\b/i,
      'pl':/^(ten|ta|to|z|w|na|do|od|nie|jest|są|dla|o)\b/i,
      'tr':/^(bir|ve|bu|için|ile|de|da|ne|mi|ben|sen|o|bu)\b/i,
      'sv':/(en|ett|den|det|och|är|har|intill|med|för|på|vid|ej|jag|du|hon)\b/i,
      'vi':/^(một|và|của|cho|trong|là|có|không|được|với|nhưng|tôi|bạn)\b/i,
      'id':/^(saya|anda|dia|kami|mereka|itu|ini|yang|dengan|untuk|pada|dari|ada|tidak|bukan)\b/i,
      'th':/^(ผม|คุณ|เขา|เรา|พวกเขา|นี้|นั้น|ที่|กับ|สำหรับ|ใน|จาก|มี|ไม่|เป็น)\b/i,
      'bn':/(আমি|আপনি|সে|এই|ওই|এবং|জন্য|সঙ্গে|মধ্যে|থেকে|আছে|নেই|হয়|করে)\b/i,
      'ta':/(நான்|நீங்கள்|அவர்|இது|அது|மற்றும்|ஒரு|உடன்|இல்|இருந்து|செய்ய|இல்லை|ஆம்)\b/i};
    
    let best='en',bestScore=50;
    for(const[l,re] of Object.entries(latinWords)){const m=t.match(re);if(m&&m.length>2){if(m.length>bestScore){best=l;bestScore=m.length;}}}
    return{lang:best,conf:Math.min(95,bestScore+30),dir:(best==='ar'||best==='he'||best==='fa')?'rtl':'ltr'};
  }
  
  translate(term,targetLang){
    const t=TERM[term];if(!t)return term;
    return t[targetLang]||term;
  }
  
  getDir(lang){return LANGS[lang]?.d||'ltr';}
  getName(lang){return LANGS[lang]?.n||lang;}
  
  formatNumber(n,lang){
    if(lang==='ar')return new Intl.NumberFormat('ar-EG').format(n);
    if(lang==='zh')return new Intl.NumberFormat('zh-CN').format(n);
    return n.toLocaleString();
  }
}
export default PolyglotEngine;

// Quick test
const engine=new PolyglotEngine();
console.log('=== POLYGLOT ENGINE TEST ===');
console.log('Languages supported:',Object.keys(LANGS).length);

const tests=[
  {text:'مرحبا كيف حالك',expect:'ar'},
  {text:'Hello world test',expect:'en'},
  {text:'Bonjour le monde',expect:'fr'},
  {text:'Hola mundo prueba',expect:'es'},
  {text:'Hallo Welt Test',expect:'de'},
  {text:'Ciao mondo prova',expect:'it'},
  {text:'こんにちは世界',expect:'ja'},
  {text:'안녕하세요 세계',expect:'ko'},
  {text:'你好世界测试',expect:'zh'},
  {text:'سلام دنیا',expect:'fa'},
  {text:'שלום עולם',expect:'he'},
  {text:'नमस्ते दुनिया',expect:'hi'}
];

let pass=0;
for(const t of tests){
  const r=engine.detect(t.text);
  const ok=r.lang===t.expect;
  console.log((ok?'✅':'❌'),t.text.padEnd(20),'→',r.lang,'(',r.conf,'%) dir:',r.dir);
  if(ok)pass++;
}

console.log('\nTranslate "accuracy" to Arabic:',engine.translate('accuracy','ar'));
console.log('Translate "model" to Japanese:',engine.translate('model','ja'));
console.log('Translate "security" to Persian:',engine.translate('security','fa'));
console.log('\nScore:',pass+'/'+tests.length);
