import { defineConfig } from 'vitest/config';

/**
 * TRUNKIA — Vitest Configuration (Vitest 4 API)
 * --------------------------------------------------------------
 * Design decisions:
 *  - environment: 'node' (pure Node.js backend, no DOM tests)
 *  - coverage: v8 provider (fastest, native V8 instrumentation)
 *  - thresholds: conservative starting point (50% lines/functions) —
 *    deliberately NOT 80% because most code is DB-integration logic
 *    not yet covered. We will raise this as we add tests in Task #7.
 *  - testTimeout: 30s for DB-backed integration tests (Neon cold start)
 *  - hookTimeout: 15s for setup/teardown that may create DB connections
 *  - fileParallelism: false — DB tests share a pool; avoid parallel connections
 *  - isolate: true — each test file gets fresh module registry
 *  - reporters: default (terminal) + junit (CI artifacts) + json (trend)
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
    fileParallelism: false,        // DB tests share a pool — run sequentially
    isolate: true,                 // fresh module registry per test file
    reporters: ['default', 'junit', 'json'],
    outputFile: {
      junit: 'test-results.junit.xml',
      json: 'test-results.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['agents/**/*.js', 'config/**/*.js', 'middleware/**/*.js', 'utils/**/*.js'],
      exclude: ['tests/**', 'node_modules/**', 'coverage/**', '**/*.test.js'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
      all: false,                  // only report files that are actually imported
    },
    silent: false,
    passWithNoTests: false,
  },
});
