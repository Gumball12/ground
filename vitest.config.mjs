import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pre-optimize the collaboration dependencies. Discovering them mid-run makes
  // Vite reload the test module, which loads Yjs twice and breaks its
  // constructor checks, and vitest warns that the reload can cause flakiness.
  optimizeDeps: {
    include: ['@supabase/supabase-js', 'y-protocols/awareness', 'yjs'],
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [
        { browser: 'chromium' },
      ],
      provider: playwright(),
    },
    include: ['tests/browser/**/*.browser.test.js'],
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
