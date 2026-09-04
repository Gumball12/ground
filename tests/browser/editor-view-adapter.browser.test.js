import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { EditorViewAdapter } from '../../src/client/infrastructure/editor-view-adapter.js';
import { EditorSession } from '../../src/client/infrastructure/editor-session.js';

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createGovernedAdapter({ canEdit = false, content = '- [ ] Original\n' } = {}) {
  document.body.innerHTML = '<div id="editor"></div>';
  const localEdits = [];
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  ytext.insert(0, content);
  const undoManager = new Y.UndoManager(ytext);
  const adapter = new EditorViewAdapter({
    canEdit: () => canEdit,
    editorContainer: document.getElementById('editor'),
    initialTheme: 'light',
    lineInfoElement: null,
    onLocalEdit: (action) => localEdits.push(action),
  });
  adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });

  return {
    adapter,
    destroy() {
      adapter.destroy();
      undoManager.destroy();
      ydoc.destroy();
    },
    localEdits,
    undoManager,
    ydoc,
    ytext,
  };
}

describe('EditorViewAdapter Vim mode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to insert editing and enables Vim mode only when opted in', () => {
    document.body.innerHTML = '<div id="editor"></div><span id="line-info"></span>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'dark',
      lineInfoElement: document.getElementById('line-info'),
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');

    adapter.initialize({
      awareness: null,
      filePath: 'README.md',
      undoManager: new Y.UndoManager(ytext),
      ytext,
    });

    expect(adapter.isVimModeEnabled()).toBe(false);
    expect(document.querySelector('.cm-vimMode')).toBeNull();

    expect(adapter.setVimMode(true)).toBe(true);
    expect(adapter.isVimModeEnabled()).toBe(true);
    expect(document.querySelector('.cm-vimMode')).not.toBeNull();

    expect(adapter.setVimMode(false)).toBe(false);
    expect(adapter.isVimModeEnabled()).toBe(false);
    expect(document.querySelector('.cm-vimMode')).toBeNull();

    adapter.destroy();
    ydoc.destroy();
  });
});

describe('EditorViewAdapter collaboration history', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('undoes only local edits through toolbar and keyboard commands', () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'light',
      lineInfoElement: null,
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });
    adapter.insertText('local');
    ydoc.transact(() => ytext.insert(ytext.length, '-remote'), { remote: true });

    expect(adapter.runEditorCommand('undo')).toBe(true);
    expect(adapter.getText()).toBe('-remote');
    expect(adapter.runEditorCommand('redo')).toBe(true);
    expect(adapter.getText()).toBe('local-remote');

    const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
      ? { metaKey: true }
      : { ctrlKey: true };
    adapter.editorView.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      ...modifier,
      bubbles: true,
      key: 'z',
    }));
    expect(adapter.getText()).toBe('-remote');

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });

  it('applies exact text replacements as one undoable collaborative edit', () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'light',
      lineInfoElement: null,
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, '# Title\n\nHello world\n');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });

    expect(adapter.applyTextReplacements([
      { newText: '# Updated', oldText: '# Title' },
      { newText: 'Hello agent', oldText: 'Hello world' },
    ])).toBe(2);
    expect(adapter.getText()).toBe('# Updated\n\nHello agent\n');
    expect(adapter.runEditorCommand('undo')).toBe(true);
    expect(adapter.getText()).toBe('# Title\n\nHello world\n');
    expect(() => adapter.applyTextReplacements([
      { newText: 'Greeting', oldText: 'Hello' },
      { newText: 'Message', oldText: 'Hello world' },
    ])).toThrow(/overlap/);
    adapter.replaceText('aaa');
    expect(() => adapter.applyTextReplacements([
      { newText: 'b', oldText: 'aa' },
    ])).toThrow(/not unique/);

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });
});

