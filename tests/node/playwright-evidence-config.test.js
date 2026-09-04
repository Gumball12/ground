import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import defaultConfig from '../../playwright.config.js';
import evidenceConfig from '../../playwright.evidence.config.js';
import groundEvidenceConfig from '../../playwright.ground-evidence.config.js';
import {
  validateEvidenceResults,
  validateGovernanceEvidenceResults,
} from '../e2e/helpers/governance-evidence-reporter.js';
import GroundEvidenceReporter from '../e2e/helpers/ground-evidence-reporter.js';

const evidencePngNames = [
  'focused-owner-workspace',
  'focused-manage-access',
  'focused-proposal-conflicts',
  'focused-pending',
  'focused-revoked',
];

test('Playwright Evidence isolates six focused governance flows and safe artifacts', () => {
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
  assert.equal(evidenceConfig.use.video, 'off');
  assert.deepEqual(evidenceConfig.reporter, [
    ['list'],
    ['./tests/e2e/helpers/governance-evidence-reporter.js'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/evidence',
    }],
  ]);
});

test('Governance Evidence requires a meaningful non-empty video for every flow and exactly five safe PNGs', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-evidence-reporter-'));
  try {
    const attachmentsDirectory = join(tempRoot, 'attachments');
    await mkdir(attachmentsDirectory);
    const results = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const videoPath = join(attachmentsDirectory, `owner-flow-${index}.webm`);
      await writeFile(videoPath, `video-${index}`);
      return {
        attachments: [{
          contentType: 'video/webm',
          name: 'owner-flow',
          path: videoPath,
        }],
        id: `flow-${index}`,
        title: `Flow ${index + 1}`,
      };
    }));
    for (const [index, name] of evidencePngNames.entries()) {
      const screenshotPath = join(attachmentsDirectory, `${name}.png`);
      await writeFile(screenshotPath, `png-${index}`);
      results[index].attachments.push({
        contentType: 'image/png',
        name,
        path: screenshotPath,
      });
    }

    assert.deepEqual(await validateGovernanceEvidenceResults(results), []);

    const firstVideo = results[0].attachments[0];
    await writeFile(firstVideo.path, '');
    assert.match(
      (await validateGovernanceEvidenceResults(results)).join('\n'),
      /Flow 1 attachment owner-flow is empty/u,
    );
    await writeFile(firstVideo.path, 'video-0');

    const revokedScreenshot = results[4].attachments.pop();
    assert.match(
      (await validateGovernanceEvidenceResults(results)).join('\n'),
      /Expected focused PNG attachments/u,
    );
    results[4].attachments.push(revokedScreenshot);

    const lastVideo = results[5].attachments[0];
    results[5].attachments = [];
    assert.match(
      (await validateGovernanceEvidenceResults(results)).join('\n'),
      /Flow 6 must attach at least one meaningful video/u,
    );
    const tracePath = join(attachmentsDirectory, 'trace.zip');
    await writeFile(tracePath, 'trace');
    results[5].attachments = [lastVideo, {
      contentType: 'application/zip',
      name: 'trace',
      path: tracePath,
    }];
    assert.match(
      (await validateGovernanceEvidenceResults(results)).join('\n'),
      /Expected 0 trace attachments, received 1/u,
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

const groundEvidencePngNames = [
  'ground-owner-document',
  'ground-pending',
  'ground-manage-access',
  'ground-concurrent-edit',
  'ground-proposal-conflicts',
  'ground-revoked',
  'ground-recovered-owner',
];

test('Ground Evidence isolates the participant flows and safe artifacts', () => {
  const [project] = groundEvidenceConfig.projects;

  assert.deepEqual(groundEvidenceConfig.projects.map(({ name }) => name), ['ground-evidence']);
  assert.equal(project.testMatch.test('ground-hosted.spec.js'), true);
  assert.equal(project.testMatch.test('governance.spec.js'), false);
  // The two API-only flows record no participant footage.
  assert.equal(
    project.grepInvert.test('an unknown document shows the status-only unavailable surface'),
    true,
  );
  assert.equal(
    project.grepInvert.test('an oversized update is refused and allocates no sequence'),
    true,
  );
  assert.equal(
    project.grepInvert.test('recovery makes a new browser the sole Owner and retires the used link'),
    false,
  );

  assert.equal(groundEvidenceConfig.outputDir, 'test-results/ground-evidence');
  assert.equal(groundEvidenceConfig.retries, 0);
  assert.equal(groundEvidenceConfig.workers, 1);
  assert.deepEqual(groundEvidenceConfig.use.viewport, { width: 1280, height: 720 });
  assert.equal(groundEvidenceConfig.use.reducedMotion, 'reduce');
  assert.equal(groundEvidenceConfig.use.screenshot, 'off');
  assert.equal(groundEvidenceConfig.use.trace, 'off');
  assert.equal(groundEvidenceConfig.use.video, 'off');
  assert.deepEqual(groundEvidenceConfig.reporter, [
    ['list'],
    ['./tests/e2e/helpers/ground-evidence-reporter.js'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/ground-evidence',
    }],
  ]);
});

