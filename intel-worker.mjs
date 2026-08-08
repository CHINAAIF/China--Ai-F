import https from 'https';
import http from 'http';
import dns from 'dns';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════
// AIR-GAPPED CONFIG: Worker only knows the ingest endpoint
// ═══════════════════════════════════════════════════════════
const INGEST_URL = process.env.INGEST_URL || 'http://127.0.0.1:8080/internal/intel/ingest';
const INGEST_SECRET = process.env.INGEST_SECRET || 'trunkia_intel_secret_2026';

// ═══════════════════════════════════════════════════════════
// CYBERSECURITY SHIELD LAYER 1: SSRF Prevention
// ═══════════════════════════════════════════════════════════
function isPrivateIP(ip) {
  if (!ip) return true;
  const parts = ip.split('.').map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  return false;
}

async function resolveAndVerifyDNS(hostname) {
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateIP(addr.address)) {
        throw new Error('SSRF_BLOCKED: ' + hostname + ' resolves to private IP ' + addr.address);
      }
    }
    return addresses;
  } catch (e) {
    throw new Error('DNS_RESOLUTION_FAILED: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// CYBERSECURITY SHIELD LAYER 2: Safe Fetch with OOM Protection
// ═══════════════════════════════════════════════════════════
function fetchUrlSafe(url) {
  return new Promise(async (resolve, reject) => {
    try {
      const parsed = new URL(url);
      
      // DNS Verification
      await resolveAndVerifyDNS(parsed.hostname);
      
      const lib = parsed.protocol === 'https:' ? https : http;
      const MAX_BYTES = 2 * 1024 * 1024;
      
      const req = lib.get(url, {
        headers: { 'User-Agent': 'TRUNKIA-IntelBot/3.0-Secure' },
        timeout: 8000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try {
            const redirectUrl = new URL(res.headers.location, url);
            if (isPrivateIP(redirectUrl.hostname)) {
              return reject(new Error('SSRF_BLOCKED: Redirect to private IP'));
            }
            return fetchUrlSafe(redirectUrl.toString()).then(resolve).catch(reject);
          } catch { return reject(new Error('Invalid redirect')); }
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP_' + res.statusCode));
        
        let data = '';
        let bytesReceived = 0;
        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          bytesReceived += Buffer.byteLength(chunk);
          if (bytesReceived > MAX_BYTES) {
            req.destroy();
            reject(new Error('PAYLOAD_TOO_LARGE'));
            return;
          }
          data += chunk;
        });
        
        res.on('end', () => resolve(data));
      });
      
      req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
      req.on('error', reject);
    } catch (err) { reject(err); }
  });
}

// ═══════════════════════════════════════════════════════════
// DATA SANITIZATION LAYER: Anti-Poisoning & Anti-XSS
// ═══════════════════════════════════════════════════════════
function deepSanitize(text) {
  if (!text) return '';
  if (typeof text !== 'string') return '';
  
  return text
    // Remove all script tags and content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]+>/g, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove event handlers (onclick, onload, etc)
    .replace(/on\w+\s*=/gi, '')
    // Remove data: URIs (potential XSS vector)
    .replace(/data:text\/html/gi, '')
    // HTML entity decode
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Remove null bytes
    .replace(/\0/g, '')
    // Trim and limit
    .trim()
    .slice(0, 1000);
}

// Detect prompt injection in fetched content
function detectPromptInjection(text) {
  if (!text) return false;
  const patterns = [
    /ignore (all )?previous instructions/i,
    /you are now (DAN|unrestricted)/i,
    /system prompt/i,
    /forget your (training|rules)/i
  ];
  return patterns.some(p => p.test(text));
}

// ═══════════════════════════════════════════════════════════
// CONTENT EXTRACTION & CLASSIFICATION
// ═══════════════════════════════════════════════════════════
function classifyContent(text) {
  const lower = text.toLowerCase();
  
  if (/\b(price|pricing|cost|per token|per million|api cost)\b/.test(lower)) return 'model_pricing';
  if (/\b(benchmark|sota|accuracy|outperform|beats)\b/.test(lower)) return 'ai_benchmarks';
  if (/\b(law|regulation|ban|policy|compliance|gdpr|act)\b/.test(lower)) return 'ai_regulation';
  if (/\b(gpt-|claude-|gemini-|llama-|deepseek-|qwen-|mistral-)\b/.test(lower)) return 'model_release';
  if (/\b(security|vulnerability|exploit|breach|attack)\b/.test(lower)) return 'ai_security';
  if (/\b(chip|gpu|nvidia|ascend|semiconductor|fabrication)\b/.test(lower)) return 'ai_hardware';
  
  return 'general_ai_news';
}

function extractModels(text) {
  const pattern = /\b(gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|llama-[\w.-]+|deepseek-[\w.-]+|qwen-[\w.-]+|mistral-[\w.-]+|phi-[\w.-]+|gemma-[\w.-]+)\b/gi;
  const matches = text.match(pattern) || [];
  return [...new Set(matches)].slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// RSS PARSER (No external dependencies)
// ═══════════════════════════════════════════════════════════
function parseRSS(xml, sourceName) {
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRx.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const desc = extractTag(block, 'description');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    
    if (title) {
      items.push({
        title: deepSanitize(title),
        description: deepSanitize(desc),
        url: link,
        published: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source: sourceName
      });
    }
  }
  
  return items.slice(0, 10);
}

