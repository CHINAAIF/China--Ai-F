import fs from 'fs';
const f = 'agents/system/cognitive-drift-agent.js';
let c = fs.readFileSync(f, 'utf8');

// Replace the null baseline with a theoretical healthy baseline
c = c.replace("this.dynamicBaseline = null; // Fix #3: Dynamic, not hardcoded", "this.dynamicBaseline = 0.2; // Theoretical Healthy Baseline (High Diversity)");

// Remove the logic that sets baseline from potentially poisoned data
c = c.replace(
  `if (this.dynamicBaseline === null) {
        this.dynamicBaseline = analysis.stagnationScore;
        return { success: true, status: 'baseline_set', baseline: this.dynamicBaseline };
      }`,
  "// Baseline is fixed at theoretical health. No learning from potentially poisoned state."
);

fs.writeFileSync(f, c, 'utf8');
console.log('✅ Patched cognitive-drift-agent.js (Fixed Poisoned Baseline Flaw)');
