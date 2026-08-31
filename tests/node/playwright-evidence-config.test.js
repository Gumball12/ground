import test from 'node:test';
import assert from 'node:assert/strict';

import defaultConfig from '../../playwright.config.js';
import evidenceConfig from '../../playwright.evidence.config.js';

test('Playwright Evidence isolates four governance flows and safe artifacts', () => {
  assert.equal(defaultConfig.updateSnapshots, 'none');
  assert.deepEqual(
    evidenceConfig.projects.map((project) => project.name),
    ['governance-evidence'],
  );
  assert.equal(
    evidenceConfig.projects[0].testMatch.test('governance.spec.js'),
    true,
  );
  assert.equal(evidenceConfig.outputDir, 'test-results/evidence');
  assert.deepEqual(evidenceConfig.use.viewport, { width: 1280, height: 720 });
  assert.equal(evidenceConfig.use.reducedMotion, 'reduce');
  assert.equal(evidenceConfig.use.screenshot, 'off');
  assert.equal(evidenceConfig.use.trace, 'off');
  assert.equal(evidenceConfig.use.video, 'on');
  assert.deepEqual(evidenceConfig.reporter, [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/evidence',
    }],
  ]);
});
