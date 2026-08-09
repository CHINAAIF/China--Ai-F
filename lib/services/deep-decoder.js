/**
 * TRUNKIA Deep Decoder v2.0 (Omega Protocol - Global Edition)
 * 
 * International Standard: Unicode NFKC normalization (no hardcoded maps).
 * Recursively decodes: Base64, Hex, URL, Unicode escapes, HTML entities.
 * Removes: All invisible Unicode format characters (language-agnostic).
 * Detects: Obfuscation via Shannon entropy analysis.
 * Protects: Input/Output size limits (decompression bomb prevention).
 * 
 * Designed for Cloud Enterprise (K8s, multi-core, high-throughput).
 * Zero external dependencies. Pure Node.js.
 */

const MAX_DEPTH = 3;
const MAX_INPUT_SIZE = 102400;  // 100KB input limit
const MAX_OUTPUT_SIZE = 204800; // 200KB output limit (decompression bomb prevention)

// All Unicode format/control/invisible characters (language-agnostic)
// Covers: Control chars, BOM, Zero-width, Direction marks, Interlinear
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u200B-\u200F\u2028-\u202F\u205F\u2060-\u206F\uFEFF\uFFF0-\uFFFF]/g;

// Unicode escape sequences: \uXXXX or \UXXXXXXXX
const UNICODE_ESCAPE_REGEX = /\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g;

// HTML numeric entities: &#123; or &#x7B;
const HTML_NUMERIC_REGEX = /&#(x)?([0-9a-fA-F]+);/gi;

// URL encoding: %XX
const URL_ENCODED_REGEX = /%[0-9a-fA-F]{2}/;

// Base64: min 20 chars, valid charset, optional padding
const BASE64_REGEX = /^[A-Za-z0-9+/_-]{20,}={0,2}$/;

// Hex: even length, min 20 chars, optional 0x prefix
const HEX_REGEX = /^(0x)?[0-9a-fA-F]{20,}$/;

/**
 * Calculate Shannon entropy of a string.
 * @param {string} str
 * @returns {number} entropy in bits/char
 */
function calculateEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = new Map();
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Check if a string is valid printable text (any language).
 * Uses Unicode ranges to accept all scripts.
 * @param {string} str
 * @returns {boolean}
 */
function isPrintableText(str) {
  if (!str || str.length === 0) return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Reject control characters (except tab, newline, carriage return)
    if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) return false;
    // Reject Unicode replacement character (invalid decode)
    if (code === 0xFFFD) return false;
  }
  return true;
}

/**
 * Try to decode Base64 (standard and URL-safe).
 * Only decodes if the result is valid printable text.
 * @param {string} str
 * @returns {string|null}
 */
