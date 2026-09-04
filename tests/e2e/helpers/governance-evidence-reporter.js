import { stat } from 'node:fs/promises';

const GOVERNANCE_REQUIREMENTS = Object.freeze({
  expectedTestCount: 6,
  meaningfulVideoNames: new Set([
    'owner-flow',
    'reviewer-flow',
    'takeover-flow',
    'writer-flow',
  ]),
  requiredScreenshotNames: Object.freeze([
    'focused-manage-access',
    'focused-owner-workspace',
    'focused-pending',
    'focused-proposal-conflicts',
    'focused-revoked',
  ]),
});

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

// Shared by every curated Evidence run. The requirements decide how many flows
// are expected, which videos count as meaningful, and which screenshots the run
// must produce; the rules themselves never differ between products.
export async function validateEvidenceResults(results = [], requirements = GOVERNANCE_REQUIREMENTS) {
  const { expectedTestCount, meaningfulVideoNames, requiredScreenshotNames } = requirements;
  const errors = [];
  const screenshotNames = [];
  let traceCount = 0;
  if (results.length !== expectedTestCount) {
    errors.push(`Expected ${expectedTestCount} evidence tests, received ${results.length}.`);
  }

  for (const result of results) {
    const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    const videos = attachments.filter((attachment) => attachment.contentType === 'video/webm');
    if (!videos.some((attachment) => meaningfulVideoNames.has(attachment.name))) {
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
  if (JSON.stringify(actualScreenshots) !== JSON.stringify([...requiredScreenshotNames])) {
    errors.push(`Expected focused PNG attachments ${requiredScreenshotNames.join(', ')}, received ${actualScreenshots.join(', ')}.`);
  }
  if (traceCount !== 0) {
    errors.push(`Expected 0 trace attachments, received ${traceCount}.`);
  }
  return errors;
}

export const validateGovernanceEvidenceResults = (results = []) => (
  validateEvidenceResults(results, GOVERNANCE_REQUIREMENTS)
);

export default class GovernanceEvidenceReporter {
  constructor() {
    this.results = new Map();
  }

  getRequirements() {
    return GOVERNANCE_REQUIREMENTS;
  }

  onTestEnd(test, result) {
    this.results.set(test.id, {
      attachments: result.attachments,
      id: test.id,
      title: test.titlePath().join(' › '),
    });
  }

  async onEnd(result) {
    const requirements = this.getRequirements();
    const errors = await validateEvidenceResults(Array.from(this.results.values()), requirements);
    if (errors.length > 0) {
      errors.forEach((error) => console.error(`[evidence] ${error}`));
      return { status: 'failed' };
    }
    const videoCount = Array.from(this.results.values()).reduce((count, testResult) => (
      count + testResult.attachments.filter((attachment) => attachment.contentType === 'video/webm').length
    ), 0);
    console.log(`[evidence] validated ${requirements.expectedTestCount} flows, ${requirements.requiredScreenshotNames.length} PNG, ${videoCount} meaningful WebM, 0 trace`);
    return { status: result.status };
  }

  printsToStdio() {
    return true;
  }
}
