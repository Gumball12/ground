import {
  expect,
  test,
  waitForExcalidrawTestHarness,
  writeVaultFileAndResetCollab,
} from './helpers/app-fixture.js';

const STRESS_SEED = Number.parseInt(process.env.COLLABMD_EXCALIDRAW_STRESS_SEED || '', 10);

function createElement(id, {
  backgroundColor = 'transparent',
  index = 'a0',
  type = 'rectangle',
  version = 1,
  versionNonce = 1,
  x = 0,
  y = 0,
} = {}) {
  return {
    angle: 0,
    backgroundColor,
    boundElements: null,
    fillStyle: 'solid',
    frameId: null,
    groupIds: [],
    height: 80,
    id,
    index,
    isDeleted: false,
    link: null,
    locked: false,
    opacity: 100,
    roughness: 0,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: versionNonce,
    strokeColor: '#1f2937',
    strokeStyle: 'solid',
    strokeWidth: 2,
    type,
    updated: 1_720_000_000_000 + version,
    version,
    versionNonce,
    width: 120,
    x,
    y,
  };
}

function createScene(elements = [], files = {}) {
  return {
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements,
    files,
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  };
}

async function prepareFile(page, filePath, scene = createScene()) {
  await writeVaultFileAndResetCollab(page, {
    content: JSON.stringify(scene),
    path: filePath,
  });
}

async function openDirectEditor(page, filePath, extraParams = '') {
  await page.goto(`/excalidraw-editor.html?file=${encodeURIComponent(filePath)}&test=1&excalidrawDebug=1${extraParams}`);
  await waitForExcalidrawTestHarness(page);
}

async function waitForAuthority(page, timeout = 15000) {
  await expect.poll(async () => page.evaluate(() => (
    window.__COLLABMD_EXCALIDRAW_TEST__.getAuthorityState()
  )), { timeout }).toBe('authoritative');
}

async function getScene(page) {
  return page.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()));
}

async function setScene(page, scene) {
  await page.evaluate((nextScene) => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(nextScene);
  }, scene);
}

async function waitForIds(page, ids, timeout = 2000) {
  await expect.poll(async () => page.evaluate(() => (
    window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds()
  )), { timeout }).toEqual([...ids].sort());
}

async function readDurableScene(page, filePath) {
  return page.evaluate(async (path) => {
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      throw new Error(`Failed to read ${path}`);
    }
    const result = await response.json();
    return JSON.parse(result.content);
  }, filePath);
}

async function attachDiagnostics(testInfo, seed, pages) {
  const traces = [];
  for (const [name, page] of Object.entries(pages)) {
    if (page.isClosed()) {
      continue;
    }
    const events = await page.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_DEBUG__?.exportTrace?.() || []
    )).catch(() => []);
    traces.push({ name, events });
  }
  await testInfo.attach('excalidraw-diagnostics.json', {
    body: Buffer.from(JSON.stringify({ seed, traces }, null, 2)),
    contentType: 'application/json',
  });
}

