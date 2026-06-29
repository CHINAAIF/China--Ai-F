import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var sj = fs.readFileSync(HOME + '/agents/utils/safe-json.js', 'utf8');

// Fix 1: detectTask - add Arabic terms
var oldDetect = "function detectTask(prompt) {\n  var p = prompt.toLowerCase();\n  if (p.includes('financ') || p.includes('invest') || p.includes('revenue'))  return 'financial';\n  if (p.includes('strateg') || p.includes('decision') || p.includes('plan'))  return 'strategic';";
var newDetect = "function detectTask(prompt) {\n  var p = prompt.toLowerCase();\n  if (p.includes('financ') || p.includes('invest') || p.includes('revenue') || p.includes('\\u0633\\u0639\\u0631') || p.includes('\\u0633\\u0647\\u0645') || p.includes('\\u062a\\u0633\\u0639\\u064a\\u0631') || p.includes('\\u062a\\u0643\\u0644\\u0641\\u0629') || p.includes('\\u0645\\u0627\\u0644\\u064a') || p.includes('\\u0628\\u0648\\u0631\\u0635\\u0629') || p.includes('price') || p.includes('stock') || p.includes('cost'))  return 'financial';\n  if (p.includes('strateg') || p.includes('decision') || p.includes('plan') || p.includes('\\u0627\\u0633\\u062a\\u0631\\u0627\\u062a\\u064a\\u062c') || p.includes('\\u062e\\u0637\\u0629') || p.includes('\\u0642\\u0631\\u0627\\u0631'))  return 'strategic';";

if (sj.includes(oldDetect)) {
  sj = sj.replace(oldDetect, newDetect);
  console.log('OK: detectTask patched with Arabic terms');
} else {
  console.log('WARN: detectTask pattern not found, trying alternate...');
  // Try replacing just the financial line
  var oldFin = "if (p.includes('financ') || p.includes('invest') || p.includes('revenue'))  return 'financial';";
  var newFin = "if (p.includes('financ') || p.includes('invest') || p.includes('revenue') || p.includes('\u0633\u0639\u0631') || p.includes('\u0633\u0647\u0645') || p.includes('\u062a\u0633\u0639\u064a\u0631') || p.includes('\u062a\u0643\u0644\u0641\u0629') || p.includes('\u0645\u0627\u0644\u064a') || p.includes('\u0628\u0648\u0631\u0635\u0629') || p.includes('price') || p.includes('stock') || p.includes('cost'))  return 'financial';";
  if (sj.includes(oldFin)) {
    sj = sj.replace(oldFin, newFin);
    console.log('OK: financial line patched');
  } else {
    console.log('ERROR: cannot find financial detection line');
    // Show what we have
    var idx = sj.indexOf('financ');
    if (idx > -1) console.log('Found at: ' + sj.substring(idx - 10, idx + 80));
  }

  var oldStrat = "if (p.includes('strateg') || p.includes('decision') || p.includes('plan'))  return 'strategic';";
  var newStrat = "if (p.includes('strateg') || p.includes('decision') || p.includes('plan') || p.includes('\u0627\u0633\u062a\u0631\u0627\u062a\u064a\u062c') || p.includes('\u062e\u0637\u0629') || p.includes('\u0642\u0631\u0627\u0631'))  return 'strategic';";
  if (sj.includes(oldStrat)) {
    sj = sj.replace(oldStrat, newStrat);
    console.log('OK: strategic line patched');
  }
}

// Fix 2: dual_verification - handle single model result better
var oldDual = "var adjustedConf = confidence;\n    if (avgAgreement >= 70 && agreements.length === 2) {\n      adjustedConf = Math.min(85, confidence + 25);\n    } else if (avgAgreement < 30) {\n      adjustedConf = Math.max(10, confidence - 15);\n    }";
var newDual = "var adjustedConf = confidence;\n    if (agreements.length === 2 && avgAgreement >= 70) {\n      adjustedConf = Math.min(85, confidence + 25);\n    } else if (agreements.length === 2 && avgAgreement < 30) {\n      adjustedConf = Math.max(10, confidence - 15);\n    } else if (agreements.length === 1) {\n      adjustedConf = Math.min(80, confidence + 10);\n    }";

if (sj.includes(oldDual)) {
  sj = sj.replace(oldDual, newDual);
  console.log('OK: dual_verification single-model handling patched');
} else {
  console.log('WARN: dual verification pattern not found');
}

fs.writeFileSync(HOME + '/agents/utils/safe-json.js', sj, 'utf8');
console.log('Done');
