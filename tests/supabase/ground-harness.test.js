import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnonymousClient } from './ground-supabase-fixture.js';

test('creates an anonymous local Supabase session', async () => {
  const { session, userId } = await createAnonymousClient();
  assert.ok(session.access_token);
  assert.equal(session.user.id, userId);
});
