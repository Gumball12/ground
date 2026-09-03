import { stat } from 'node:fs/promises';

const REQUIRED_SCREENSHOT_NAMES = [
  'focused-manage-access',
  'focused-owner-workspace',
  'focused-pending',
  'focused-proposal-conflicts',
  'focused-revoked',
];
const MEANINGFUL_VIDEO_NAMES = new Set([
  'owner-flow',
  'reviewer-flow',
  'takeover-flow',
  'writer-flow',
]);

const validateAttachmentFile = async (attachment, errors, title) => {
  if (!attachment.path) {
    errors.push(`${title} attachment ${attachment.name} has no path.`);
    return;
  }
  try {
    const metadata = await stat(attachment.path);
    if (metadata.size === 0) {
      errors.push(`${title} attachment ${attachment.name} is empty.`);
    }
  } catch {
    errors.push(`${title} attachment ${attachment.name} is missing.`);
  }
};

export async function validateGovernanceEvidenceResults(results = []) {
  const errors = [];
  const screenshotNames = [];
  let traceCount = 0;
  if (results.length !== 6) {
    errors.push(`Expected 6 governance tests, received ${results.length}.`);
  }

  for (const result of results) {
    const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    const videos = attachments.filter((attachment) => attachment.contentType === 'video/webm');
    if (!videos.some((attachment) => MEANINGFUL_VIDEO_NAMES.has(attachment.name))) {
      errors.push(`${result.title} must attach at least one meaningful video.`);
    }
    for (const attachment of attachments) {
      if (attachment.contentType === 'image/png') {
        screenshotNames.push(attachment.name);
      }
      if (attachment.contentType === 'application/zip' || attachment.path?.endsWith('.zip')) {
        traceCount += 1;
      }
      if (attachment.contentType === 'image/png' || attachment.contentType === 'video/webm') {
        await validateAttachmentFile(attachment, errors, result.title);
      }
    }
  }

  const actualScreenshots = screenshotNames.toSorted();
  if (JSON.stringify(actualScreenshots) !== JSON.stringify(REQUIRED_SCREENSHOT_NAMES)) {
    errors.push(`Expected focused PNG attachments ${REQUIRED_SCREENSHOT_NAMES.join(', ')}, received ${actualScreenshots.join(', ')}.`);
  }
  if (traceCount !== 0) {
    errors.push(`Expected 0 trace attachments, received ${traceCount}.`);
  }
  return errors;
}

export default class GovernanceEvidenceReporter {
  constructor() {
    this.results = new Map();
  }

  onTestEnd(test, result) {
    this.results.set(test.id, {
      attachments: result.attachments,
      id: test.id,
      title: test.titlePath().join(' › '),
    });
  }

  async onEnd(result) {
    const errors = await validateGovernanceEvidenceResults(Array.from(this.results.values()));
    if (errors.length > 0) {
      errors.forEach((error) => console.error(`[evidence] ${error}`));
      return { status: 'failed' };
    }
    const videoCount = Array.from(this.results.values()).reduce((count, testResult) => (
      count + testResult.attachments.filter((attachment) => attachment.contentType === 'video/webm').length
    ), 0);
    console.log(`[evidence] validated 6 flows, 5 PNG, ${videoCount} meaningful WebM, 0 trace`);
    return { status: result.status };
  }

  printsToStdio() {
    return true;
  }
}
