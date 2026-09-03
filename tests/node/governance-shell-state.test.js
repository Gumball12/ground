import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveGovernanceShellState } from '../../src/client/domain/governance-shell-state.js';

const cases = [
  {
    expected: { accessState: null, phase: 'loading' },
    input: { currentFilePath: 'README.md', requestedDocumentPath: 'README.md', snapshot: null },
  },
  {
    expected: { accessState: null, phase: 'error' },
    input: {
      currentFilePath: 'README.md',
      error: new Error('offline'),
      requestedDocumentPath: 'README.md',
      snapshot: null,
    },
  },
  {
    expected: { accessState: 'pending', phase: 'ready' },
    input: {
      currentFilePath: 'README.md',
      requestedDocumentPath: 'README.md',
      snapshot: { documentPath: 'README.md', state: 'pending' },
    },
  },
  {
    expected: { accessState: null, phase: 'loading' },
    input: {
      currentFilePath: 'README.md',
      requestedDocumentPath: 'README.md',
      snapshot: { documentPath: 'notes.md', state: 'active' },
    },
  },
];

test('deriveGovernanceShellState fails closed until the requested document snapshot is ready', () => {
  cases.forEach(({ expected, input }) => {
    assert.deepEqual(deriveGovernanceShellState(input), expected);
  });
});
