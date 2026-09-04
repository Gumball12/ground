import { unlink } from 'node:fs/promises';

// Each curated Evidence configuration names its project `<product>-evidence`.
// Every other run leaves these helpers inert, so the ordinary regression suite
// keeps artifacts only on failure.
const EVIDENCE_PROJECTS = new Set(['governance-evidence', 'ground-evidence']);

export const isEvidenceRun = (testInfo) => EVIDENCE_PROJECTS.has(testInfo.project.name);

export const attachEvidenceScreenshot = async ({ name, page, testInfo }) => {
  if (!isEvidenceRun(testInfo)) {
    return;
  }

  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(name, {
    contentType: 'image/png',
    path: screenshotPath,
  });
  await unlink(screenshotPath);
};

export const withEvidenceVideo = (contextOptions, testInfo, name) => ({
  ...contextOptions,
  ...(isEvidenceRun(testInfo)
    ? { recordVideo: { dir: testInfo.outputPath(`${name}-source`), size: contextOptions.viewport } }
    : {}),
});

export const attachEvidenceVideo = async ({ name, testInfo, video }) => {
  if (!isEvidenceRun(testInfo) || !video) {
    return;
  }
  const videoPath = await video.path();
  await testInfo.attach(name, {
    contentType: 'video/webm',
    path: videoPath,
  });
  await unlink(videoPath);
};
