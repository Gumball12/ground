import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getVaultFileKind,
  isHtmlFilePath,
  isVaultFilePath,
  stripVaultFileExtension,
} from '../../src/domain/file-kind.js';

test('HTML files are supported vault files', () => {
  assert.equal(getVaultFileKind('reports/index.html'), 'html');
  assert.equal(getVaultFileKind('reports/legacy.HTM'), 'html');
  assert.equal(isHtmlFilePath('reports/index.html'), true);
  assert.equal(isVaultFilePath('reports/index.html'), true);
  assert.equal(stripVaultFileExtension('index.html'), 'index');
});
