import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { governanceFeature } from '../../src/client/application/app-shell/governance-feature.js';
import { uiFeatureTabActivityMethods } from '../../src/client/application/app-shell/ui-feature-tab-activity.js';
import { CollabMdAppShell } from '../../src/client/bootstrap/collabmd-app-shell.js';
import { createProposal } from '../../src/domain/governance-proposals.js';

const mountFocusedShell = () => {
  document.body.innerHTML = `
    <h1 id="activeFileName"></h1>
    <section id="participantBar" hidden>
      <button type="button" id="manageAccessBtn" hidden>Manage access</button>
    </section>
    <section id="governanceStatusPanel" hidden>
      <h2 data-governance-status-title></h2>
      <p data-governance-status-copy></p>
      <button type="button" data-governance-retry hidden>Retry</button>
    </section>
    <section id="editor-page" hidden>
      <a id="skipToEditor" href="#editorContainer"></a>
      <div id="editorContainer"></div>
    </section>
    <aside id="governanceRail" hidden>
      <div role="tablist">
        <button type="button" data-governance-tab="review">Review</button>
        <button type="button" data-governance-tab="activity">Activity</button>
        <button type="button" data-governance-tab="roles">Roles</button>
      </div>
      <section data-governance-panel="review"></section>
      <section data-governance-panel="activity"></section>
      <section data-governance-panel="roles"></section>
    </aside>
    <dialog id="manageAccessDialog">
      <div data-manage-access-list></div>
      <button type="button" data-manage-access-close>Close</button>
    </dialog>
    <dialog id="displayNameDialog">
      <form id="displayNameForm"><input id="displayNameInput"></form>
      <button id="displayNameCancel"></button>
    </dialog>
    <dialog id="tabLockOverlay"><button id="tabLockTakeoverBtn"></button></dialog>
    <div id="toastContainer"></div>
  `;
};

const ownerParticipant = Object.freeze({
  displayName: 'Mina',
  joinedAt: 1_000,
  kind: 'human',
  participantSessionId: 'owner-session',
  roleId: 'owner',
  state: 'active',
});

const pendingParticipant = Object.freeze({
  displayName: 'Writer',
  joinedAt: 2_000,
  kind: 'ai',
  participantSessionId: 'writer-session',
  roleId: undefined,
  state: 'pending',
});

const lifecycleSnapshot = (participants, current = ownerParticipant) => ({
  ...current,
  documentPath: 'README.md',
  participants,
});

const accessTransition = ({
  action = 'grant_assigned',
  id = 'access-writer-session-3',
  outcome = 'changed',
} = {}) => ({
  action,
  actor: {
    displayName: 'Authoritative Owner',
    kind: 'human',
    participantSessionId: 'authoritative-owner-session',
    roleId: 'owner',
  },
  createdAt: 3_000,
  id,
  outcome,
  source: 'access_management',
  target: 'writer-session',
});

const createGovernanceContext = ({ credential = '', snapshot = null } = {}) => {
  const context = {
    connectionState: { status: 'connected', unreachable: false },
    currentFilePath: 'README.md',
    elements: {},
    getGovernanceReviewGroups: () => [],
    governanceClient: { credential },
    governanceLoad: { documentPath: 'README.md', error: null, phase: 'ready' },
    governanceSnapshot: snapshot,
    governanceUi: { render: vi.fn() },
    toastController: { show: vi.fn() },
  };
  Object.assign(context, governanceFeature);
  context.governanceRequest = vi.fn(async () => ({ roles: {} }));
  return context;
};

const createGovernanceLifecycleContext = (snapshot, ydoc = new Y.Doc()) => {
  const context = createGovernanceContext({ credential: 'owner-credential', snapshot });
  const activity = ydoc.getArray('governanceActivity');
  context.session = {
    getGovernanceContext: () => ({ activity, ydoc }),
  };
  return { activity, context, ydoc };
};

const switchGovernanceSession = (context, {
  credential,
  documentPath,
  participantSessionId,
  roleId = 'editor',
}) => {
  context.currentFilePath = documentPath;
  context.governanceClient.credential = credential;
  context.governanceLoad = { documentPath, error: null, phase: 'ready' };
  context.governanceSnapshot = {
    capabilities: ['document.read'],
    documentPath,
    participantSessionId,
    participants: [],
    roleId,
    state: 'active',
  };
};

