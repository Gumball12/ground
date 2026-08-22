import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canFormatDocument,
  formatDocumentText,
} from '../../src/client/domain/document-formatter.js';

test('formatDocumentText formats supported text files without claiming unsupported DSLs', async () => {
  assert.equal(await formatDocumentText('README.md', '# Title\n\ntext   here'), '# Title\n\ntext here\n');
  assert.equal(await formatDocumentText('view.base', 'views:\n - type: table'), 'views:\n  - type: table\n');
  assert.equal(await formatDocumentText('page.html', '<main><h1>Hello</h1></main>'), '<main><h1>Hello</h1></main>\n');
  assert.equal(
    await formatDocumentText('diagram.mmd', 'sequenceDiagram\nparticipant A\nA->>B: Hello'),
    'sequenceDiagram\n  participant A\n  A ->> B: Hello\n',
  );
  assert.equal(canFormatDocument('diagram.puml'), true);
  assert.equal(canFormatDocument('model.dsl'), false);
});

test('formatDocumentText indents PlantUML blocks while preserving opaque regions and line endings', async () => {
  const source = [
    '@startuml',
    '    actor A',
    'if (ready?) then (yes)',
    ':Run;   ',
    '  """',
    'keep multiline text unchanged',
    '"""',
    'else (no)',
    '  note right',
    'keep    this',
    'end note',
    ' !if %enabled()',
    'leave preprocessor content alone',
    '!endif',
    'package "Core" {',
    'component API',
    '}',
    'endif',
    'alt success',
    'A -> B',
    'else failure',
    'loop retry',
    'A -> B',
    'end',
    'end',
    '@enduml',
  ].join('\r\n');
  const expected = [
    '@startuml',
    '    actor A',
    'if (ready?) then (yes)',
    '  :Run;   ',
    '  """',
    'keep multiline text unchanged',
    '"""',
    'else (no)',
    '  note right',
    'keep    this',
    'end note',
    ' !if %enabled()',
    'leave preprocessor content alone',
    '!endif',
    '  package "Core" {',
    '    component API',
    '  }',
    'endif',
    'alt success',
    '  A -> B',
    'else failure',
    '  loop retry',
    '    A -> B',
    '  end',
    'end',
    '@enduml',
  ].join('\r\n');

  assert.equal(await formatDocumentText('diagram.puml', source), expected);
});

test('formatDocumentText rejects invalid Mermaid without rewriting it', async () => {
  await assert.rejects(
    formatDocumentText('diagram.mmd', 'flowchart TD\nA -->'),
    /Mermaid syntax is invalid/,
  );
});
