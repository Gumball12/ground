import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserPreferencesPort } from '../../src/client/infrastructure/browser-preferences-port.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('BrowserPreferencesPort keeps recent files newest-first and bounded', () => {
  const storage = createStorage();
  const preferences = new BrowserPreferencesPort({ storage });

  preferences.recordRecentFile('first.md');
  preferences.recordRecentFile('second.md');
  preferences.recordRecentFile('first.md');

  assert.deepEqual(preferences.getRecentFiles(), ['first.md', 'second.md']);

  for (let index = 0; index < 25; index += 1) {
    preferences.recordRecentFile(`file-${index}.md`);
  }

  assert.equal(preferences.getRecentFiles().length, 20);
  assert.equal(preferences.getRecentFiles()[0], 'file-24.md');
});