test('@excalidraw-smoke fallback, reconnect, and durable convergence obey authority', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = 'authority-reconnect.e2e.excalidraw';

  try {
    await prepareFile(pageA, filePath, createScene([
      createElement('baseline', { backgroundColor: '#f8fafc' }),
    ]));
    await pageA.routeWebSocket(/\/ws\//, (webSocket) => {
      const server = webSocket.connectToServer();
      const delayedMessages = [];
      let canForward = false;
      server.onMessage((message) => {
        if (canForward) {
          webSocket.send(message);
          return;
        }
        delayedMessages.push(message);
      });
      setTimeout(() => {
        canForward = true;
        delayedMessages.splice(0).forEach((message) => webSocket.send(message));
      }, 250);
    });
    await openDirectEditor(pageA, filePath, '&syncTimeoutMs=25');
    await openDirectEditor(pageB, filePath);
    await waitForAuthority(pageA);
    await waitForAuthority(pageB);

    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getDiagnosticTrace()
        .some((event) => event.event === 'authority-state' && event.state === 'fallback-readonly')
    ))).toBe(true);

    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.disconnectTransport());
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getAuthorityState()
    )), { timeout: 5000 }).toBe('reconnecting-readonly');
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.isViewMode()
    ))).toBe(true);

    const reconnectedAt = Date.now();
    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.reconnectTransport());
    await waitForAuthority(pageA, 5000);
    expect(Date.now() - reconnectedAt).toBeLessThanOrEqual(5000);

    const nextScene = await getScene(pageA);
    nextScene.appState.viewBackgroundColor = '#123456';
    await setScene(pageA, nextScene);

    await expect.poll(async () => {
      const [remoteScene, durableScene] = await Promise.all([
        getScene(pageB),
        readDurableScene(pageA, filePath),
      ]);
      return {
        durable: durableScene.appState.viewBackgroundColor,
        remote: remoteScene.appState.viewBackgroundColor,
      };
    }, { timeout: 2000 }).toEqual({ durable: '#123456', remote: '#123456' });
  } finally {
    await attachDiagnostics(testInfo, null, { pageA, pageB });
    await context.close();
  }
});

