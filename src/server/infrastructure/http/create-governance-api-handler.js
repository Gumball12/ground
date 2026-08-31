import { GOVERNANCE_CAPABILITIES } from '../../../domain/governance-contract.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

const GRANTS_PREFIX = '/api/governance/grants/';

const credentialFrom = (request) => (
  request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice('Bearer '.length)
    : ''
);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const readParticipantSessionId = (pathname) => {
  const encodedId = pathname.slice(GRANTS_PREFIX.length);
  if (!encodedId || encodedId.includes('/')) {
    return '';
  }

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return '';
  }
};

function snapshotForCredential(registry, credential) {
  const snapshot = registry.getSnapshot(credential);
  return snapshot === undefined ? null : snapshot;
}

function sendRegistryError(request, response, error) {
  if (error instanceof TypeError && error.message === 'Owner credential required.') {
    jsonResponse(request, response, 403, { error: 'Owner role required' });
    return;
  }

  if (error instanceof RangeError && error.message === 'Unknown participant session.') {
    jsonResponse(request, response, 404, { error: error.message });
    return;
  }

  jsonResponse(request, response, 400, { error: error.message || 'Invalid governance request' });
}

export function createGovernanceApiHandler({ manifest, registry }) {
  const requireCredential = (request, response) => {
    const credential = credentialFrom(request);
    const snapshot = snapshotForCredential(registry, credential);
    if (snapshot === null) {
      jsonResponse(request, response, 401, { error: 'Invalid governance credential' });
      return null;
    }

    return { credential, snapshot };
  };

  const exactRoutes = new Map([
    ['POST /api/governance/session', async ({ request, response }) => {
      const body = await parseJsonBody(request);
      if (!isNonEmptyString(body?.documentPath) || !isNonEmptyString(body?.displayName) || !isNonEmptyString(body?.kind)) {
        jsonResponse(request, response, 400, { error: 'documentPath, displayName, and kind are required' });
        return;
      }

      const session = registry.createSession({
        displayName: body.displayName.trim(),
        documentPath: body.documentPath.trim(),
        kind: body.kind.trim(),
      });
      jsonResponse(request, response, 201, {
        credential: session.credential,
        ...registry.getSnapshot(session.credential),
      });
    }],
    ['GET /api/governance/session', async ({ request, response }) => {
      const session = requireCredential(request, response);
      if (session) {
        jsonResponse(request, response, 200, session.snapshot);
      }
    }],
    ['GET /api/governance/roles', async ({ request, response }) => {
      if (requireCredential(request, response)) {
        jsonResponse(request, response, 200, { roles: manifest.roles });
      }
    }],
    ['POST /api/governance/authorize', async ({ request, response }) => {
      const session = requireCredential(request, response);
      if (!session) {
        return;
      }

      const body = await parseJsonBody(request);
      if (!isNonEmptyString(body?.documentPath) || !GOVERNANCE_CAPABILITIES.includes(body?.capability)) {
        jsonResponse(request, response, 400, { error: 'Valid documentPath and capability are required' });
        return;
      }

      jsonResponse(request, response, 200, registry.authorize(session.credential, {
        capability: body.capability,
        documentPath: body.documentPath,
      }));
    }],
  ]);

  const prefixRoutes = [
    {
      method: 'PUT',
      handle: async ({ request, requestUrl, response }) => {
        const session = requireCredential(request, response);
        if (!session) {
          return;
        }

        const body = await parseJsonBody(request);
        const participantSessionId = readParticipantSessionId(requestUrl.pathname);
        if (!participantSessionId || !Object.hasOwn(manifest.roles, body?.roleId) || body.roleId === 'owner'
          || (body.expiresInMinutes !== undefined && (!Number.isInteger(body.expiresInMinutes)
            || body.expiresInMinutes < 1 || body.expiresInMinutes > 1440))) {
          jsonResponse(request, response, 400, { error: 'Invalid role grant' });
          return;
        }

        try {
          jsonResponse(request, response, 200, registry.assignRole(session.credential, {
            expiresInMinutes: body.expiresInMinutes,
            participantSessionId,
            roleId: body.roleId,
          }));
        } catch (error) {
          sendRegistryError(request, response, error);
        }
      },
      prefix: GRANTS_PREFIX,
    },
    {
      method: 'DELETE',
      handle: async ({ request, requestUrl, response }) => {
        const session = requireCredential(request, response);
        if (!session) {
          return;
        }

        const participantSessionId = readParticipantSessionId(requestUrl.pathname);
        if (!participantSessionId) {
          jsonResponse(request, response, 400, { error: 'participantSessionId is required' });
          return;
        }

        try {
          jsonResponse(request, response, 200, registry.revoke(session.credential, participantSessionId));
        } catch (error) {
          sendRegistryError(request, response, error);
        }
      },
      prefix: GRANTS_PREFIX,
    },
  ];

  return async function handleGovernanceApi(request, response, requestUrl) {
    if (!(requestUrl.pathname === '/api/governance' || requestUrl.pathname.startsWith('/api/governance/'))) {
      return false;
    }

    try {
      const exactRoute = exactRoutes.get(`${request.method} ${requestUrl.pathname}`);
      if (exactRoute) {
        await exactRoute({ request, response, requestUrl });
        return true;
      }

      const prefixRoute = prefixRoutes.find((route) => (
        request.method === route.method && requestUrl.pathname.startsWith(route.prefix)
      ));
      if (prefixRoute) {
        await prefixRoute.handle({ request, response, requestUrl });
        return true;
      }

      jsonResponse(request, response, 404, { error: 'Governance endpoint not found' });
      return true;
    } catch (error) {
      jsonResponse(request, response, error?.statusCode === 400 ? 400 : 500, {
        error: error?.statusCode === 400 ? error.message : 'Governance request failed',
      });
      return true;
    }
  };
}
