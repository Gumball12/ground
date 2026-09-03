import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGroundRoute } from '../../src/client/domain/ground-route.js';

const DOCUMENT_ID = 'AbCdEf0123456789_-xyZA';

test('parses the landing route', () => {
  assert.deepEqual(parseGroundRoute('/'), { type: 'landing' });
  assert.deepEqual(parseGroundRoute(''), { type: 'landing' });
});

test('parses a canonical 22-character document route', () => {
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID}`), {
    docId: DOCUMENT_ID,
    type: 'document',
  });
});

test('canonicalizes a single trailing slash on both routes', () => {
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID}/`), {
    docId: DOCUMENT_ID,
    type: 'document',
  });
  assert.deepEqual(parseGroundRoute('//'), { type: 'unavailable' });
});

test('rejects reserved and unknown single segments', () => {
  for (const pathname of ['/api', '/assets', '/health', '/ws', '/app-config.js', '/robots.txt']) {
    assert.deepEqual(parseGroundRoute(pathname), { type: 'unavailable' }, pathname);
  }
});

test('rejects an identifier of the wrong length or alphabet', () => {
  assert.deepEqual(parseGroundRoute('/too-short'), { type: 'unavailable' });
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID}A`), { type: 'unavailable' });
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID.slice(0, 21)}`), { type: 'unavailable' });
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID.slice(0, 21)}.`), { type: 'unavailable' });
});

test('rejects any route carrying a trailing segment', () => {
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID}/edit`), { type: 'unavailable' });
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID}//`), { type: 'unavailable' });
  assert.deepEqual(parseGroundRoute(`/documents/${DOCUMENT_ID}`), { type: 'unavailable' });
});

// A canonical Ground share link is built from URL-safe base64 characters only, so
// it never needs percent-encoding. Ground therefore refuses to decode a path
// instead of trusting that every proxy and rewrite layer decodes it identically.
test('refuses to decode a percent-encoded identifier', () => {
  assert.deepEqual(parseGroundRoute(`/${DOCUMENT_ID.slice(0, 21)}%41`), { type: 'unavailable' });
  assert.deepEqual(parseGroundRoute(`/${encodeURIComponent(`/${DOCUMENT_ID}`)}`), {
    type: 'unavailable',
  });
});

test('rejects a non-string or absolute-url pathname', () => {
  for (const pathname of [undefined, null, 42, {}, `https://ground.test/${DOCUMENT_ID}`]) {
    assert.deepEqual(parseGroundRoute(pathname), { type: 'unavailable' }, String(pathname));
  }
});