test('the Ground reporter requires seven flows, seven PNGs, and per-participant video', () => {
  const requirements = new GroundEvidenceReporter().getRequirements();

  assert.equal(requirements.expectedTestCount, 7);
  assert.deepEqual(
    [...requirements.requiredScreenshotNames].toSorted(),
    groundEvidencePngNames.toSorted(),
  );
  assert.deepEqual(
    [...requirements.meaningfulVideoNames].toSorted(),
    ['editor-flow', 'owner-flow', 'recovery-flow', 'reviewer-flow'],
  );
});

test('Ground Evidence rejects a missing screenshot, a silent flow, and any trace', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'ground-evidence-reporter-'));
  const requirements = new GroundEvidenceReporter().getRequirements();
  try {
    const attachmentsDirectory = join(tempRoot, 'attachments');
    await mkdir(attachmentsDirectory);
    const results = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
      const videoPath = join(attachmentsDirectory, `owner-flow-${index}.webm`);
      await writeFile(videoPath, `video-${index}`);
      return {
        attachments: [{
          contentType: 'video/webm',
          name: 'owner-flow',
          path: videoPath,
        }],
        id: `ground-flow-${index}`,
        title: `Ground flow ${index + 1}`,
      };
    }));
    for (const [index, name] of groundEvidencePngNames.entries()) {
      const screenshotPath = join(attachmentsDirectory, `${name}.png`);
      await writeFile(screenshotPath, `png-${index}`);
      results[index].attachments.push({
        contentType: 'image/png',
        name,
        path: screenshotPath,
      });
    }

    assert.deepEqual(await validateEvidenceResults(results, requirements), []);

    const removed = results[6].attachments.pop();
    assert.match(
      (await validateEvidenceResults(results, requirements)).join('\n'),
      /Expected focused PNG attachments/u,
    );
    results[6].attachments.push(removed);

    const video = results[3].attachments[0];
    results[3].attachments = [];
    assert.match(
      (await validateEvidenceResults(results, requirements)).join('\n'),
      /Ground flow 4 must attach at least one meaningful video/u,
    );

    const tracePath = join(attachmentsDirectory, 'trace.zip');
    await writeFile(tracePath, 'trace');
    results[3].attachments = [video, {
      contentType: 'application/zip',
      name: 'trace',
      path: tracePath,
    }];
    assert.match(
      (await validateEvidenceResults(results, requirements)).join('\n'),
      /Expected 0 trace attachments, received 1/u,
    );

    assert.match(
      (await validateEvidenceResults(results.slice(0, 6), requirements)).join('\n'),
      /Expected 7 evidence tests, received 6/u,
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
