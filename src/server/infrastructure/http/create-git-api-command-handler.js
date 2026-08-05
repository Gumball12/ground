import { handleApiError, readRequestId } from './http-request-helpers.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';
import { createEmptyWorkspaceChange, hasWorkspaceMutation } from '../../../domain/workspace-change.js';

async function parseRequiredBody(req, res, fieldName) {
  const body = await parseJsonBody(req);
  if (!body?.[fieldName]) {
    jsonResponse(req, res, 400, { error: `Missing ${fieldName}` });
    return null;
  }

  return body;
}

async function applyWorkspaceMutationEffects({
  action,
  req,
  responsePayload,
  workspaceMutationCoordinator,
}) {
  const workspaceChange = responsePayload?.workspaceChange ?? createEmptyWorkspaceChange();
  responsePayload.workspaceChange = workspaceChange;

  if (!hasWorkspaceMutation(workspaceChange)) {
    return responsePayload;
  }

  await workspaceMutationCoordinator?.reconcileVaultChangeObservation?.({
    action,
    origin: 'git',
    requestId: readRequestId(req),
    sourceRef: responsePayload?.sourceRef ?? null,
    workspaceChange,
  });
  return responsePayload;
}

export function createGitApiCommandHandler({
  authService = null,
  gitService,
  workspaceMutationCoordinator = null,
}) {
  return async function handleGitApiCommand(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/git/stage' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          action: 'stage',
          req,
          responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
            () => gitService.stageFile(body.path),
          ),
          workspaceMutationCoordinator,
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to stage git file:', 'Failed to stage git file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/unstage' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          action: 'unstage',
          req,
          responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
            () => gitService.unstageFile(body.path),
          ),
          workspaceMutationCoordinator,
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to unstage git file:', 'Failed to unstage git file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/commit' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'message');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          action: 'commit',
          req,
          responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
            () => gitService.commitStaged({
              author: authService?.getAuthenticatedUser?.(req) ?? null,
              message: body.message,
            }),
          ),
          workspaceMutationCoordinator,
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to commit staged changes:', 'Failed to commit staged changes');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/push' && req.method === 'POST') {
      try {
        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          action: 'push',
          req,
          responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
            () => gitService.pushBranch(),
          ),
          workspaceMutationCoordinator,
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to push git branch:', 'Failed to push git branch');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/pull' && req.method === 'POST') {
      try {
        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          action: 'pull',
          req,
          responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
            () => gitService.pullBranch(),
          ),
          workspaceMutationCoordinator,
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to pull git branch:', 'Failed to pull git branch');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/reset-file' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          action: 'reset-file',
          req,
          responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
            () => gitService.resetFileToHead(body.path),
          ),
          workspaceMutationCoordinator,
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to reset git file:', 'Failed to reset git file');
      }
      return true;
    }

    return false;
  };
}
