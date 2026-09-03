import { GROUND_ERROR_STATUS } from '../../../domain/ground-hosted-contract.js';

export const GROUND_OPERATIONS = Object.freeze([
  'create_document', 'join_document', 'get_session', 'hydrate_document',
  'append_update', 'list_roles', 'list_participants', 'assign_role',
  'revoke_participant', 'recover_owner', 'resolve_proposal',
  'webmcp_read', 'webmcp_apply', 'webmcp_propose',
]);

const GROUND_ENDPOINT_PATH = '/api/ground';

const SAFE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'referrer-policy': 'no-referrer',
});

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  headers: SAFE_HEADERS,
  status,
});

const errorResponse = (code) => jsonResponse(GROUND_ERROR_STATUS[code], { code });

const readBearerToken = (request) => {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? (token ?? '').trim() : '';
};

const readJsonBody = async (request) => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.split(';')[0].trim().toLowerCase().startsWith('application/json')) {
    return undefined;
  }

  try {
    const body = await request.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body : undefined;
  } catch {
    return undefined;
  }
};

export const createGroundFetchHandler = ({
  allowedOrigins,
  authVerifier,
  publicConfig,
  service,
}) => {
  const allowed = new Set(allowedOrigins);

  const dispatch = async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== GROUND_ENDPOINT_PATH) {
      return errorResponse('GROUND_UNAVAILABLE');
    }

    if (request.method === 'GET') {
      return url.searchParams.get('operation') === 'config'
        ? jsonResponse(200, publicConfig)
        : errorResponse('GROUND_INVALID_REQUEST');
    }

    if (request.method !== 'POST') {
      return errorResponse('GROUND_INVALID_REQUEST');
    }

    if (!allowed.has(request.headers.get('origin') ?? '')) {
      return errorResponse('GROUND_FORBIDDEN');
    }

    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse('GROUND_INVALID_REQUEST');
    }

    const bearerToken = readBearerToken(request);
    if (!bearerToken) {
      return errorResponse('GROUND_UNAUTHENTICATED');
    }

    const { operation, ...input } = body;
    if (!GROUND_OPERATIONS.includes(operation) || typeof service[operation] !== 'function') {
      return errorResponse('GROUND_INVALID_REQUEST');
    }

    const { userId } = await authVerifier.verify(bearerToken);
    return jsonResponse(200, await service[operation]({ actorId: userId, ...input }));
  };

  return {
    fetch: async (request) => {
      try {
        return await dispatch(request);
      } catch (error) {
        const code = GROUND_ERROR_STATUS[error?.code] ? error.code : 'GROUND_TEMPORARILY_UNAVAILABLE';
        return errorResponse(code);
      }
    },
  };
};
