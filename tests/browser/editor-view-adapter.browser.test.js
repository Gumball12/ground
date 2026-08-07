import { afterEach, describe, expect, it } from 'vitest';

import { EditorViewAdapter } from '../../src/client/infrastructure/editor-view-adapter.js';

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('EditorViewAdapter search', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reveals the first match while typing in find', async () => {
    document.body.innerHTML = `
      <style>
        #editor { height: 600px; overflow: hidden; }
        #editor .cm-editor { height: 100%; }
        #editor .cm-editor .cm-scroller { overflow: auto; }
      </style>
      <div id="editor"></div><span id="line-info"></span>
    `;
    const editorContainer = document.getElementById('editor');
    const adapter = new EditorViewAdapter({
      editorContainer,
      initialTheme: 'dark',
      lineInfoElement: document.getElementById('line-info'),
      lineWrappingEnabled: false,
    });

    const targetLineIndex = 299;
    const lines = Array.from({ length: 400 }, (_, index) => (
      index === targetLineIndex ? 'needle in a long PlantUML document' : `note over Foo: Filler line ${index + 1}`
    ));
    adapter.initializeProvisional({
      content: ['@startuml', ...lines, '@enduml'].join('\n'),
      filePath: 'diagram.puml',
    });
    await nextFrame();

    const scroller = adapter.getScrollContainer();
    adapter.runEditorCommand('openSearch');
    await nextFrame();

    const input = document.querySelector('.cm-search .cm-textfield');
    input.value = 'needle';
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'e' }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const selection = adapter.getState().selection.main;
    expect(adapter.getState().sliceDoc(selection.from, selection.to)).toBe('needle');
    expect(scroller.scrollTop).toBeGreaterThan(4000);
    adapter.destroy();
  });
});