const startDeferredRolesSessionSwitch = () => {
  const context = createGovernanceContext({
    credential: 'credential-a',
    snapshot: lifecycleSnapshot([ownerParticipant]),
  });
  const sessionA = Promise.withResolvers();
  const sessionB = Promise.withResolvers();
  context.governanceRequest
    .mockReturnValueOnce(sessionA.promise)
    .mockReturnValueOnce(sessionB.promise);
  context.renderGovernanceUi();
  const requestA = context._governanceRolesPromise;
  switchGovernanceSession(context, {
    credential: 'credential-b',
    documentPath: 'notes.md',
    participantSessionId: 'session-b',
  });
  context.renderGovernanceUi();
  return {
    context,
    requestA,
    requestB: context._governanceRolesPromise,
    sessionA,
    sessionB,
  };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('focused app shell browser behavior', () => {
  it('keeps a non-visual WorkspaceSync document index for editor wiki links', () => {
    mountFocusedShell();
    const shell = new CollabMdAppShell();
    shell.workspaceSync.onTreeChange([
      { name: 'README.md', path: 'README.md', type: 'markdown' },
      {
        children: [
          { name: 'guide.md', path: 'docs/guide.md', type: 'markdown' },
        ],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      },
      { name: 'image.png', path: 'README.assets/image.png', type: 'image' },
    ]);

    expect(shell.workspaceCoordinator.getFileList()).toEqual(['README.md', 'docs/guide.md']);
    expect(shell.workspaceCoordinator.getVaultFileList()).toEqual([
      'README.md',
      'docs/guide.md',
      'README.assets/image.png',
    ]);
    expect(shell).not.toHaveProperty('fileExplorer');
    expect(document.querySelector('#fileTree')).toBeNull();
  });

  it('resumes the focused route after the initial WorkspaceSync index reset', async () => {
    mountFocusedShell();
    const shell = new CollabMdAppShell();
    shell.workspaceRouteController.handleHashChange = vi.fn(async () => {
      expect(shell.documentIndex.flatFiles).toContain('README.md');
    });

    shell.workspaceSync.onTreeChange([
      { name: 'README.md', path: 'README.md', type: 'markdown' },
    ], { reset: true });

    await vi.waitFor(() => expect(shell.workspaceRouteController.handleHashChange).toHaveBeenCalledOnce());
  });

  it('forces governance restoration before a previously inactive tab reopens its route', () => {
    const context = {
      hideTabLockOverlay: vi.fn(),
      isTabActive: false,
      promptForDisplayNameIfNeeded: vi.fn(),
      webMcpTools: { refresh: vi.fn() },
      workspaceRouteController: { handleHashChange: vi.fn() },
      workspaceSync: { connect: vi.fn(), provider: {} },
    };

    uiFeatureTabActivityMethods.handleTabActivated.call(context);

    expect(context.workspaceRouteController.handleHashChange).toHaveBeenCalledWith({
      forceGovernance: true,
    });
  });

  it('fails governance initialization closed while retaining the requested document for Retry', async () => {
    const error = new Error('offline');
    const context = {
      createTabActivityLock: vi.fn(),
      currentFilePath: 'README.md',
      getStoredUserName: () => 'Mina',
      governanceClient: {
        destroy: vi.fn(),
        restoreOrCreate: vi.fn(async () => {
          throw error;
        }),
      },
      governanceSnapshot: { documentPath: 'stale.md', state: 'active' },
      renderGovernanceUi: vi.fn(),
      runtimeConfig: { participantKind: 'human' },
      tabActivityLock: { destroy: vi.fn() },
      workspaceCoordinator: { cleanupSession: vi.fn() },
    };

    await uiFeatureTabActivityMethods.initializeGovernanceTabActivity.call(context, 'README.md');

    expect(context.governanceLoad).toEqual({
      documentPath: 'README.md',
      error,
      phase: 'error',
    });
    expect(context.governanceSnapshot).toBeNull();
    expect(context.workspaceCoordinator.cleanupSession).toHaveBeenCalledTimes(2);
    expect(context.renderGovernanceUi).toHaveBeenCalled();
  });

  it('marks governance ready before opening the active editor session', async () => {
    const snapshot = lifecycleSnapshot([ownerParticipant]);
    const nextTabLock = {
      initialize: vi.fn(),
      tryActivate: vi.fn(),
    };
    const context = {
      applyGovernanceSnapshotTransition: vi.fn(async () => {}),
      createTabActivityLock: vi.fn(() => nextTabLock),
      currentFilePath: 'README.md',
      getStoredUserName: () => 'Mina',
      governanceClient: {
        restoreOrCreate: vi.fn(async () => snapshot),
      },
      governanceSnapshot: null,
      renderGovernanceUi: vi.fn(),
      runtimeConfig: { participantKind: 'human' },
      tabActivityLock: { destroy: vi.fn() },
      workspaceCoordinator: { cleanupSession: vi.fn() },
    };

    await uiFeatureTabActivityMethods.initializeGovernanceTabActivity.call(context, 'README.md');

    expect(context.governanceLoad).toEqual({
      documentPath: 'README.md',
      error: null,
      phase: 'ready',
    });
    expect(context.applyGovernanceSnapshotTransition).toHaveBeenCalledWith(null, snapshot);
    expect(nextTabLock.initialize).toHaveBeenCalledOnce();
    expect(nextTabLock.tryActivate).toHaveBeenCalledOnce();
  });

  it('rechecks focused route membership before retrying governance', () => {
    mountFocusedShell();
    const shell = new CollabMdAppShell();
    shell.currentFilePath = 'README.md';
    shell.governanceLoad = {
      documentPath: 'README.md',
      error: new Error('offline'),
      phase: 'error',
    };
    shell.workspaceRouteController.handleHashChange = vi.fn();
    shell.initializeGovernanceTabActivity = vi.fn();

    shell.renderGovernanceUi();
    document.querySelector('[data-governance-retry]').click();

    expect(shell.workspaceRouteController.handleHashChange).toHaveBeenCalledWith({
      forceGovernance: true,
    });
    expect(shell.initializeGovernanceTabActivity).not.toHaveBeenCalled();
  });

  it('retains display-name onboarding with a direct local editor identity', () => {
    mountFocusedShell();
    const shell = new CollabMdAppShell();
    shell.elements.displayNameInput.value = '  Mina  ';
    const setPreference = vi.spyOn(shell.preferences, 'setUserName');

    shell.handleDisplayNameSubmit();

    expect(setPreference).toHaveBeenCalledWith('Mina');
    expect(shell.localUser.name).toBe('Mina');
    expect(shell.elements.displayNameDialog.open).toBe(false);
    expect(shell).not.toHaveProperty('lobby');
    expect(shell).not.toHaveProperty('chatIsOpen');
  });

  it('does not request Roles before the ready governance session and credential exist', () => {
    const context = createGovernanceContext();

    context.renderGovernanceUi();

    expect(context.governanceRequest).not.toHaveBeenCalled();
    expect(context.governanceUi.render).toHaveBeenCalledWith(expect.objectContaining({
      shellState: { accessState: null, phase: 'loading' },
    }));
  });

  it('does not request Owner Role metadata for a pending Access state', () => {
    const snapshot = {
      ...pendingParticipant,
      documentPath: 'README.md',
      participants: [ownerParticipant, pendingParticipant],
    };
    const context = createGovernanceContext({ credential: 'pending-credential', snapshot });

    context.renderGovernanceUi();

    expect(context.governanceRequest).not.toHaveBeenCalled();
  });

  it('loads Roles for the ready current session and rerenders the Owner surface', async () => {
    const snapshot = lifecycleSnapshot([ownerParticipant]);
    const context = createGovernanceContext({ credential: 'owner-credential', snapshot });
    context.governanceRequest = vi.fn(async () => ({
      roles: { owner: ['document.read', 'grant.manage'] },
    }));

    context.renderGovernanceUi();
    await context._governanceRolesPromise;

    expect(context.governanceRequest).toHaveBeenCalledWith('/api/governance/roles');
    expect(context.governanceRoles).toEqual({ owner: ['document.read', 'grant.manage'] });
    expect(context.governanceUi.render).toHaveBeenLastCalledWith(expect.objectContaining({
      roles: { owner: ['document.read', 'grant.manage'] },
      shellState: { accessState: 'active', phase: 'ready' },
    }));
  });

  it('makes a failed Roles request explicitly retryable for the same session', async () => {
    const context = createGovernanceContext({
      credential: 'owner-credential',
      snapshot: lifecycleSnapshot([ownerParticipant]),
    });
    context.governanceRequest
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ roles: { owner: ['document.read', 'grant.manage'] } });

    context.renderGovernanceUi();
    await context._governanceRolesPromise;

    expect(context.governanceRequest).toHaveBeenCalledTimes(1);

    context.renderGovernanceUi();
    expect(context.governanceRequest).toHaveBeenCalledTimes(1);

    const [message, toastOptions] = context.toastController.show.mock.calls[0];
    expect(message).toBe('Access controls could not be loaded.');
    expect(toastOptions).toEqual(expect.objectContaining({
      actionLabel: 'Retry',
      dismissible: true,
      duration: 0,
      tone: 'error',
    }));

    const oldSessionRetry = toastOptions.onAction;
    oldSessionRetry();
    await context._governanceRolesPromise;

    expect(context.governanceRequest).toHaveBeenCalledTimes(2);
    expect(context.governanceRoles).toEqual({ owner: ['document.read', 'grant.manage'] });
    expect(context.toastController.show).toHaveBeenCalledOnce();

    switchGovernanceSession(context, {
      credential: 'credential-b',
      documentPath: 'notes.md',
      participantSessionId: 'session-b',
    });
    context.governanceRequest.mockResolvedValueOnce({ roles: { editor: ['document.read'] } });
    context.renderGovernanceUi();
    await context._governanceRolesPromise;
    oldSessionRetry();

    expect(context.governanceRequest).toHaveBeenCalledTimes(3);
  });

  it('ignores a stale Roles success after a newer session loads', async () => {
    const fixture = startDeferredRolesSessionSwitch();
    fixture.sessionB.resolve({ roles: { editor: ['document.read'] } });
    await fixture.requestB;
    fixture.sessionA.resolve({ roles: { owner: ['document.read', 'grant.manage'] } });
    await fixture.requestA;

    expect(fixture.context.governanceRoles).toEqual({ editor: ['document.read'] });
    expect(fixture.context.governanceUi.render).toHaveBeenLastCalledWith(expect.objectContaining({
      roles: { editor: ['document.read'] },
      session: expect.objectContaining({ documentPath: 'notes.md' }),
    }));
  });

  it('ignores a stale Roles failure without contaminating a newer session', async () => {
    const fixture = startDeferredRolesSessionSwitch();
    fixture.sessionB.resolve({ roles: { editor: ['document.read'] } });
    await fixture.requestB;
    fixture.sessionA.reject(new Error('stale offline'));
    await fixture.requestA;

    expect(fixture.context.governanceRoles).toEqual({ editor: ['document.read'] });
    expect(fixture.context.toastController.show).not.toHaveBeenCalled();
    expect(fixture.context._governanceRolesAttemptedKey).toBe('notes.md::session-b');
  });
});

