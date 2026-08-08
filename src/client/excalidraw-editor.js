import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  CaptureUpdateAction,
  Excalidraw,
  reconcileElements,
  restoreAppState,
  restoreElements,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

import {
  buildRenderableCollaboratorsMap,
  findCollaboratorByPeerId,
  getCollaboratorsRenderSignature,
  mergeAwarenessUserPatch,
  resolveLocalAwarenessUser,
} from './domain/excalidraw-collaboration.js';
import './styles/surfaces/embedded-editor-base.css';
import './styles/surfaces/excalidraw-editor.css';
import {
  applySceneUpdateWithFiles,
} from './domain/excalidraw-api-scene-sync.js';
import {
  normalizeDocumentMode,
  normalizeScene,
  parseSceneJson,
  sceneToInitialData,
} from './domain/excalidraw-scene.js';
import {
  buildReconciledExcalidrawSceneUpdate,
} from './domain/excalidraw-scene-reconcile.js';
import {
  createExcalidrawDiagnosticRing,
  summarizeExcalidrawScene,
} from './domain/excalidraw-diagnostics.js';
import { isPlainQuickSwitcherShortcut } from './domain/keyboard-shortcuts.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import {
  EXCALIDRAW_ROOM_CONNECTION_STATE,
  ExcalidrawRoomClient,
} from './infrastructure/excalidraw-room-client.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';

const params = new URLSearchParams(window.location.search);
const isTestMode = params.get('test') === '1';
const diagnostics = createExcalidrawDiagnosticRing({
  enabled: params.get('excalidrawDebug') === '1',
});
const parentOrigin = window.location.origin;
const syncTimeoutMs = Number.parseInt(params.get('syncTimeoutMs') || '', 10);

let currentDocument = {
  filePath: params.get('file') || '',
  mode: normalizeDocumentMode(params.get('mode')),
};
let excalidrawAPI = null;
let currentTheme = params.get('theme') || 'dark';
let localAwarenessUser = resolveLocalAwarenessUser({
  params,
  storedUserName: localStorage.getItem('collabmd-user-name'),
});
let appliedSceneJson = '';

let collabReady = false;
let pendingRemoteSceneJson = '';
let pendingCollaborators = null;
let activeCollaborators = new Map();
let followedSocketId = null;
let pendingHostFollowPeerId = null;
let suppressViewportBroadcast = false;
let pendingViewportSuppressionReleases = 0;
let lastAppliedFollowViewportSignature = '';
let lastRenderedCollaboratorsSignature = '';
let apiStateCleanupCallbacks = [];
let collaboratorRenderFrame = 0;
let queuedCollaborators = null;
let initialViewportFitPending = true;
let previewViewportFitTimerId = 0;
let previewViewportFitRetryTimerId = 0;
let roomClient = null;
let roomClientGeneration = 0;
let reactRoot = null;
let editorRenderKey = 0;
let skipRoomDisconnectOnUnmount = false;
let roomConnectionState = EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING;
let parkRequestedWhileBlocked = false;
const pendingDisconnectRequestIds = new Set();
const reportedFileConflictSignatures = new Set();

function getMountedExcalidrawAPI() {
  return excalidrawAPI && !excalidrawAPI.isDestroyed ? excalidrawAPI : null;
}

if (diagnostics.enabled) {
  window.__COLLABMD_EXCALIDRAW_DEBUG__ = diagnostics;
}

function getDocumentViewState(mode = currentDocument.mode) {
  const normalizedMode = normalizeDocumentMode(mode);
  const authorityReadOnly = roomConnectionState !== EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE;
  return {
    viewModeEnabled: normalizedMode === 'preview' || authorityReadOnly,
    zenModeEnabled: normalizedMode === 'preview',
  };
}

function getAuthorityBannerText() {
  if (normalizeDocumentMode(currentDocument.mode) === 'preview') {
    return '';
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.FALLBACK_READONLY) {
    return 'Showing the saved diagram. Editing will resume after live sync completes.';
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY) {
    return 'Connection lost. Editing is paused while the diagram reconnects.';
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING) {
    return 'Connecting to the live diagram…';
  }

  return '';
}

