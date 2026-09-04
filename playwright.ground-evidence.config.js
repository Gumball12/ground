import { defineConfig } from '@playwright/test';

import defaultConfig from './playwright.config.js';

// The two API-only flows carry no participant footage, so the curated run skips
// them and records exactly one uninterrupted video per participant.
const NON_PARTICIPANT_FLOWS = /unknown document|oversized update/u;

export default defineConfig({
  ...defaultConfig,
  outputDir: 'test-results/ground-evidence',
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['./tests/e2e/helpers/ground-evidence-reporter.js'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/ground-evidence',
    }],
  ],
  use: {
    ...defaultConfig.use,
    headless: true,
    reducedMotion: 'reduce',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      grepInvert: NON_PARTICIPANT_FLOWS,
      name: 'ground-evidence',
      testMatch: /ground-hosted\.spec\.js/u,
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
