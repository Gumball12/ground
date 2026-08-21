import { resolveAppUrl } from '../infrastructure/runtime-config.js';

const EXPORT_PAGE_SOURCE = 'collabmd-export-page';
const EXPORT_HOST_SOURCE = 'collabmd-export-host';
const EXPORT_JOB_CLOSE_POLL_MS = 500;
const EXPORT_JOB_TIMEOUT_MS = 60_000;
const pendingJobs = new Map();
let exportBridgeErrorHandler = null;

function createJobId() {
  return `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeFormat(format) {
  return ['html', 'pdf'].includes(format) ? format : 'docx';
}

function buildExportUrl({ filePath, format, jobId }) {
  const url = new URL(resolveAppUrl('/export-document.html'), window.location.origin);
  url.searchParams.set('action', normalizeFormat(format));
  url.searchParams.set('job', jobId);
  if (filePath) {
    url.searchParams.set('file', filePath);
  }
  return url.toString();
}

function createBootstrapPayload({
  fileList = [],
  filePath,
  format,
  jobId,
  markdownText = '',
  title = '',
}) {
  return {
    action: normalizeFormat(format),
    fileList: Array.isArray(fileList) ? fileList.slice() : [],
    filePath: String(filePath ?? ''),
    jobId,
    markdownText: String(markdownText ?? ''),
    source: EXPORT_HOST_SOURCE,
    title: String(title ?? ''),
    type: 'bootstrap',
  };
}

function clearPendingJobTimers(pendingJob) {
  if (!pendingJob) {
    return;
  }

  if (pendingJob.closePollId) {
    window.clearInterval(pendingJob.closePollId);
  }

  if (pendingJob.timeoutId) {
    window.clearTimeout(pendingJob.timeoutId);
  }
}

function finishPendingJob(jobId, {
  notifyError = false,
  message = '',
} = {}) {
  const pendingJob = pendingJobs.get(jobId);
  if (!pendingJob) {
    return;
  }

  clearPendingJobTimers(pendingJob);
  pendingJobs.delete(jobId);

  if (notifyError && message) {
    exportBridgeErrorHandler?.(message);
  }
}

export function initializeExportBridge({
  onError = null,
} = {}) {
  exportBridgeErrorHandler = typeof onError === 'function' ? onError : null;

  if (window.__collabmdExportBridgeInitialized) {
    return;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.source !== EXPORT_PAGE_SOURCE) {
      return;
    }

    const jobId = String(payload.jobId ?? '').trim();
    if (!jobId) {
      return;
    }

    const pendingJob = pendingJobs.get(jobId);
    if (!pendingJob) {
      return;
    }

    if (payload.type === 'ready') {
      if (pendingJob.window?.closed) {
        finishPendingJob(jobId, {
          message: 'Export window was closed before the export completed',
          notifyError: true,
        });
        return;
      }

      try {
        pendingJob.window?.postMessage(pendingJob.payload, window.location.origin);
      } catch (error) {
        finishPendingJob(jobId, {
          message: error instanceof Error ? error.message : 'Failed to send export data',
          notifyError: true,
        });
      }
      return;
    }

    if (payload.type === 'complete' || payload.type === 'error') {
      finishPendingJob(jobId, {
        message: payload.type === 'error' && payload.message ? String(payload.message) : '',
        notifyError: payload.type === 'error' && Boolean(payload.message),
      });
    }
  });

  window.__collabmdExportBridgeInitialized = true;
}

export async function exportDocument({
  fileList = [],
  filePath,
  format,
  markdownText = '',
  title = '',
} = {}) {
  const normalizedFilePath = String(filePath ?? '').trim();
  if (!normalizedFilePath) {
    throw new Error('No markdown note is open');
  }

  const jobId = createJobId();
  const url = buildExportUrl({
    filePath: normalizedFilePath,
    format,
    jobId,
  });

  const exportWindow = window.open(url, '_blank');
  if (!exportWindow) {
    throw new Error('Export popup was blocked');
  }

  pendingJobs.set(jobId, {
    closePollId: window.setInterval(() => {
      if (!exportWindow.closed) {
        return;
      }

      finishPendingJob(jobId, {
        message: 'Export window was closed before the export completed',
        notifyError: true,
      });
    }, EXPORT_JOB_CLOSE_POLL_MS),
    payload: createBootstrapPayload({
      fileList,
      filePath: normalizedFilePath,
      format,
      jobId,
      markdownText,
      title,
    }),
    timeoutId: window.setTimeout(() => {
      finishPendingJob(jobId, {
        message: 'Export timed out before it completed',
        notifyError: true,
      });
    }, EXPORT_JOB_TIMEOUT_MS),
    window: exportWindow,
  });

  exportWindow.focus?.();
  return jobId;
}
