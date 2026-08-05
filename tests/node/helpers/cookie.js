export function extractCookieHeader(setCookieHeader) {
  const rawValue = Array.isArray(setCookieHeader)
    ? setCookieHeader[0]
    : setCookieHeader;
  return String(rawValue || '').split(';')[0];
}