test('@excalidraw-comments keeps threads in the sidecar and syncs markers, replies, and resolve', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = 'diagram-comments.e2e.excalidraw';

  try {
    await prepareFile(pageA, filePath, createScene([
      createElement('comment-target', { x: 100, y: 80 }),
    ]));
    await openDirectEditor(pageA, filePath);
    await openDirectEditor(pageB, filePath);
    await pageB.setViewportSize({ height: 720, width: 780 });
    await waitForAuthority(pageA);
    await waitForAuthority(pageB);
    await expect(pageA.locator('.layer-ui__wrapper__top-right .default-sidebar-trigger')).toBeVisible();

    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.selectElement('comment-target'));
    await pageA.getByTestId('diagram-comments-toggle').click();
    await expect(pageA.getByTestId('diagram-add-comment')).toBeEnabled();
    await pageA.getByTestId('diagram-add-comment').click();
    await pageA.locator('textarea[aria-label="Comment"]').fill('Add the owner here');
    await pageA.getByRole('button', { name: 'Post comment' }).click();

    await expect.poll(async () => pageB.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getCommentThreads().length
    ))).toBe(1);
    const threadId = await pageB.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getCommentThreads()[0].id
    ));
    const markerB = pageB.locator(`[data-comment-thread-id="${threadId}"]`);
    await expect(markerB).toBeVisible();
    await expect(markerB.locator('.diagram-comment-icon')).toBeVisible();
    await expect(pageB.locator('.layer-ui__wrapper__top-right .default-sidebar-trigger')).toBeVisible();
    await expect.poll(async () => pageB.getByTestId('diagram-comments-toggle').evaluate((element) => (
      Boolean(element.closest('.layer-ui__wrapper__top-right'))
    ))).toBe(true);
    const markerBeforeZoom = await markerB.boundingBox();
    await expect(pageB.getByTestId('diagram-add-comment')).toHaveCount(0);
    await expect(pageB.getByTestId('diagram-comments-toggle')).toHaveAttribute('aria-expanded', 'false');

    await expect(pageB.locator('.UserList')).toBeVisible();
    await expect.poll(async () => pageB.evaluate(() => {
      const toolbar = document.querySelector('.diagram-comments-toolbar')?.getBoundingClientRect();
      const userList = document.querySelector('.UserList')?.getBoundingClientRect();
      if (!toolbar || !userList) {
        return null;
      }

      return !(
        toolbar.right <= userList.left
        || toolbar.left >= userList.right
        || toolbar.bottom <= userList.top
        || toolbar.top >= userList.bottom
      );
    })).toBe(false);

    await pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.selectElement('comment-target'));
    await expect(pageB.locator('.diagram-comments-toolbar > button')).toHaveCount(2);
    await expect(pageB.getByTestId('diagram-add-comment')).toBeEnabled();
    await pageB.getByTestId('diagram-add-comment').click();
    await expect(pageB.locator('textarea[aria-label="Comment"]')).toBeVisible();
    await pageB.getByRole('button', { name: 'Cancel' }).click();
    await pageB.getByTestId('diagram-comments-toggle').click();
    await expect(pageB.getByTestId('diagram-add-comment')).toBeVisible();
    await expect(pageB.getByTestId('diagram-add-comment')).toHaveAttribute('aria-label', 'Add comment');
    await pageB.getByTestId('diagram-comments-toggle').click();
    await expect.poll(async () => pageB.locator('.App-menu_top__left .properties-trigger').count()).toBeGreaterThan(0);
    const markerFrameGeometry = await pageB.evaluate(() => {
      const marker = document.querySelector('.diagram-comment-marker')?.getBoundingClientRect();
      const bounds = window.__COLLABMD_EXCALIDRAW_TEST__.getElementBounds('comment-target');
      const viewport = window.__COLLABMD_EXCALIDRAW_TEST__.getViewport();
      return { marker, bounds, viewport };
    });
    expect(markerFrameGeometry.marker).not.toBeNull();
    expect(markerFrameGeometry.bounds).not.toBeNull();
    expect(markerFrameGeometry.viewport).not.toBeNull();
    expect(markerFrameGeometry.marker.x + (markerFrameGeometry.marker.width / 2)).toBeCloseTo(
      (markerFrameGeometry.bounds.x + markerFrameGeometry.bounds.width + markerFrameGeometry.viewport.scrollX)
        * markerFrameGeometry.viewport.zoom
        + markerFrameGeometry.viewport.offsetLeft,
      0,
    );
    expect(markerFrameGeometry.marker.y + (markerFrameGeometry.marker.height / 2)).toBeCloseTo(
      (markerFrameGeometry.bounds.y + markerFrameGeometry.viewport.scrollY)
        * markerFrameGeometry.viewport.zoom
        + markerFrameGeometry.viewport.offsetTop,
      0,
    );

    await pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.setViewport({
      scrollX: 40,
      scrollY: 30,
      zoom: 1.5,
    }));
    await expect.poll(async () => {
      const markerAfterZoom = await markerB.boundingBox();
      if (!markerBeforeZoom || !markerAfterZoom) {
        return 0;
      }
      return Math.round(markerAfterZoom.x - markerBeforeZoom.x) + Math.round(markerAfterZoom.y - markerBeforeZoom.y);
    }).not.toBe(0);

    await markerB.click();
    await expect(pageB.getByTestId('diagram-comments-drawer')).toBeVisible();
    await pageB.keyboard.press('Escape');
    await expect(pageB.getByTestId('diagram-comments-drawer')).toBeHidden();
    await markerB.click();
    await expect(pageB.getByTestId('diagram-comments-drawer')).toBeVisible();
    await pageB.locator('canvas.excalidraw__canvas.interactive').dispatchEvent('pointerdown');
    await expect(pageB.getByTestId('diagram-comments-drawer')).toBeHidden();
    await markerB.click();
    await expect(pageB.getByTestId('diagram-comments-drawer')).toContainText('Add the owner here');
    await expect(pageB.getByTestId('diagram-comments-drawer')).toContainText(
      'Rectangle element · Add the owner here',
    );
    await pageB.locator('textarea[aria-label="Reply"]').fill('Reviewer will own it.');
    await pageB.getByRole('button', { name: 'Reply' }).click();
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getCommentThreads()[0]?.messages.length || 0
    ))).toBe(2);

    await pageA.locator(`[data-comment-thread-id="${threadId}"]`).click();
    await pageA.getByRole('button', { name: 'Resolve' }).click();
    await expect.poll(async () => pageB.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getCommentThreads().length
    ))).toBe(0);
    await expect.poll(async () => pageA.evaluate(() => (
      JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).elements.map((element) => element.id)
    ))).toEqual(['comment-target']);
  } finally {
    await context.close();
  }
});

