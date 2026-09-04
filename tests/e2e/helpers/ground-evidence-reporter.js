import GovernanceEvidenceReporter from './governance-evidence-reporter.js';

// The curated Ground run records one uninterrupted video per participant and
// exactly these screenshots. Any extra or missing PNG fails the run.
const REQUIRED_GROUND_SCREENSHOTS = Object.freeze([
  'ground-concurrent-edit',
  'ground-manage-access',
  'ground-owner-document',
  'ground-pending',
  'ground-proposal-conflicts',
  'ground-recovered-owner',
  'ground-revoked',
]);

const MEANINGFUL_GROUND_VIDEOS = Object.freeze([
  'editor-flow',
  'owner-flow',
  'recovery-flow',
  'reviewer-flow',
]);

export default class GroundEvidenceReporter extends GovernanceEvidenceReporter {
  getRequirements() {
    return {
      expectedTestCount: 7,
      meaningfulVideoNames: new Set(MEANINGFUL_GROUND_VIDEOS),
      requiredScreenshotNames: REQUIRED_GROUND_SCREENSHOTS,
    };
  }
}
