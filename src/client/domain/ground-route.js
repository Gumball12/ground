import { isGroundDocumentId } from '../../domain/ground-hosted-contract.js';

const LANDING = Object.freeze({ type: 'landing' });
const UNAVAILABLE = Object.freeze({ type: 'unavailable' });

// Ground serves exactly two routes: the landing page and one canonical document
// segment. The document identifier alphabet excludes `%`, so a percent-encoded
// path can never resolve; Ground never decodes a path to make one match.
export const parseGroundRoute = (pathname) => {
  if (typeof pathname !== 'string') {
    return UNAVAILABLE;
  }
  if (pathname === '' || pathname === '/') {
    return LANDING;
  }
  if (!pathname.startsWith('/')) {
    return UNAVAILABLE;
  }

  const segment = (pathname.endsWith('/') ? pathname.slice(0, -1) : pathname).slice(1);
  return isGroundDocumentId(segment)
    ? { docId: segment, type: 'document' }
    : UNAVAILABLE;
};
