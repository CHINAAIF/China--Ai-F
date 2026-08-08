import fs from 'fs';
const f = 'agents/base-agent.js';
let c = fs.readFileSync(f, 'utf8');

// Add the mandatory wrapping inside the constructor
c = c.replace(
  "this.anomalyScore = 0;\n  }",
  "this.anomalyScore = 0;\n\n    // AOP Wrapper: Enforce Apoptosis check on run() even if overridden by subclass\n    const originalRun = this.run.bind(this);\n    this.run = async (input = {}) => {\n      this._checkVitals();\n      return originalRun(input);\n    };\n  }"
);

fs.writeFileSync(f, c, 'utf8');
console.log('✅ Patched base-agent.js (Mandatory Apoptosis Wrapping)');