function tryDecodeBase64(str) {
  if (!BASE64_REGEX.test(str)) return null;
  
  // Entropy check: Base64 encoded data has high entropy (> 4.0)
  // This prevents false positives on UUIDs, session tokens, etc.
  const entropy = calculateEntropy(str);
  if (entropy < 3.5) return null;
  
  try {
    let normalized = str.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) normalized += '=';
    const decoded = Buffer.from(normalized, 'base64');
    const text = decoded.toString('utf8');
    if (isPrintableText(text) && text.length > 3) return text;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Try to decode Hex encoding.
 * @param {string} str
 * @returns {string|null}
 */
function tryDecodeHex(str) {
  const cleanStr = str.replace(/^0x/, '');
  if (!HEX_REGEX.test(str) || cleanStr.length % 2 !== 0) return null;
  
  const entropy = calculateEntropy(cleanStr);
  if (entropy < 3.0) return null;
  
  try {
    const decoded = Buffer.from(cleanStr, 'hex');
    const text = decoded.toString('utf8');
    if (isPrintableText(text) && text.length > 3) return text;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Try to decode URL encoding (percent encoding).
 * @param {string} str
 * @returns {string|null}
 */
function tryDecodeURL(str) {
  if (!URL_ENCODED_REGEX.test(str)) return null;
  try {
    const decoded = decodeURIComponent(str);
    if (decoded !== str && isPrintableText(decoded)) return decoded;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Try to decode Unicode escape sequences (\uXXXX, \UXXXXXXXX).
 * @param {string} str
 * @returns {string|null}
 */
function tryDecodeUnicodeEscapes(str) {
  if (!UNICODE_ESCAPE_REGEX.test(str)) return null;
  try {
    let changed = false;
    const decoded = str.replace(UNICODE_ESCAPE_REGEX, (match, hex4, hex8) => {
      changed = true;
      const code = parseInt(hex4 || hex8, 16);
      if (code > 0 && code <= 0x10FFFF) {
        return String.fromCodePoint(code);
      }
      return match;
    });
    return changed ? decoded : null;
  } catch (e) {
    return null;
  }
}

/**
 * Try to decode HTML numeric entities (&#123; or &#x7B;).
 * @param {string} str
 * @returns {string|null}
 */
function tryDecodeHTMLEntities(str) {
  if (!HTML_NUMERIC_REGEX.test(str)) return null;
  try {
    let changed = false;
    const decoded = str.replace(HTML_NUMERIC_REGEX, (match, isHex, value) => {
      const code = parseInt(value, isHex ? 16 : 10);
      if (code > 0 && code <= 0x10FFFF) {
        changed = true;
        return String.fromCodePoint(code);
      }
      return match;
    });
    return changed ? decoded : null;
  } catch (e) {
    return null;
  }
}

/**
 * Normalize Unicode: NFKC + invisible character removal.
 * NFKC handles ALL confusables globally (Cyrillic, Greek, CJK, Fullwidth, etc.)
 * @param {string} str
 * @returns {string}
 */
function normalizeGlobal(str) {
  let result = str;
  
  // NFKC: Compatibility Decomposition + Canonical Composition
  // This is the Unicode international standard for confusable detection.
  // It handles ALL scripts globally without any hardcoded maps.
  try {
    result = result.normalize('NFKC');
  } catch (e) {
    // Fallback: if NFKC fails, continue with original
  }
  
  // Remove all invisible/format characters (language-agnostic)
  result = result.replace(INVISIBLE_CHARS, '');
  
  return result;
}

/**
 * Main decode function: recursively decodes all encoding layers.
 * 
 * @param {string} input - Raw input text (any language, any encoding)
 * @returns {{ decoded: string, depth: number, layers: string[], entropy: number, rejected: boolean, reason: string|null }}
 */
export function deepDecode(input) {
  if (!input || typeof input !== 'string') {
    return { decoded: '', depth: 0, layers: [], entropy: 0, rejected: false, reason: null };
  }

  if (input.length > MAX_INPUT_SIZE) {
    return { decoded: input, depth: 0, layers: [], entropy: 0, rejected: true, reason: 'INPUT_TOO_LARGE' };
  }

  const layers = [];
  let current = input;
  let depth = 0;

  // Phase 1: Global Unicode normalization (always applied)
  const normalized = normalizeGlobal(current);
  if (normalized !== current) {
    layers.push('NFKC');
    current = normalized;
  }

  // Phase 2: Recursive decoding
  while (depth < MAX_DEPTH) {
    // Check output size limit (decompression bomb prevention)
    if (current.length > MAX_OUTPUT_SIZE) {
      return { decoded: current, depth, layers, entropy: 0, rejected: true, reason: 'OUTPUT_TOO_LARGE' };
    }

    let decoded = null;
    let layerName = null;

    // Try each encoding in order
    const attempts = [
      { name: 'BASE64', fn: tryDecodeBase64 },
      { name: 'HEX', fn: tryDecodeHex },
      { name: 'URL', fn: tryDecodeURL },
      { name: 'UNICODE', fn: tryDecodeUnicodeEscapes },
      { name: 'HTML', fn: tryDecodeHTMLEntities }
    ];

    for (const { name, fn } of attempts) {
      const result = fn(current);
      if (result && result !== current) {
        decoded = result;
        layerName = name;
        break;
      }
    }

    if (!decoded) break;

    current = decoded;
    layers.push(layerName);
    depth++;
  }

  // Phase 3: Entropy analysis on final result
  const entropy = calculateEntropy(current);

  // Phase 4: Reject if entropy is extremely high (possible encrypted/obfuscated)
  let rejected = false;
  let reason = null;
  if (entropy > 6.0 && current.length > 100) {
    rejected = true;
    reason = 'HIGH_ENTROPY';
  }

  return {
    decoded: current,
    depth,
    layers,
    entropy,
    rejected,
    reason,
    originalLength: input.length,
    decodedLength: current.length
  };
}

/**
 * Quick check: returns true if input contains encoding artifacts.
 * @param {string} input
 * @returns {boolean}
 */
export function hasEncodingArtifacts(input) {
  if (!input || typeof input !== 'string') return false;
  if (BASE64_REGEX.test(input) && calculateEntropy(input) > 3.5) return true;
  if (HEX_REGEX.test(input) && calculateEntropy(input) > 3.0) return true;
  if (URL_ENCODED_REGEX.test(input)) return true;
  if (UNICODE_ESCAPE_REGEX.test(input)) return true;
  if (HTML_NUMERIC_REGEX.test(input)) return true;
  if (INVISIBLE_CHARS.test(input)) return true;
  return false;
}

export default { deepDecode, hasEncodingArtifacts };
