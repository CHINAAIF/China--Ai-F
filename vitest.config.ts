import { defineConfig } from 'vitest/config';

/**
 * TRUNKIA — Vitest Configuration (Vitest 4 API)
 * --------------------------------------------------------------
 * Design decisions:
 *  - environment: 'node' (pure Node.js backend, no DOM tests)
 *  - coverage: v8 provider (fastest, native V8 instrumentation)
 *  - thresholds: CONSERVATIVE STARTING POINT — current codebase has 4 tests
 *    covering ~57/5412 statements (1.05%). We set thresholds slightly below
 *    current coverage to prevent regression, NOT to enforce high coverage yet.
 *    Task #7 will add comprehensive tests and raise these thresholds.
 *
 *  Threshold evolution plan:
 *    Phase 1 (now):      1.0% / 0.8% / 1.0% / 0.6%  — prevent regression
 *    Phase 2 (Task #7):  30% / 25% / 30% / 20%        — basic coverage
 *    Phase 3 (future):   70% / 60% / 70% / 50%        — production-grade
 *
 *  - Scope: only include files that SHOULD be tested now. Excluding agents/
 *    (200+ agent files, mostly DB operations) keeps the scope meaningful.
 *  - testTimeout: 30s for DB-backed integration tests (Neon cold start)
 *  - fileParallelism: false — DB tests share a pool
 *  - reporters: default + junit + json (for CI artifacts)
 *  - passWithNoTests: false — CI MUST fail if no test files found
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs,ts}'],
    exclude: ['node_modules/**', 'dist/**', 'coverage/**'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    teardownTimeout: 10_000,
    fileParallelism: false,
    isolate: true,
    reporters: ['default', 'junit', 'json'],
    outputFile: {
      junit: 'test-results.junit.xml',
      json: 'test-results.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // Narrow scope: only files that have tests or should be tested in Phase 1
      include: [
        'config/**/*.js',
        'agents/governance/**/*.js',
      ],
      exclude: [
        'tests/**',
        'node_modules/**',
        'coverage/**',
        '**/*.test.js',
        '**/*.config.*',
        'agents/**/index.js',
      ],
      thresholds: {
        // Phase 1: prevent regression below current state
        lines: 1.0,
        functions: 0.8,
        branches: 0.6,
        statements: 1.0,
      },
      all: false,
    },
    silent: false,
    passWithNoTests: false,
  },
});
