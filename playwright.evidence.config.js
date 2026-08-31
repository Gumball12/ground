import { defineConfig } from '@playwright/test';

import defaultConfig from './playwright.config.js';

export default defineConfig({
  ...defaultConfig,
  outputDir: 'test-results/evidence',
  reporter: [
    ['list'],
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
    video: 'on',
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