test('@excalidraw-smoke single-entry undo and redo do not cross a collaborator-superseded entry', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = 'single-entry-history.e2e.excalidraw';
  const baseScene = createScene([
    createElement('older-local', { backgroundColor: '#ffffff', index: 'a0', versionNonce: 100 }),
    createElement('conflicted', { backgroundColor: '#ffffff', index: 'a1', versionNonce: 101, x: 220 }),
  ]);

  try {
    await prepareFile(pageA, filePath, baseScene);
    await openDirectEditor(pageA, filePath);
    await openDirectEditor(pageB, filePath);
    await waitForAuthority(pageA);
    await waitForAuthority(pageB);
    const capabilities = await pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getForkCapabilities()
    ));
    test.skip(!capabilities.replaceFiles, 'Requires @andes90/excalidraw fork APIs');

    const olderEdit = await getScene(pageA);
    Object.assign(olderEdit.elements.find((element) => element.id === 'older-local'), {
      backgroundColor: '#bfdbfe',
      version: 2,
      versionNonce: 200,
    });
    await setScene(pageA, olderEdit);
    await expect.poll(async () => (
      (await getScene(pageB)).elements.find((element) => element.id === 'older-local')?.backgroundColor
    )).toBe('#bfdbfe');

    const conflictEdit = await getScene(pageA);
    Object.assign(conflictEdit.elements.find((element) => element.id === 'conflicted'), {
      backgroundColor: '#fecaca',
      version: 2,
      versionNonce: 201,
    });
    await setScene(pageA, conflictEdit);
    await expect.poll(async () => (
      (await getScene(pageB)).elements.find((element) => element.id === 'conflicted')?.backgroundColor
    )).toBe('#fecaca');

    const remoteDelete = await getScene(pageB);
    Object.assign(remoteDelete.elements.find((element) => element.id === 'conflicted'), {
      backgroundColor: '#fde68a',
      isDeleted: true,
      version: 12,
      versionNonce: 301,
    });
    await setScene(pageB, remoteDelete);
    await expect.poll(async () => (
      (await getScene(pageA)).elements.find((element) => element.id === 'conflicted')?.isDeleted
    )).toBe(true);

    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getDiagnosticTrace()
        .filter((event) => event.event === 'history-action')
        .at(-1)
    ))).toMatchObject({ action: 'undo', event: 'history-action', outcome: 'no-visible-change' });
    expect((await getScene(pageA)).elements.find((element) => element.id === 'older-local').backgroundColor).toBe('#bfdbfe');

    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());
    await expect.poll(async () => (
      (await getScene(pageB)).elements.find((element) => element.id === 'older-local')?.backgroundColor
    )).toBe('#ffffff');

    const remoteAddition = await getScene(pageB);
    remoteAddition.elements.push(createElement('remote-during-redo', {
      index: 'a2',
      versionNonce: 401,
      x: 440,
    }));
    await setScene(pageB, remoteAddition);
    await waitForIds(pageA, ['older-local', 'remote-during-redo']);
    expect(await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canRedo)).toBe(true);

    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());
    await expect.poll(async () => (
      (await getScene(pageB)).elements.find((element) => element.id === 'older-local')?.backgroundColor
    )).toBe('#bfdbfe');
    await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getDiagnosticTrace()
        .filter((event) => event.event === 'history-action')
        .at(-1)
    ))).toMatchObject({ action: 'redo', event: 'history-action', outcome: 'no-visible-change' });
  } finally {
    await attachDiagnostics(testInfo, null, { pageA, pageB });
    await context.close();
  }
});