describe('focused governance lifecycle behavior', () => {
  it('records Participant joins once with the mandatory Activity source', () => {
    const snapshot = lifecycleSnapshot([ownerParticipant, pendingParticipant]);
    const { activity, context, ydoc } = createGovernanceLifecycleContext(snapshot);

    context.appendGovernanceLifecycleActivity(snapshot);
    context.appendGovernanceLifecycleActivity(snapshot);
    const reloaded = createGovernanceLifecycleContext(snapshot, ydoc);
    reloaded.context.appendGovernanceLifecycleActivity(snapshot);

    expect(activity.toArray()).toHaveLength(2);
    expect(activity.toArray()).toEqual([
      expect.objectContaining({ source: 'access_management', target: 'owner-session' }),
      expect.objectContaining({ source: 'access_management', target: 'writer-session' }),
    ]);
  });

  it('records each successful explicit Access command once and skips same-Role Activity', async () => {
    const snapshot = lifecycleSnapshot([ownerParticipant, pendingParticipant]);
    const { activity, context } = createGovernanceLifecycleContext(snapshot);
    const editor = { ...pendingParticipant, roleId: 'editor', state: 'active' };
    const reviewer = { ...pendingParticipant, roleId: 'reviewer', state: 'active' };
    const revoked = { ...pendingParticipant, roleId: undefined, state: 'revoked' };
    const refreshedSnapshots = [
      lifecycleSnapshot([ownerParticipant, editor]),
      lifecycleSnapshot([ownerParticipant, reviewer]),
      lifecycleSnapshot([ownerParticipant, reviewer]),
      lifecycleSnapshot([ownerParticipant, revoked]),
    ];
    context.governanceClient.refresh = vi.fn(async () => {
      const next = refreshedSnapshots.shift();
      context.governanceSnapshot = next;
      return next;
    });
    context.governanceRequest = vi.fn()
      .mockResolvedValueOnce({ transition: accessTransition() })
      .mockResolvedValueOnce({
        transition: accessTransition({ action: 'grant_changed', id: 'access-writer-session-4' }),
      })
      .mockResolvedValueOnce({
        transition: accessTransition({ action: 'grant_changed', id: 'access-writer-session-4' }),
      })
      .mockResolvedValueOnce({
        transition: accessTransition({ action: 'grant_revoked', id: 'access-writer-session-5', outcome: 'revoked' }),
      });

    await context.assignGovernanceRole('writer-session', 'editor');
    await context.assignGovernanceRole('writer-session', 'reviewer');
    await context.assignGovernanceRole('writer-session', 'reviewer');
    await context.revokeGovernanceGrant('writer-session');

    expect(context.governanceRequest).toHaveBeenCalledWith(
      '/api/governance/grants/writer-session',
      expect.objectContaining({ body: JSON.stringify({ roleId: 'editor' }), method: 'PUT' }),
    );
    expect(activity.toArray().filter((record) => record.action.startsWith('grant_'))).toEqual([
      expect.objectContaining({
        action: 'grant_assigned',
        source: 'access_management',
        target: 'writer-session',
      }),
      expect.objectContaining({
        action: 'grant_changed',
        source: 'access_management',
        target: 'writer-session',
      }),
      expect.objectContaining({
        action: 'grant_revoked',
        source: 'access_management',
        target: 'writer-session',
      }),
    ]);
    expect(context.governanceClient.refresh).toHaveBeenCalledTimes(4);
  });

  it('does not append lifecycle Activity from a non-Owner client', () => {
    const writer = { ...pendingParticipant, roleId: 'editor', state: 'active' };
    const snapshot = lifecycleSnapshot([ownerParticipant, writer], writer);
    const { activity, context } = createGovernanceLifecycleContext(snapshot);

    context.appendGovernanceLifecycleActivity(snapshot);

    expect(activity).toHaveLength(0);
  });
});