function applyDocumentMode(mode = currentDocument.mode) {
  document.body.dataset.documentMode = normalizeDocumentMode(mode);
}

function createRoomClient(filePath) {
  const generation = ++roomClientGeneration;
  const client = new ExcalidrawRoomClient({
    filePath,
    onCollaboratorsChange: (collaborators) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      if (!collabReady) {
        pendingCollaborators = collaborators;
        return;
      }

      queueCollaboratorsRender(collaborators);
    },
    onConnectionStateChange: (event) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      handleRoomConnectionStateChange(event);
    },
    onRemoteSceneJson: (sceneJson) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      applySceneFromJson(sceneJson);
    },
    syncTimeoutMs: Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : undefined,
    vaultClient: vaultApiClient,
  });

  return {
    client,
    generation,
  };
}

function buildExcalidrawProps({ initialData } = {}) {
  const props = {
    onMount: handleEditorMount,
    onInitialize: (api) => {
      initializeEditor(api);
    },
    onUnmount: () => {
      clearEditorApiStateBindings();
      clearPreviewViewportFitTimers();
      if (skipRoomDisconnectOnUnmount) {
        skipRoomDisconnectOnUnmount = false;
      } else {
        disconnectRealtimeRoom({ preserveEditorBindings: true });
      }
      excalidrawAPI = null;
      collabReady = false;
    },
    aiEnabled: false,
    isCollaborating: true,
    onChange: (elements, appState, files) => {
      scheduleSyncToRoom(elements, appState, files);
      roomClient?.syncLocalSelectionAwareness(appState);
    },
    onPointerUpdate: (payload) => {
      roomClient?.scheduleLocalPointerAwareness(payload);
    },
    historyOptions: {
      traversal: 'single-entry',
    },
    onHistoryAction: handleHistoryAction,
    theme: currentTheme,
    ...getDocumentViewState(),
    UIOptions: {
      canvasActions: {
        export: false,
        loadScene: false,
        saveToActiveFile: false,
        toggleTheme: false,
      },
    },
  };

  if (initialData) {
    props.initialData = initialData;
  }

  return props;
}

function renderExcalidrawApp({ initialData } = {}) {
  if (!reactRoot) {
    return;
  }

  reactRoot.render(
    React.createElement(
      'div',
      { className: 'excalidraw-editor-shell' },
      React.createElement(Excalidraw, {
        key: `editor-${editorRenderKey}`,
        ...buildExcalidrawProps({ initialData }),
      }),
      getAuthorityBannerText()
        ? React.createElement('div', {
          className: 'excalidraw-authority-banner',
          role: 'status',
        }, getAuthorityBannerText())
        : null,
    ),
  );
}

function recordSceneDiagnostic(event, details = {}, sceneJson = '') {
  if (!diagnostics.enabled) {
    return;
  }

  let sceneSummary = {};
  if (sceneJson) {
    try {
      sceneSummary = summarizeExcalidrawScene(parseSceneJson(sceneJson));
    } catch {
      sceneSummary = {};
    }
  }

  diagnostics.record(event, {
    ...sceneSummary,
    connectionState: roomConnectionState,
    generation: roomClientGeneration,
    hasPendingWrites: roomClient?.hasPendingWrites?.() || false,
    ...details,
  });
}

function handleHistoryAction({ action = '', outcome = '' } = {}) {
  recordSceneDiagnostic('history-action', { action, outcome });
  const api = getMountedExcalidrawAPI();
  if (outcome !== 'no-visible-change' || !api) {
    return;
  }

  const label = action === 'redo' ? 'Redo' : 'Undo';
  api.setToast?.({
    message: `${label} skipped: a collaborator changed that item`,
  });
}

function handleRoomConnectionStateChange({
  canWrite = false,
  hasPendingWrites = false,
  previousState = EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED,
  state,
} = {}) {
  roomConnectionState = state || EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED;
  recordSceneDiagnostic('authority-state', {
    canWrite,
    hasPendingWrites,
    previousState,
    state: roomConnectionState,
  }, roomClient?.getLastSceneJson?.() || '');
  postToParent('excalidraw-authority-state', {
    canWrite,
    hasPendingWrites,
    previousState,
    state: roomConnectionState,
  });

  if (reactRoot) {
    renderExcalidrawApp();
  }

  if (
    roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE
    && previousState === EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY
  ) {
    getMountedExcalidrawAPI()?.setToast?.({ message: 'Live diagram reconnected' });
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE) {
    void resolvePendingDisconnectRequests();
  }
}