function extractTag(text, tag) {
  const rx = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>|<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = rx.exec(text);
  return m ? (m[1] || m[2] || '').trim() : '';
}

// ═══════════════════════════════════════════════════════════
// SECURE TRANSMISSION TO QUARANTINE (HMAC Signed)
// ═══════════════════════════════════════════════════════════
async function sendToQuarantine(payload) {
  const body = JSON.stringify(payload);
  
  // HMAC Signature
  const signature = crypto.createHmac('sha256', INGEST_SECRET).update(body).digest('hex');
  
  return new Promise((resolve, reject) => {
    const parsed = new URL(INGEST_URL);
    const lib = parsed.protocol === 'https:' ? https : http;
    
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Intel-Signature': signature,
        'X-Intel-Worker-Version': '3.0-Secure'
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ status: 'parse_error', code: res.statusCode });
        }
      });
    });
    
    req.on('timeout', () => { req.destroy(); reject(new Error('INGEST_TIMEOUT')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// INTELLIGENCE SOURCES (Tiered by credibility)
// ═══════════════════════════════════════════════════════════
const SOURCES = [
  {
    name: 'HackerNews_AI',
    url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    type: 'hackernews',
    topic: 'ai_technology',
    credibility: 85
  },
  {
    name: 'ArXiv_AI',
    url: 'https://export.arxiv.org/rss/cs.AI',
    type: 'rss',
    topic: 'ai_research',
    credibility: 95
  },
  {
    name: 'NIST_AI',
    url: 'https://www.nist.gov/artificial-intelligence/rss.xml',
    type: 'rss',
    topic: 'ai_regulation',
    credibility: 98
  }
];

// ═══════════════════════════════════════════════════════════
// MAIN ISOLATED PIPELINE
// ═══════════════════════════════════════════════════════════
async function runPipeline() {
  const startTime = Date.now();
  console.log('[INTEL_WORKER] Starting isolated pipeline...');
  
  let totalCollected = 0;
  let totalSent = 0;
  let totalRejected = 0;
  
  for (const source of SOURCES) {
    try {
      console.log('[INTEL_WORKER] Fetching: ' + source.name);
      
      const rawData = await fetchUrlSafe(source.url);
      let items = [];
      
      if (source.type === 'rss') {
        items = parseRSS(rawData, source.name);
      } else if (source.type === 'hackernews') {
        const ids = JSON.parse(rawData).slice(0, 10);
        for (const id of ids.slice(0, 5)) {
          try {
            const storyData = await fetchUrlSafe('https://hacker-news.firebaseio.com/v0/item/' + id + '.json');
            const story = JSON.parse(storyData);
            const text = ((story.title || '') + ' ' + (story.url || '')).toLowerCase();
            const aiKeywords = ['ai', 'llm', 'gpt', 'claude', 'gemini', 'model', 'neural', 'openai', 'anthropic', 'deepseek'];
            const isAI = aiKeywords.some(kw => text.includes(kw));
            if (isAI && story.score > 30) {
              items.push({
                title: deepSanitize(story.title),
                description: 'HN Score: ' + story.score,
                url: story.url || '',
                published: new Date(story.time * 1000).toISOString(),
                source: source.name
              });
            }
          } catch (e) { /* skip failed item */ }
        }
      }
      
      // Process and send to quarantine
      for (const item of items) {
        totalCollected++;
        
        // Security Check: Detect prompt injection in content
        if (detectPromptInjection(item.title + ' ' + item.description)) {
          console.warn('[INTEL_WORKER] REJECTED: Prompt injection detected in content from ' + source.name);
          totalRejected++;
          continue;
        }
        
        // Build sanitized payload
        const fullText = item.title + ' ' + item.description;
        const knowledgeType = classifyContent(fullText);
        const modelsFound = extractModels(fullText);
        
        const payload = {
          source_name: source.name,
          source_url: source.url,
          topic: source.topic,
          knowledge_type: knowledgeType,
          credibility: source.credibility,
          content: {
            title: item.title,
            summary: item.description,
            url: item.url,
            published_at: item.published,
            models_mentioned: modelsFound,
            collected_at: new Date().toISOString()
          },
          provenance_hash: crypto.createHash('sha256').update(item.title + item.url + source.name).digest('hex')
        };
        
        // Send to Quarantine via HMAC
        try {
          const result = await sendToQuarantine(payload);
          if (result.status === 'quarantined') {
            totalSent++;
          } else {
            totalRejected++;
          }
        } catch (e) {
          console.error('[INTEL_WORKER] Failed to send to quarantine:', e.message);
          totalRejected++;
        }
        
        // Respectful delay
        await new Promise(r => setTimeout(r, 500));
      }
      
      console.log('[INTEL_WORKER] ' + source.name + ': collected=' + items.length);
      
      // Delay between sources
      await new Promise(r => setTimeout(r, 1500));
      
    } catch (err) {
      console.error('[INTEL_WORKER] Source ' + source.name + ' failed:', err.message);
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('[INTEL_WORKER] Pipeline complete in ' + elapsed + 's');
  console.log('[INTEL_WORKER] Collected=' + totalCollected + ' Sent=' + totalSent + ' Rejected=' + totalRejected);
  
  process.exit(0);
}

runPipeline().catch(err => {
  console.error('[INTEL_WORKER_FATAL]', err.message);
  process.exit(1);
});
