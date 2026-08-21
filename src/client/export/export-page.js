import {
  postExportPageMessage,
  prepareExportSnapshot,
  runExportAdapter,
  waitForBootstrapPayload,
  waitForRenderedExportContent,
} from './export-pipeline.js';
import { groupHeadingWithFollowingBlock } from './export-print-layout.js';

function setStatus(message) {
  const status = document.getElementById('exportStatus');
  if (status) {
    status.textContent = message;
  }
}

function renderWarnings(snapshot) {
  const warningsList = document.getElementById('exportWarnings');
  const warningsSection = document.getElementById('exportWarningsSection');
  if (!warningsList || !warningsSection) {
    return;
  }

  warningsList.replaceChildren();
  const warnings = snapshot.warnings ?? [];
  warningsSection.hidden = warnings.length === 0;
  warnings.forEach((warning) => {
    const item = document.createElement('li');
    item.textContent = warning;
    warningsList.appendChild(item);
  });
}

function renderSnapshot(snapshot) {
  const mount = document.getElementById('exportContent');
  if (!mount) {
    return null;
  }

  document.title = `${snapshot.title} — Export`;
  mount.innerHTML = snapshot.html;
  groupHeadingWithFollowingBlock(mount);
  renderWarnings(snapshot);
  return mount;
}

async function bootstrap() {
  try {
    setStatus('Loading export content…');
    const payload = await waitForBootstrapPayload();
    const snapshot = await prepareExportSnapshot(payload);
    const mount = renderSnapshot(snapshot);
    snapshot.html = await waitForRenderedExportContent(mount);
    setStatus(payload.action === 'pdf'
      ? 'Opening print dialog…'
      : `Preparing ${payload.action.toUpperCase()} download…`);
    await runExportAdapter(snapshot, payload.action);
    setStatus(payload.action === 'pdf'
      ? 'Print dialog opened.'
      : `${payload.action.toUpperCase()} download started.`);
    postExportPageMessage('complete', { jobId: new URL(window.location.href).searchParams.get('job') || '' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed';
    setStatus(message);
    postExportPageMessage('error', {
      jobId: new URL(window.location.href).searchParams.get('job') || '',
      message,
    });
  }
}

void bootstrap();