function applySurfaceTheme(theme = currentTheme) {
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function getNativeHistoryButton(type) {
  const button = document.querySelector(`[data-testid="button-${type}"]`);
  return button instanceof HTMLButtonElement ? button : null;
}

function getNativeHistoryState() {
  const undoButton = getNativeHistoryButton('undo');
  const redoButton = getNativeHistoryButton('redo');

  return {
    canRedo: Boolean(redoButton) && !redoButton.disabled,
    canUndo: Boolean(undoButton) && !undoButton.disabled,
    head: null,
    length: null,
  };
}

function triggerNativeHistory(type) {
  const button = getNativeHistoryButton(type);
  if (!button || button.disabled) {
    return false;
  }

  button.click();
  return true;
}

function applyLocalUserPatch(nextUser = {}) {
  localAwarenessUser = mergeAwarenessUserPatch({
    currentUser: localAwarenessUser,
    nextUser,
  });
  roomClient?.setLocalUser(localAwarenessUser);
}

if (isTestMode) {
  window.__COLLABMD_EXCALIDRAW_TEST__ = {
    disconnectTransport: () => roomClient?.provider?.disconnect?.(),
    getElementBounds: (elementId) => {
      const element = getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()?.find((entry) => entry.id === elementId && !entry.isDeleted);
      if (!element) {
        return null;
      }

      return {
        centerX: element.x + (element.width / 2),
        centerY: element.y + (element.height / 2),
        height: element.height,
        width: element.width,
        x: element.x,
        y: element.y,
      };
    },
    getElementCount: () => (
      getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()?.filter((element) => !element.isDeleted).length ?? 0
    ),
    getElementIds: () => (
      getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()
        ?.filter((element) => !element.isDeleted)
        .map((element) => element.id)
        .sort() ?? []
    ),
    getElementStatus: (elementId) => (
      getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()
        ?.find((entry) => entry.id === elementId && !entry.isDeleted)?.status ?? null
    ),
    getFileIds: () => (
      Object.keys(getMountedExcalidrawAPI()?.getFiles?.() || {}).sort()
    ),
    getFileVersion: (fileId) => getMountedExcalidrawAPI()?.getFiles?.()?.[fileId]?.version ?? null,
    getEditorId: () => getMountedExcalidrawAPI()?.id || null,
    getForkCapabilities: () => ({
      replaceFiles: typeof getMountedExcalidrawAPI()?.replaceFiles === 'function',
    }),
    getAuthorityState: () => roomConnectionState,
    getDiagnosticTrace: () => diagnostics.exportTrace(),
    getHistoryState: () => getNativeHistoryState(),
    getLocalUserName: () => localAwarenessUser?.name || '',
    getLocalPeerId: () => localAwarenessUser?.peerId || '',
    getViewport: () => {
      const appState = getMountedExcalidrawAPI()?.getAppState?.();
      return appState ? {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom?.value ?? null,
      } : null;
    },
    isViewMode: () => Boolean(getMountedExcalidrawAPI()?.getAppState?.().viewModeEnabled),
    getSceneJson: () => roomClient?.getLastSceneJson?.() || '',
    isAuthoritativeReady: () => (
      Boolean(getMountedExcalidrawAPI())
      && collabReady
      && roomClient?.canWriteToRoom === true
      && roomClient?.waitingForAuthoritativeSync === false
      && roomClient?.isApplyingSharedSnapshot?.() === false
    ),
    isReady: () => collabReady && Boolean(getMountedExcalidrawAPI()) && Boolean(getNativeHistoryButton('undo')) && Boolean(getNativeHistoryButton('redo')),
    redoShared: () => triggerNativeHistory('redo'),
    reconnectTransport: () => roomClient?.provider?.connect?.(),
    setScene: (scene) => {
      applyLocalScene(normalizeScene(scene), {
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    setViewport: (viewport) => {
      const api = getMountedExcalidrawAPI();
      if (!api) {
        return;
      }

      const currentAppState = api.getAppState();
      api.updateScene({
        appState: {
          scrollX: Number.isFinite(viewport?.scrollX) ? viewport.scrollX : currentAppState.scrollX,
          scrollY: Number.isFinite(viewport?.scrollY) ? viewport.scrollY : currentAppState.scrollY,
          zoom: Number.isFinite(viewport?.zoom) && viewport.zoom > 0
            ? { value: viewport.zoom }
            : currentAppState.zoom,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    undoShared: () => triggerNativeHistory('undo'),
  };
}

function applyCollaborators(collaborators) {
  activeCollaborators = collaborators instanceof Map ? collaborators : new Map();
  const renderableCollaborators = buildRenderableCollaboratorsMap(activeCollaborators);
  const renderSignature = getCollaboratorsRenderSignature(renderableCollaborators);

  const api = getMountedExcalidrawAPI();
  if (!api) {
    pendingCollaborators = activeCollaborators;
    return;
  }

  if (renderSignature !== lastRenderedCollaboratorsSignature) {
    lastRenderedCollaboratorsSignature = renderSignature;
    api.updateScene({
      collaborators: renderableCollaborators,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  if (pendingHostFollowPeerId) {
    applyHostFollowRequest(pendingHostFollowPeerId);
    return;
  }

  applyFollowedViewport(activeCollaborators);
}

function queueCollaboratorsRender(collaborators) {
  queuedCollaborators = collaborators;
  if (collaboratorRenderFrame) {
    return;
  }

  collaboratorRenderFrame = requestAnimationFrame(() => {
    collaboratorRenderFrame = 0;
    const nextCollaborators = queuedCollaborators;
    queuedCollaborators = null;
    applyCollaborators(nextCollaborators);
  });
}

function isEditingTextElement() {
  return Boolean(getMountedExcalidrawAPI()?.getAppState?.()?.editingTextElement);
}

function flushPendingRemoteScene() {
  if (!pendingRemoteSceneJson || !getMountedExcalidrawAPI() || !collabReady || isEditingTextElement()) {
    return false;
  }

  const sceneJson = pendingRemoteSceneJson;
  pendingRemoteSceneJson = '';
  applySceneFromJson(sceneJson, {
    force: true,
  });
  return true;
}

function applySceneFromJson(rawJson, {
  force = false,
} = {}) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (!force && normalizedJson === appliedSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  appliedSceneJson = normalizedJson;
  recordSceneDiagnostic('remote-scene-received', {}, normalizedJson);

  if (!getMountedExcalidrawAPI() || !collabReady) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  if (!force && isEditingTextElement()) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  updateApiScene(scene);
}

function releaseViewportBroadcastSuppressionAfterPaint() {
  pendingViewportSuppressionReleases += 1;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingViewportSuppressionReleases = Math.max(0, pendingViewportSuppressionReleases - 1);
      if (pendingViewportSuppressionReleases === 0) {
        suppressViewportBroadcast = false;
      }
    });
  });
}

function buildApiSceneUpdate(scene, {
  appStateOverrides = {},
  api = getMountedExcalidrawAPI(),
} = {}) {
  if (!api) {
    return null;
  }

  const currentAppState = api.getAppState();
  const currentElements = api.getSceneElementsIncludingDeleted?.() || api.getSceneElements();

  return buildReconciledExcalidrawSceneUpdate({
    appStateOverrides,
    currentAppState,
    currentElements,
    documentViewState: getDocumentViewState(),
    reconcileElementsFn: reconcileElements,
    restoreAppStateFn: restoreAppState,
    restoreElementsFn: restoreElements,
    scene,
    theme: currentTheme,
  });
}

function logFileConflictOnce(conflictingFileIds = []) {
  const signature = `${currentDocument.filePath}::${[...conflictingFileIds].sort().join(',')}`;
  if (reportedFileConflictSignatures.has(signature)) {
    return;
  }

  reportedFileConflictSignatures.add(signature);
  console.warn(
    `[excalidraw:${currentDocument.filePath}] The installed Excalidraw API cannot replace conflicting binary file payload(s) without a remount: ${conflictingFileIds.join(', ')}`,
  );
  recordSceneDiagnostic('binary-file-conflict', {
    fileCount: conflictingFileIds.length,
    reason: 'replace-files-api-unavailable',
  });
}

function requestEditorRemount(scene) {
  if (!reactRoot) {
    return false;
  }

  const normalizedScene = normalizeScene(scene);
  const normalizedJson = JSON.stringify(normalizedScene);
  pendingRemoteSceneJson = normalizedJson;
  appliedSceneJson = normalizedJson;
  pendingCollaborators = activeCollaborators;
  initialViewportFitPending = true;
  clearPreviewViewportFitTimers();
  clearEditorApiStateBindings();
  skipRoomDisconnectOnUnmount = true;
  editorRenderKey += 1;
  renderExcalidrawApp({
    initialData: sceneToInitialData(normalizedScene, { theme: currentTheme }),
  });
  return true;
}

function applySceneToMountedApi(scene, {
  appStateOverrides = {},
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = false,
} = {}) {
  const api = getMountedExcalidrawAPI();
  if (!api) {
    return { skipped: true };
  }

  const nextSceneUpdate = buildApiSceneUpdate(scene, {
    appStateOverrides,
    api,
  });
  let applyResult;

  if (trackedSharedSnapshot) {
    roomClient?.beginApplyingSharedSnapshot();
  }

  try {
    applyResult = applySceneUpdateWithFiles(api, {
      captureUpdate,
      files: scene?.files || {},
      sceneUpdate: nextSceneUpdate,
    }, {
      onFileConflict: ({ conflictingFileIds }) => {
        logFileConflictOnce(conflictingFileIds);
      },
    });
  } finally {
    if (trackedSharedSnapshot) {
      roomClient?.endApplyingSharedSnapshot();
    }
  }

  if (applyResult?.requiresRemount) {
    requestEditorRemount(scene);
    return applyResult;
  }

  scheduleInitialViewportFit();
  return applyResult;
}

function updateApiScene(scene, {
  appStateOverrides = {},
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = true,
} = {}) {
  applySceneToMountedApi(scene, {
    appStateOverrides,
    captureUpdate,
    trackedSharedSnapshot,
  });
}

function applyLocalScene(scene, {
  captureUpdate = CaptureUpdateAction.IMMEDIATELY,
} = {}) {
  const normalizedScene = normalizeScene(scene);
  const normalizedJson = JSON.stringify(normalizedScene);

  appliedSceneJson = normalizedJson;

  if (!getMountedExcalidrawAPI() || !collabReady) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  applySceneToMountedApi(normalizedScene, {
    captureUpdate,
  });
  roomClient?.commitSceneJson(normalizedJson, {
    origin: 'excalidraw-local-scene-apply',
  });
}

function onRoomTextUpdate() {
  applySceneFromJson(roomClient?.getLastSceneJson?.() || '');
}

function getLiveSceneElementsForSync(fallbackElements = []) {
  return getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.() || fallbackElements;
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function handleQuickSwitcherKeyDown(event) {
  if (!isPlainQuickSwitcherShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  postToParent('request-toggle-quick-switcher');
}

function getSceneElementsForPreviewFit() {
  const api = getMountedExcalidrawAPI();
  return (
    api?.getSceneElementsIncludingDeleted?.()
      ?.filter((element) => !element.isDeleted) ?? []
  );
}

function scheduleViewportFit({
  delayMs = 0,
  forcePreview = false,
  consumeInitialFit = false,
} = {}) {
  const normalizedMode = normalizeDocumentMode(currentDocument.mode);
  if (!getMountedExcalidrawAPI() || (forcePreview && normalizedMode !== 'preview')) {
    return;
  }

  if (!forcePreview && !initialViewportFitPending) {
    return;
  }

  const elements = getSceneElementsForPreviewFit();
  if (elements.length === 0) {
    return;
  }
  if (consumeInitialFit) {
    initialViewportFitPending = false;
  }

  if (previewViewportFitTimerId) {
    window.clearTimeout(previewViewportFitTimerId);
  }

  previewViewportFitTimerId = window.setTimeout(() => {
    previewViewportFitTimerId = 0;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const api = getMountedExcalidrawAPI();
        if (!api) {
          return;
        }

        const latestElements = getSceneElementsForPreviewFit();
        if (latestElements.length === 0) {
          return;
        }

        if (forcePreview) {
          suppressViewportBroadcast = true;
        }

        api.setViewport({
          target: latestElements,
          animation: false,
          fit: 'contain',
        });

        if (forcePreview) {
          releaseViewportBroadcastSuppressionAfterPaint();
        }
      });
    });
  }, delayMs);
}

function scheduleInitialViewportFit() {
  scheduleViewportFit({ consumeInitialFit: true });
}

function schedulePreviewViewportFit() {
  if (previewViewportFitRetryTimerId) {
    window.clearTimeout(previewViewportFitRetryTimerId);
  }

  scheduleViewportFit({ forcePreview: true, delayMs: 80 });
  previewViewportFitRetryTimerId = window.setTimeout(() => {
    previewViewportFitRetryTimerId = 0;
    scheduleViewportFit({ forcePreview: true });
  }, 240);
}

function clearPreviewViewportFitTimers() {
  if (previewViewportFitTimerId) {
    window.clearTimeout(previewViewportFitTimerId);
    previewViewportFitTimerId = 0;
  }

  if (previewViewportFitRetryTimerId) {
    window.clearTimeout(previewViewportFitRetryTimerId);
    previewViewportFitRetryTimerId = 0;
  }
}

function syncLocalViewportToRoom() {
  const api = getMountedExcalidrawAPI();
  if (!collabReady || !api || !roomClient || suppressViewportBroadcast) {
    return;
  }

  const appState = api.getAppState();
  roomClient.scheduleLocalViewportAwareness({
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom?.value,
  });
}

function setFollowedSocket(nextSocketId, { force = false } = {}) {
  const normalizedSocketId = nextSocketId ? String(nextSocketId) : null;
  const didChange = followedSocketId !== normalizedSocketId;
  followedSocketId = normalizedSocketId;
  if (didChange) {
    lastAppliedFollowViewportSignature = '';
  }

  if (followedSocketId) {
    applyFollowedViewport(activeCollaborators, { force: force || didChange });
  }
}

function applyFollowedViewport(collaborators = activeCollaborators, { force = false } = {}) {
  const api = getMountedExcalidrawAPI();
  if (!api || !followedSocketId) {
    return;
  }

  const collaborator = collaborators?.get?.(String(followedSocketId));
  const viewport = collaborator?.viewport;
  if (!viewport) {
    return;
  }

  const nextSignature = `${followedSocketId}:${viewport.scrollX}:${viewport.scrollY}:${viewport.zoom}`;
  if (!force && nextSignature === lastAppliedFollowViewportSignature) {
    return;
  }

  lastAppliedFollowViewportSignature = nextSignature;
  suppressViewportBroadcast = true;
  api.updateScene({
    appState: {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: { value: viewport.zoom },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  releaseViewportBroadcastSuppressionAfterPaint();
}

function applyHostFollowRequest(peerId) {
  pendingHostFollowPeerId = peerId || null;
  const api = getMountedExcalidrawAPI();
  if (!api) {
    return;
  }

  if (!peerId) {
    api.updateScene({
      appState: { userToFollow: null },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setFollowedSocket(null, { force: true });
    pendingHostFollowPeerId = null;
    return;
  }

  const collaborator = findCollaboratorByPeerId(activeCollaborators, peerId);
  if (!collaborator?.socketId) {
    return;
  }

  api.updateScene({
    appState: {
      userToFollow: {
        socketId: collaborator.socketId,
        username: collaborator.username || '',
      },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  setFollowedSocket(collaborator.socketId, { force: true });
  pendingHostFollowPeerId = null;
}

function clearEditorApiStateBindings() {
  apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
  apiStateCleanupCallbacks = [];
}

function resetRealtimeRoomState() {
  collabReady = false;
  pendingRemoteSceneJson = '';
  pendingCollaborators = null;
  activeCollaborators = new Map();
  followedSocketId = null;
  pendingHostFollowPeerId = null;
  suppressViewportBroadcast = false;
  pendingViewportSuppressionReleases = 0;
  lastAppliedFollowViewportSignature = '';
  lastRenderedCollaboratorsSignature = '';
  if (collaboratorRenderFrame) {
    cancelAnimationFrame(collaboratorRenderFrame);
  }
  collaboratorRenderFrame = 0;
  queuedCollaborators = null;
}

function disconnectRealtimeRoom({ preserveEditorBindings = false } = {}) {
  const activeRoomClient = roomClient;
  const previousState = roomConnectionState;
  roomClient = null;
  roomClientGeneration += 1;
  roomConnectionState = EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED;
  pendingDisconnectRequestIds.clear();
  parkRequestedWhileBlocked = false;

  resetRealtimeRoomState();
  if (!preserveEditorBindings) {
    clearEditorApiStateBindings();
  }

  activeRoomClient?.disconnect();
  recordSceneDiagnostic('room-disconnected', {
    previousState,
    state: roomConnectionState,
  });
  postToParent('excalidraw-authority-state', {
    canWrite: false,
    hasPendingWrites: false,
    previousState,
    state: roomConnectionState,
  });
}

let didDisconnectRealtimeRoom = false;

function disconnectRealtimeRoomOnce() {
  if (didDisconnectRealtimeRoom) {
    return;
  }

  didDisconnectRealtimeRoom = true;
  disconnectRealtimeRoom();
}

async function waitForPendingRoomWrites({
  intervalMs = 10,
  maxWaitMs = 150,
} = {}) {
  const startedAt = performance.now();

  while ((performance.now() - startedAt) < maxWaitMs) {
    const ws = roomClient?.provider?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount === 0) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

async function prepareRealtimeRoomDisconnect() {
  if (!roomClient) {
    return true;
  }

  if (roomClient.getConnectionState() !== EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE) {
    return false;
  }

  roomClient.flushSceneSync();
  await waitForPendingRoomWrites();
  return roomClient?.getConnectionState() === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE;
}

async function resolvePendingDisconnectRequests() {
  if (pendingDisconnectRequestIds.size === 0 && !parkRequestedWhileBlocked) {
    return;
  }

  const canDisconnect = await prepareRealtimeRoomDisconnect();
  if (!canDisconnect) {
    return;
  }

  const requestIds = [...pendingDisconnectRequestIds];
  pendingDisconnectRequestIds.clear();
  requestIds.forEach((requestId) => {
    postToParent('disconnect-ready', { requestId });
  });

  if (parkRequestedWhileBlocked) {
    parkRequestedWhileBlocked = false;
    disconnectRealtimeRoom({ preserveEditorBindings: true });
  }
}

async function connectDocumentClient(filePath) {
  const { client, generation } = createRoomClient(filePath);
  roomClient = client;
  const scene = await client.connect({ initialUser: localAwarenessUser });

  if (generation !== roomClientGeneration || roomClient !== client) {
    client.disconnect();
    return null;
  }

  return scene;
}

window.addEventListener('pagehide', disconnectRealtimeRoomOnce);
window.addEventListener('beforeunload', (event) => {
  if (roomConnectionState !== EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY) {
    return;
  }

  event.preventDefault();
  event.returnValue = '';
});

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) {
    return;
  }

  if (event.source !== window.parent) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== 'collabmd-host') {
    return;
  }

  if (message.type === 'set-theme') {
    currentTheme = message.theme || 'dark';
    applySurfaceTheme(currentTheme);
    const api = getMountedExcalidrawAPI();
    if (api) {
      api.updateScene({
        appState: { theme: currentTheme },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    renderExcalidrawApp();
    return;
  }

  if (message.type === 'set-user') {
    applyLocalUserPatch(message.user);
    return;
  }

  if (message.type === 'follow-user') {
    applyHostFollowRequest(message.peerId || null);
    return;
  }

  if (message.type === 'fit-preview-viewport') {
    schedulePreviewViewportFit();
    return;
  }

  if (message.type === 'prepare-disconnect') {
    void (async () => {
      const requestId = message.requestId || '';
      if (await prepareRealtimeRoomDisconnect()) {
        postToParent('disconnect-ready', { requestId });
        return;
      }

      pendingDisconnectRequestIds.add(requestId);
      postToParent('disconnect-blocked', {
        requestId,
        state: roomConnectionState,
      });
    })();
    return;
  }

  if (message.type === 'cancel-disconnect') {
    pendingDisconnectRequestIds.delete(message.requestId || '');
    return;
  }

  if (message.type === 'discard-and-disconnect') {
    const requestId = message.requestId || '';
    pendingDisconnectRequestIds.delete(requestId);
    recordSceneDiagnostic('disconnect-discarded', {
      reason: 'user-confirmed',
      state: roomConnectionState,
    });
    disconnectRealtimeRoom({ preserveEditorBindings: true });
    postToParent('disconnect-ready', {
      discarded: true,
      requestId,
    });
    return;
  }

  if (message.type === 'park-room') {
    void (async () => {
      if (await prepareRealtimeRoomDisconnect()) {
        disconnectRealtimeRoom({ preserveEditorBindings: true });
        return;
      }

      parkRequestedWhileBlocked = true;
      postToParent('park-blocked', { state: roomConnectionState });
    })();
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || !roomClient) {
    return;
  }

  const liveElements = getLiveSceneElementsForSync(elements);
  const scheduled = roomClient.scheduleSceneSync(liveElements, appState, files);
  if (diagnostics.enabled) {
    recordSceneDiagnostic(scheduled ? 'local-scene-scheduled' : 'local-scene-rejected', {
      canWrite: roomClient.canWriteToRoom,
      hasPendingWrites: roomClient.hasPendingWrites(),
    }, JSON.stringify({
      appState,
      elements: liveElements,
      files,
    }));
  }
}

function initializeEditor(api) {
  excalidrawAPI = api;
  apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
  apiStateCleanupCallbacks = [];

  apiStateCleanupCallbacks.push(api.onStateChange(['scrollX', 'scrollY', 'zoom'], () => {
    syncLocalViewportToRoom();
  }));
  apiStateCleanupCallbacks.push(api.onStateChange('userToFollow', (userToFollow) => {
    if (userToFollow?.socketId) {
      setFollowedSocket(userToFollow.socketId, { force: true });
      return;
    }

    setFollowedSocket(null, { force: true });
  }));
  apiStateCleanupCallbacks.push(api.onStateChange('editingTextElement', (editingTextElement) => {
    if (!editingTextElement) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flushPendingRemoteScene();
        });
      });
    }
  }));

  const sceneJson = pendingRemoteSceneJson || roomClient?.getLastSceneJson?.() || '';
  const initialScene = parseSceneJson(sceneJson);
  pendingRemoteSceneJson = '';
  appliedSceneJson = JSON.stringify(initialScene);
  updateApiScene(initialScene);

  if (pendingCollaborators) {
    const renderableCollaborators = buildRenderableCollaboratorsMap(pendingCollaborators);
    lastRenderedCollaboratorsSignature = getCollaboratorsRenderSignature(renderableCollaborators);
    api.updateScene({
      collaborators: renderableCollaborators,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    pendingCollaborators = null;
  }

  collabReady = true;
  syncLocalViewportToRoom();
  onRoomTextUpdate();
  if (pendingHostFollowPeerId) {
    applyHostFollowRequest(pendingHostFollowPeerId);
  }

  scheduleInitialViewportFit();
  postToParent('ready');
}

function handleEditorMount({ excalidrawAPI: api }) {
  excalidrawAPI = api;
}

window.addEventListener('keydown', handleQuickSwitcherKeyDown, { capture: true });

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    applySurfaceTheme(currentTheme);
    applyDocumentMode();
    await ensureClientAuthenticated();
    const initialScene = await connectDocumentClient(currentDocument.filePath);
    if (!initialScene) {
      throw new Error('Failed to connect initial Excalidraw document');
    }
    const initialData = sceneToInitialData(initialScene, { theme: currentTheme });

    loadingElement?.remove();
    reactRoot = createRoot(document.getElementById('root'));
    renderExcalidrawApp({ initialData });
  } catch (error) {
    console.error('[excalidraw] Failed to initialize:', error);
    postToParent('error', {
      message: error instanceof Error ? error.message : 'Failed to load Excalidraw',
    });

    if (loadingElement) {
      loadingElement.className = 'loading-state error';
      loadingElement.textContent = `Failed to load Excalidraw: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

void init();
