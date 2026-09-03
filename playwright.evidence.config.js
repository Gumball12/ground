import { defineConfig } from '@playwright/test';

import defaultConfig from './playwright.config.js';

export default defineConfig({
  ...defaultConfig,
  outputDir: 'test-results/evidence',
  reporter: [
    ['list'],
    ['./tests/e2e/helpers/governance-evidence-reporter.js'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/evidence',
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
      name: 'governance-evidence',
      testMatch: /governance\.spec\.js/u,
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