describe('authoritative governance replay', () => {
  it('rerenders Review when the persisted Proposal array changes without a governance poll', () => {
    const ydoc = new Y.Doc();
    const governanceContext = {
      activity: ydoc.getArray('governanceActivity'),
      comments: ydoc.getArray('comments'),
      ydoc,
      ytext: ydoc.getText('codemirror'),
    };
    const context = createGovernanceContext({
      credential: 'owner-credential',
      snapshot: lifecycleSnapshot([ownerParticipant]),
    });
    context.renderGovernanceUi = vi.fn();

    context.bindGovernanceSession({ getGovernanceContext: () => governanceContext });
    context.renderGovernanceUi.mockClear();
    governanceContext.comments.push([new Y.Map()]);

    expect(context.renderGovernanceUi).toHaveBeenCalledOnce();
  });

  it('binds Proposal observers after editor initialization creates the Yjs context', () => {
    mountFocusedShell();
    const shell = new CollabMdAppShell();
    const ydoc = new Y.Doc();
    const governanceContext = {
      activity: ydoc.getArray('governanceActivity'),
      comments: ydoc.getArray('comments'),
      ydoc,
      ytext: ydoc.getText('codemirror'),
    };
    let initializedContext = null;
    const session = { getGovernanceContext: () => initializedContext };
    shell.renderGovernanceUi = vi.fn();

    shell.workspaceCoordinator.onSessionAssigned(session);
    initializedContext = governanceContext;
    shell.workspaceCoordinator.onFileOpenReady(session);
    shell.renderGovernanceUi.mockClear();
    governanceContext.comments.push([new Y.Map()]);

    expect(shell.renderGovernanceUi).toHaveBeenCalledOnce();
  });

  it('routes a retryable GovernanceClient transition through one fail-closed writer', async () => {
    mountFocusedShell();
    const shell = new CollabMdAppShell();
    const snapshot = {
      ...lifecycleSnapshot([ownerParticipant]),
      capabilities: ['document.read', 'document.edit'],
      version: 1,
    };
    shell.currentFilePath = 'README.md';
    shell.governanceLoad = { documentPath: 'README.md', error: null, phase: 'ready' };
    shell.governanceSnapshot = snapshot;
    shell.governanceClient.credential = 'owner-credential';
    shell.governanceClient.currentVersion = 1;
    shell.governanceClient.documentPath = 'README.md';
    shell.governanceClient.snapshot = snapshot;
    shell.governanceClient.fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: 'Temporary failure' }),
      { status: 503 },
    ));
    shell.applyGovernanceSnapshotTransition = vi.fn(async () => {});

    await expect(shell.governanceClient.refresh())
      .rejects.toMatchObject({ code: 'GOVERNANCE_RETRYABLE' });

    expect(shell.applyGovernanceSnapshotTransition).toHaveBeenCalledOnce();
    expect(shell.applyGovernanceSnapshotTransition).toHaveBeenCalledWith(
      snapshot,
      expect.objectContaining({
        capabilities: [],
        documentPath: 'README.md',
        state: 'retryable-error',
      }),
    );
    expect(shell.governanceLoad.phase).toBe('error');
    expect(shell.governanceSnapshot).toBeNull();
    shell.governanceClient.destroy();
  });

  it('deduplicates an Access transition after real Yjs replay and refresh retry', async () => {
    const snapshot = lifecycleSnapshot([ownerParticipant, pendingParticipant]);
    const first = createGovernanceLifecycleContext(snapshot);
    const transition = accessTransition();
    first.context.governanceRequest = vi.fn(async () => ({ transition }));
    first.context.governanceClient.refresh = vi.fn(async () => {
      throw new Error('Refresh failed after acknowledgement');
    });

    await expect(first.context.assignGovernanceRole('writer-session', 'editor'))
      .rejects.toThrow('Refresh failed after acknowledgement');
    expect(first.activity.toArray()).toEqual([
      expect.objectContaining({
        actor: transition.actor,
        id: transition.id,
        target: 'writer-session',
      }),
    ]);

    const replayedDoc = new Y.Doc();
    Y.applyUpdate(replayedDoc, Y.encodeStateAsUpdate(first.ydoc));
    const replayed = createGovernanceLifecycleContext(snapshot, replayedDoc);
    replayed.context.governanceRequest = vi.fn(async () => ({ transition }));
    replayed.context.governanceClient.refresh = vi.fn(async () => {
      const next = lifecycleSnapshot([
        ownerParticipant,
        { ...pendingParticipant, roleId: 'editor', state: 'active' },
      ]);
      replayed.context.governanceSnapshot = next;
      return next;
    });

    await replayed.context.assignGovernanceRole('writer-session', 'editor');

    expect(replayed.activity.toArray()).toHaveLength(1);
    expect(replayed.activity.get(0)).toEqual(expect.objectContaining({
      actor: transition.actor,
      id: transition.id,
    }));
  });

  it('uses the server-authoritative authorization actor for Owner decisions', async () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, 'before');
    const governanceContext = {
      activity: ydoc.getArray('governanceActivity'),
      comments: ydoc.getArray('comments'),
      ydoc,
      ytext,
    };
    const anchor = {
      anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, 6)),
      anchorEndLine: 1,
      anchorKind: 'text',
      anchorQuote: 'before',
      anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, 0)),
      anchorStartLine: 1,
    };
    const proposal = createProposal(governanceContext, {
      actor: {
        displayName: 'Reviewer',
        kind: 'ai',
        participantSessionId: 'reviewer-session',
        roleId: 'reviewer',
      },
      anchor,
      baseRevision: 'revision-1',
      expectedText: 'before',
      replacementText: 'after',
      source: 'webmcp_proposal',
    });
    const snapshot = lifecycleSnapshot([ownerParticipant]);
    const context = createGovernanceContext({ credential: 'owner-credential', snapshot });
    const authoritativeActor = {
      displayName: 'Owner from server',
      kind: 'human',
      participantSessionId: 'authoritative-owner-session',
      roleId: 'owner',
    };
    context.governanceClient.authorize = vi.fn(async () => ({
      actor: authoritativeActor,
      ok: true,
      session: {
        documentPath: 'README.md',
        participantSessionId: authoritativeActor.participantSessionId,
        roleId: 'owner',
        state: 'active',
      },
    }));
    context.session = { getGovernanceContext: () => governanceContext };
    context.renderGovernanceUi = vi.fn();

    await context.resolveGovernanceProposal(proposal.id, 'keep_current');

    expect(governanceContext.activity.toArray().at(-1)).toEqual(expect.objectContaining({
      actor: authoritativeActor,
      source: 'owner_decision',
    }));
  });
});