describe('EditorViewAdapter governance', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  for (const action of ['typing', 'plain-paste', 'toolbar-format', 'task-toggle']) {
    it(`rejects reviewer ${action} without emitting a local edit`, () => {
      const harness = createGovernedAdapter();
      const originalText = harness.adapter.getText();

      if (action === 'typing') {
        harness.adapter.editorView.dispatch({
          changes: { from: originalText.length, insert: 'typed' },
          userEvent: 'input.type',
        });
      } else if (action === 'plain-paste') {
        harness.adapter.editorView.dispatch({
          changes: { from: originalText.length, insert: 'pasted' },
          userEvent: 'input.paste',
        });
      } else if (action === 'toolbar-format') {
        harness.adapter.editorView.dispatch({ selection: { anchor: 6, head: 14 } });
        harness.adapter.applyMarkdownToolbarAction('bold');
      } else {
        harness.adapter.toggleTaskListItem(1);
      }

      expect(harness.adapter.getText()).toBe(originalText);
      expect(harness.ytext.toString()).toBe(originalText);
      expect(harness.localEdits).toEqual([]);
      harness.destroy();
    });
  }

  it('allows remote Yjs updates while the reviewer editor is read-only', () => {
    const harness = createGovernedAdapter();

    harness.ydoc.transact(() => {
      harness.ytext.insert(harness.ytext.length, 'remote');
    }, { remote: true });

    expect(harness.adapter.getText()).toBe('- [ ] Original\nremote');
    expect(harness.localEdits).toEqual([]);
    harness.destroy();
  });

  it('reconfigures editability and emits one discrete action from the origin page', () => {
    const harness = createGovernedAdapter();

    expect(harness.adapter.getState().readOnly).toBe(true);
    harness.adapter.setCanEdit(true);
    expect(harness.adapter.getState().readOnly).toBe(false);
    expect(harness.adapter.toggleTaskListItem(1)).toBe(true);

    expect(harness.adapter.getText()).toBe('- [x] Original\n');
    expect(harness.localEdits).toEqual(['task-toggle']);
    harness.destroy();
  });

  it('rechecks revoked Undo and Redo before touching personal history', () => {
    const harness = createGovernedAdapter({ canEdit: true, content: '' });
    harness.adapter.insertText('local');
    harness.adapter.setCanEdit(false);

    expect(harness.adapter.runEditorCommand('undo')).toBe(false);
    expect(harness.adapter.runEditorCommand('redo')).toBe(false);

    const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
      ? { metaKey: true }
      : { ctrlKey: true };
    harness.adapter.editorView.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      ...modifier,
      bubbles: true,
      key: 'z',
    }));

    expect(harness.adapter.getText()).toBe('local');
    expect(harness.localEdits[0]).toBe('toolbar-format');
    expect(harness.localEdits).not.toContain('undo');
    expect(harness.localEdits).not.toContain('redo');
    harness.destroy();
  });
});

describe('EditorViewAdapter document formatting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('formats the shared document as one undoable edit', async () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'light',
      lineInfoElement: null,
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, '# Title\n\ntext   here');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });

    expect(await adapter.formatDocument('README.md')).toBe('formatted');
    expect(adapter.getText()).toBe('# Title\n\ntext here\n');
    expect(adapter.runEditorCommand('undo')).toBe(true);
    expect(adapter.getText()).toBe('# Title\n\ntext   here');

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });
});

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

describe('EditorSession hosted transport', () => {
  const createHostedClient = (content) => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, content);
    const undoManager = new Y.UndoManager(ytext);
    return {
      awareness: null,
      commentThreads: ydoc.getArray('comments'),
      governanceActivity: ydoc.getArray('governanceActivity'),
      initialSyncComplete: true,
      localUser: { color: '#123456', name: 'Hosted' },
      provider: null,
      undoManager,
      ydoc,
      ytext,
      collectUsers: () => [],
      destroy() {
        undoManager.destroy();
        ydoc.destroy();
      },
      getLocalUser: () => ({ color: '#123456', name: 'Hosted' }),
      getText: () => ytext.toString(),
      hasUnsynchronizedLocalChanges: () => false,
      initialize: async () => ({
        awareness: null,
        commentThreads: ydoc.getArray('comments'),
        governanceActivity: ydoc.getArray('governanceActivity'),
        localUser: { color: '#123456', name: 'Hosted' },
        undoManager,
        ydoc,
        ytext,
      }),
      pauseForDisconnect: () => {},
      reconnect: () => {},
      setLocalViewport: () => null,
      waitForInitialSync: async () => {},
      waitForPendingUpdates: async () => {},
    };
  };

  const createSession = (client) => new EditorSession({
    canComment: false,
    canEdit: true,
    createCollaborationClient: () => client,
    editorContainer: document.getElementById('editor'),
    governed: true,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  it('mounts an injected hosted client and leaves no editor DOM or history after destroy', async () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const revoked = createHostedClient('Revoked draft');
    const session = createSession(revoked);
    await session.initialize('AbCdEf0123456789_-xyZA');
    await nextFrame();

    expect(document.querySelectorAll('#editor .cm-editor').length).toBe(1);
    expect(session.getText()).toBe('Revoked draft');

    session.destroy();

    expect(document.querySelectorAll('#editor .cm-editor').length).toBe(0);
    expect(document.getElementById('editor').textContent).toBe('');

    const rebuilt = createHostedClient('Server truth');
    const rebuiltSession = createSession(rebuilt);
    await rebuiltSession.initialize('AbCdEf0123456789_-xyZA');
    await nextFrame();

    expect(rebuiltSession.getText()).toBe('Server truth');
    expect(rebuilt.undoManager.undoStack.length).toBe(0);
    rebuiltSession.destroy();
  });
});
