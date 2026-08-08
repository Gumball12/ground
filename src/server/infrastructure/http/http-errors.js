export function createRequestError(statusCode, message, { code = null, requestCode = null } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  if (requestCode) {
    error.requestCode = requestCode;
  }
  return error;
}

export function getRequestErrorStatusCode(error) {
  if (!Number.isInteger(error?.statusCode)) {
    return false;
  }

  return error.statusCode;
}
