import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';

export function readRequestId(req) {
  const value = String(req.headers['x-collabmd-request-id'] || '').trim();
  return value ? value.slice(0, 120) : null;
}

export function handleApiError(req, res, error, logMessage, fallbackMessage) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    const payload = { error: error.message };
    if (typeof error?.requestCode === 'string') {
      payload.code = error.requestCode;
    }
    jsonResponse(req, res, statusCode, payload);
    return true;
  }

  console.error(logMessage, error.message);
  jsonResponse(req, res, 500, { error: fallbackMessage });
  return true;
}
