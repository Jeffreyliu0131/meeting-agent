import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: 'tests/results/e2e-report.json' }]],
  outputDir: 'tests/results/e2e-artifacts',
});
