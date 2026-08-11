import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse, sendResponse, textResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

function isSyncRequest(requestUrl, req) {
  return requestUrl.pathname === '/api/structurizr/sync' && req.method === 'POST';
}

function rewriteBasePath(body, contentType, basePath) {
  if (!basePath || !/(?:text\/(?:html|css)|javascript|ecmascript)/iu.test(contentType)) {
    return body;
  }

  return Buffer.from(body.toString('utf8').replace(
    /(["'`(=])\/(static|workspace|api\/workspace)(?=[/"'`?#)])/gu,
    `$1${basePath}/$2`,
  ));
}

export function createStructurizrApiHandler({ basePath = '', service = null } = {}) {
  async function handleRequest(req, res, requestUrl) {
    if (isSyncRequest(requestUrl, req)) {
      try {
        const body = await parseJsonBody(req);
        if (!body || typeof body.path !== 'string') {
          jsonResponse(req, res, 400, { error: 'Missing Structurizr workspace path' });
          return true;
        }

        if (!service?.isEnabled()) {
          jsonResponse(req, res, 503, { error: 'Structurizr renderer is not configured' });
          return true;
        }

        jsonResponse(req, res, 200, await service.sync({
          content: body.source,
          rootPath: body.path,
        }));
      } catch (error) {
        const statusCode = getRequestErrorStatusCode(error) || Number(error?.statusCode) || 502;
        if (statusCode >= 500) {
          console.error('[api] Failed to sync Structurizr workspace:', error.message);
        }
        jsonResponse(req, res, statusCode, {
          code: error?.requestCode,
          error: error instanceof Error ? error.message : 'Failed to sync Structurizr workspace',
        });
      }
      return true;
    }

    if (!service?.isProxyPath(requestUrl.pathname)) {
      return false;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      textResponse(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return true;
    }

    try {
      const response = await service.proxy(requestUrl, {
        headers: req.headers,
        method: req.method,
      });
      if (!response) {
        return false;
      }

      sendResponse(req, res, {
        body: rewriteBasePath(response.body, response.contentType, basePath),
        headers: {
          'Cache-Control': requestUrl.pathname.startsWith('/static/')
            ? 'public, max-age=31536000, immutable'
            : 'no-store',
          'Content-Type': response.contentType,
        },
        statusCode: response.statusCode,
      });
    } catch (error) {
      const statusCode = getRequestErrorStatusCode(error) || Number(error?.statusCode) || 502;
      console.error('[http] Failed to proxy Structurizr request:', error.message);
      textResponse(req, res, statusCode, error.message || 'Structurizr renderer unavailable');
    }

    return true;
  }

  handleRequest.requiresAuthorization = (requestUrl) => (
    Boolean(service?.isProxyPath(requestUrl.pathname))
    && !requestUrl.pathname.startsWith('/api/')
  );

  return handleRequest;
}