test('@excalidraw-smoke same-ID binary replacement uses native replacement or a safe remount fallback', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = 'binary-replacement.e2e.excalidraw';
  const pixelA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zt9kAAAAASUVORK5CYII=';
  const pixelB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/58HAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

  try {
    await prepareFile(pageA, filePath, createScene([
      createElement('history-anchor', { versionNonce: 500 }),
    ]));
    await openDirectEditor(pageA, filePath);
    await openDirectEditor(pageB, filePath);
    await waitForAuthority(pageA);
    await waitForAuthority(pageB);
    const capabilities = await pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getForkCapabilities()
    ));

    const localEdit = await getScene(pageA);
    localEdit.appState.viewBackgroundColor = '#e0f2fe';
    await setScene(pageA, localEdit);
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo
    ))).toBe(true);
    const editorId = await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getEditorId());

    const imageElement = {
      ...createElement('image', { type: 'image', versionNonce: 501, x: 180 }),
      backgroundColor: 'transparent',
      crop: null,
      fileId: 'same-file',
      scale: [1, 1],
      status: 'saved',
    };
    await setScene(pageB, createScene([imageElement], {
      'same-file': {
        created: 1,
        dataURL: pixelA,
        id: 'same-file',
        mimeType: 'image/png',
        version: 1,
      },
    }));
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getFileVersion('same-file')
    ))).toBe(1);

    await setScene(pageB, createScene([{ ...imageElement, version: 2, versionNonce: 502 }], {
      'same-file': {
        created: 1,
        dataURL: pixelB,
        id: 'same-file',
        mimeType: 'image/png',
        version: 2,
      },
    }));
    await expect.poll(async () => pageA.evaluate(() => (
      window.__COLLABMD_EXCALIDRAW_TEST__.getFileVersion('same-file')
    ))).toBe(2);
    if (capabilities.replaceFiles) {
      expect(await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getEditorId())).toBe(editorId);
      expect(await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)).toBe(true);
    } else {
      await expect.poll(async () => (
        pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getEditorId())
      )).not.toBe(editorId);
    }
  } finally {
    await attachDiagnostics(testInfo, null, { pageA, pageB });
    await context.close();
  }
});

test('@excalidraw-stress seeded concurrent edits converge', async ({ browser }, testInfo) => {
  test.skip(!Number.isInteger(STRESS_SEED), 'Run through the nightly seeded stress driver');
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = `stress-${STRESS_SEED}.e2e.excalidraw`;
  let randomState = STRESS_SEED >>> 0;
  const random = () => {
    randomState = ((randomState * 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };

  try {
    await prepareFile(pageA, filePath);
    await openDirectEditor(pageA, filePath);
    await openDirectEditor(pageB, filePath);
    await waitForAuthority(pageA);
    await waitForAuthority(pageB);

    const expectedIds = [];
    for (let pair = 0; pair < 4; pair += 1) {
      const sceneA = await getScene(pageA);
      const sceneB = await getScene(pageB);
      const idA = `seed-${STRESS_SEED}-a-${pair}`;
      const idB = `seed-${STRESS_SEED}-b-${pair}`;
      expectedIds.push(idA, idB);
      sceneA.elements.push(createElement(idA, {
        index: `a${pair * 2}`,
        type: ['rectangle', 'ellipse', 'diamond'][Math.floor(random() * 3)],
        versionNonce: Math.floor(random() * 1_000_000) + 1,
        x: Math.floor(random() * 500),
        y: Math.floor(random() * 300),
      }));
      sceneB.elements.push(createElement(idB, {
        index: `a${(pair * 2) + 1}`,
        type: ['rectangle', 'ellipse', 'diamond'][Math.floor(random() * 3)],
        versionNonce: Math.floor(random() * 1_000_000) + 1,
        x: Math.floor(random() * 500),
        y: Math.floor(random() * 300),
      }));
      await Promise.all([setScene(pageA, sceneA), setScene(pageB, sceneB)]);
    }

    await Promise.all([
      waitForIds(pageA, expectedIds),
      waitForIds(pageB, expectedIds),
      expect.poll(async () => (
        (await readDurableScene(pageA, filePath)).elements.map((element) => element.id).sort()
      ), { timeout: 2000 }).toEqual([...expectedIds].sort()),
    ]);
  } finally {
    await attachDiagnostics(testInfo, STRESS_SEED, { pageA, pageB });
    await context.close();
  }
});
