import {
  expect,
  openFile,
  openHome,
  openSampleFull,
  pasteClipboardImage,
  replaceEditorContent,
  setHydrateDelay,
  test,
  waitForCollaborativeEditor,
  waitForEditor,
  waitForPreview,
  waitForHeavyPreviewContent,
  appendEditorContent,
  restoreReadmeTestDocument,
  restoreVaultFileFromTemplate,
} from './helpers/app-fixture.js';

async function applyBlockToolbarAction(page, action) {
  await page.locator('[data-markdown-block-menu-toggle]').click();
  await page.locator(`[data-markdown-block-action="${action}"]`).click();
}

async function chooseCreateAction(page, actionName, { from = 'sidebar' } = {}) {
  const trigger = from === 'empty-state'
    ? page.locator('#emptyStateNewFileBtn')
    : page.locator('#sidebarCreateBtn');

  await trigger.click();
  await expect(page.locator('.create-menu, .create-action-sheet').first()).toBeVisible();
  await page.locator('.create-menu-item, .create-action-sheet-item').filter({ hasText: actionName }).first().click();
}

async function dragFileTreeFileToDirectory(page, { sourceFilePath, targetDirectoryPath }) {
  await page.evaluate(({ sourcePath, targetPath }) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(sourcePath)}"]`);
    const target = document.querySelector(`#fileTree .file-tree-dir[data-path="${CSS.escape(targetPath)}"]`);

    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error(`Missing drag source or target for ${sourcePath} -> ${targetPath}`);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', source.dataset.path || sourcePath);

    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  }, {
    sourcePath: sourceFilePath,
    targetPath: targetDirectoryPath,
  });
}

async function dragFileTreeFileToRoot(page, { sourceFilePath }) {
  await page.evaluate(({ sourcePath }) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(sourcePath)}"]`);
    const target = document.querySelector('#fileTree .file-tree-root-drop-zone');

    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error(`Missing drag source or root target for ${sourcePath}`);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', source.dataset.path || sourcePath);

    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  }, {
    sourcePath: sourceFilePath,
  });
}

test('shows empty state when no file is selected', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.empty-state-title')).toContainText('Welcome to CollabMD');
  await expect(page.locator('#sidebarCreateBtn')).toBeVisible();
  await expect(page.locator('#refreshFilesBtn')).toHaveCount(0);
});

test('prompts first-time visitors for a display name', async ({ browser }) => {
  const page = await browser.newPage();

  await page.goto('/');

  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await expect(page.locator('#displayNameTitle')).toHaveText('Choose your display name');
  await expect(page.locator('#displayNameCopy')).toContainText('continue as a guest');
  await expect(page.locator('#displayNameCancel')).toHaveText('Skip for now');
  await expect(page.locator('#displayNameInput')).toHaveValue('');

  await page.locator('#displayNameCancel').click();
  await expect(page.locator('#displayNameDialog')).not.toBeVisible();
  await expect.poll(async () => (
    page.evaluate(() => window.localStorage.getItem('collabmd-user-name'))
  )).toBeNull();

  await page.close();
});

test('sidebar shows vault file tree', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();
  await expect(page.locator('#fileTree')).toContainText('README');
});

test('balances vertical whitespace in the sidebar tabs', async ({ page }) => {
  await openHome(page);

  const spacing = await page.locator('#sidebarTabs').evaluate((container) => {
    const icon = container.querySelector('.ui-nav-tab:not(.hidden) .ui-nav-tab-icon');
    const containerRect = container.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();

    return {
      bottom: containerRect.bottom - iconRect.bottom,
      top: iconRect.top - containerRect.top,
    };
  });

  expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(1);
});

test('renders markdown preview when a file is opened', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');
});

test('frontmatter preview can be collapsed and stays collapsed across rerenders', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, [
    '---',
    'title: Preview toggle',
    'tags:',
    '  - one',
    '  - two',
    '---',
    '',
    '# Heading',
    '',
    'Body copy',
  ].join('\n'));

  const frontmatter = page.locator('#previewContent .frontmatter-block');
  const toggle = frontmatter.locator('.frontmatter-toggle');
  const summary = frontmatter.locator('.frontmatter-summary');
  const content = frontmatter.locator('.frontmatter-content');

  await expect(frontmatter).toBeVisible();
  await expect(content).toBeVisible();

  await toggle.click();

  await expect(frontmatter).toHaveAttribute('data-collapsed', 'true');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('2 properties hidden');
  await expect(content).toBeHidden();

  await appendEditorContent(page, 'Another paragraph');

  await expect(frontmatter).toHaveAttribute('data-collapsed', 'true');
  await expect(content).toBeHidden();

  await toggle.click();

  await expect(frontmatter).toHaveAttribute('data-collapsed', 'false');
  await expect(content).toBeVisible();
});

test('indents nested task list items in markdown preview', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '## Todo\n\n- [ ] First todo\n  - [ ] Nested todo\n');
  await expect(page.locator('#previewContent .task-list-item')).toHaveCount(2);

  const checkboxOffsets = await page.locator('#previewContent').evaluate((root) => (
    Array.from(root.querySelectorAll('.task-list-item input[type="checkbox"]'))
      .slice(0, 2)
      .map((input) => input.getBoundingClientRect().left)
  ));

  expect(checkboxOffsets[1]).toBeGreaterThan(checkboxOffsets[0] + 12);
});

test('clicking a preview task list item toggles the markdown checkbox', async ({ page }) => {
  await openFile(page, 'README.md');
  await waitForCollaborativeEditor(page);

  await replaceEditorContent(page, '## Todo\n\n- [ ] First todo\n');
  const previewCheckbox = page.locator('#previewContent .task-list-item input[type="checkbox"]').first();
  await expect(previewCheckbox).toBeVisible();

  await previewCheckbox.click();

  await expect(page.locator('.cm-content').first()).toContainText('- [x] First todo');
  await expect(page.locator('#previewContent .task-list-item input[type="checkbox"]').first()).toBeChecked();

  await previewCheckbox.click();

  await expect(page.locator('.cm-content').first()).toContainText('- [ ] First todo');
  await expect(page.locator('#previewContent .task-list-item input[type="checkbox"]').first()).not.toBeChecked();
});

test('keeps desktop secondary actions behind the toolbar overflow menu', async ({ page }) => {
  await openFile(page, 'README.md', { waitFor: 'preview' });

  await expect(page.locator('#toolbarOverflowToggle')).toBeVisible();
  await expect(page.locator('#chatToggleBtn')).toBeVisible();
  await expect(page.locator('#editorFindBtn')).toBeHidden();
  await expect(page.locator('#searchFilesBtn')).toBeHidden();
  await expect(page.locator('[data-editor-command="undo"]').first()).toBeHidden();
  await expect(page.locator('#editNameBtn')).toBeHidden();
  await expect(page.locator('#shareBtn')).toBeHidden();
  await expect(page.locator('#themeToggleBtn')).toBeHidden();

  await page.locator('#toolbarOverflowToggle').click();

  await expect(page.locator('#editNameBtn')).toBeVisible();
  await expect(page.locator('#shareBtn')).toBeVisible();
  await expect(page.locator('#exportMenuGroup')).toBeVisible();
  await expect(page.locator('#themeToggleBtn')).toBeVisible();
  await expect(page.locator('#themeToggleBtn')).toContainText('Theme');
  await expect(page.locator('#themeToggleBtn [data-theme-toggle-state]')).toContainText(/Dark|Light/);
});

test('export docx uses the export page and posts the rendered snapshot html', async ({ page, context }) => {
  await restoreReadmeTestDocument(page);
  await openFile(page, 'README.md', { waitFor: 'preview' });

  let exportRequestBody = null;
  await context.route('**/api/export/docx', async (route) => {
    exportRequestBody = route.request().postDataJSON();
    await route.fulfill({
      body: Buffer.from('PK\x03\x04'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      headers: {
        'Content-Disposition': 'attachment; filename="README.docx"',
      },
      status: 200,
    });
  });

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportDocxBtn').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await expect.poll(() => exportRequestBody).not.toBeNull();
  expect(exportRequestBody.filePath).toBe('README.md');
  expect(exportRequestBody.title).toBe('README');
  expect(exportRequestBody.html).toContain('My Vault');
  expect(exportRequestBody.html).not.toContain('toolbarOverflowMenu');
  await expect(popup.locator('#exportStatus')).toContainText('DOCX download started.');
});

test('export pdf uses the export page and prints the rendered snapshot html', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, '__collabmdPrinted', {
      configurable: true,
      value: false,
      writable: true,
    });

    window.print = () => {
      window.__collabmdPrinted = true;
      window.dispatchEvent(new Event('afterprint'));
    };
  });

  await openFile(page, 'README.md', { waitFor: 'preview' });

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportPdfBtn').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await expect.poll(() => popup.evaluate(() => window.__collabmdPrinted)).toBe(true);
  await expect(popup.locator('#exportContent')).toContainText('My Vault');
  await expect(popup.locator('#exportStatus')).toContainText('Print dialog opened.');
  await expect.poll(() => popup.evaluate(() => ({
    bodyMatchesViewport: document.body.clientWidth === window.innerWidth,
    htmlMatchesViewport: document.documentElement.clientWidth === window.innerWidth,
  }))).toEqual({
    bodyMatchesViewport: true,
    htmlMatchesViewport: true,
  });
});

test('shows provisional content before delayed websocket sync and upgrades to collaborative editing', async ({ page }) => {
  await setHydrateDelay(page, 700);

  try {
    await openFile(page, 'README.md', { waitFor: 'loaded' });

    await expect.poll(async () => (
      page.locator('#editorContainer').evaluate((element) => element.dataset.editorMode || '')
    )).toBe('provisional');
    await expect(page.locator('#previewContent')).toContainText('My Vault');
    await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

    await waitForCollaborativeEditor(page);
    await replaceEditorContent(page, '# Live After Bootstrap\n\nCollaborative editing restored.\n');
    await expect(page.locator('#previewContent')).toContainText('Live After Bootstrap');
    await expect(page.locator('#previewContent')).toContainText('Collaborative editing restored.');
  } finally {
    await setHydrateDelay(page, 0);
  }
});

test('escapes raw html in markdown preview', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Safe Preview\n\nLine one<br>Line two\n\n<script>window.__collabmdXss = true</script>\n<div id="raw-html">inline html</div>');

  await expect(page.locator('#previewContent script')).toHaveCount(0);
  await expect(page.locator('#previewContent #raw-html')).toHaveCount(0);
  await expect(page.locator('#previewContent p').first()).toHaveText('Line oneLine two');
  await expect(page.locator('#previewContent p').first().locator('br')).toHaveCount(1);
  await expect(page.locator('#previewContent')).toContainText('<script>window.__collabmdXss = true</script>');
});

test('video toolbar helper converts a selected video url into markdown embed syntax', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Meta+A');
  await page.locator('[data-markdown-action="video"]').click();

  await expect(page.locator('.cm-content').first()).toContainText('![Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');
  await expect(page.locator('#previewContent .video-embed-iframe')).toBeVisible();
  await expect(page.locator('#previewContent .video-embed-iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('block toolbar switches heading levels and resets back to paragraph text', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, 'Heading');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'heading-1');
  await expect(page.locator('.cm-content').first()).toContainText('# Heading');
  await expect(page.locator('[data-markdown-block-trigger-label]')).toHaveText('H1');

  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'heading-3');
  await expect(page.locator('.cm-content').first()).toContainText('### Heading');
  await expect(page.locator('[data-markdown-block-trigger-label]')).toHaveText('H3');

  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'paragraph');
  await expect(page.locator('.cm-content').first()).toContainText('Heading');
  await expect(page.locator('.cm-content').first()).not.toContainText('# Heading');
  await expect(page.locator('[data-markdown-block-trigger-label]')).toHaveText('P');
});

test('block toolbar converts bullet lists to numbered lists without duplicating markers', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, 'alpha\nbeta');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'bullet-list');
  await expect(page.locator('.cm-content').first()).toContainText('- alpha');
  await expect(page.locator('.cm-content').first()).toContainText('- beta');

  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'numbered-list');
  await expect(page.locator('.cm-content').first()).toContainText('1. alpha');
  await expect(page.locator('.cm-content').first()).toContainText('2. beta');
  await expect(page.locator('.cm-content').first()).not.toContainText('1. - alpha');
});

test('image toolbar uploads a vault attachment and inserts inline markdown', async ({ page }) => {
  await openFile(page, 'README.md');
  await waitForCollaborativeEditor(page);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPgF9f6D8IMMAYAKWgFPch3sv8AAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
    name: 'inline-diagram.png',
  });

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toMatch(/!\[inline diagram\]\(assets\/inline-diagram-[^)]+\.webp\)/i);

  await expect(page.locator('#fileTree')).toContainText('assets');
  const uploadedImage = page.locator('#previewContent img[src$=".webp"]');
  await expect(uploadedImage).toBeVisible();
  await expect(uploadedImage).toHaveAttribute(
    'src',
    /\/api\/attachment\?path=assets%2Finline-diagram-[^?]+\.webp/,
  );

  const uploadedMarkdown = await page.evaluate(async () => {
    const response = await fetch('/api/file?path=README.md');
    const data = await response.json();
    return data.content || '';
  });
  const uploadedPath = uploadedMarkdown.match(/!\[inline diagram\]\((assets\/inline-diagram-[^)]+\.webp)\)/i)?.[1];
  if (!uploadedPath) {
    throw new Error('Expected uploaded image markdown to contain an asset path.');
  }

  await openFile(page, uploadedPath, { waitFor: 'preview' });
  await expect(page.locator('#previewContent .image-file-preview-image')).toBeVisible();
  await expect(page.locator('#backlinksPanel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#backlinksPanel .backlinks-count')).toHaveText('1');
});

test('image lightbox uses a fullscreen stage with click zoom, reset, and close', async ({ page }) => {
  await openFile(page, 'README.md');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0f172a"/><circle cx="24" cy="24" r="10" fill="#f8fafc"/></svg>'),
    mimeType: 'image/svg+xml',
    name: 'lightbox-target.svg',
  });

  const previewImage = page.locator('#previewContent img').first();
  await expect(previewImage).toBeVisible();

  await previewImage.click();
  await expect(page.locator('.image-lightbox-root')).toBeVisible();
  await expect(page.locator('.image-lightbox-toolbar')).toBeVisible();

  const lightboxImage = page.locator('.image-lightbox-image');
  const zoomLabel = page.locator('.image-lightbox-zoom-label');
  await expect(zoomLabel).toHaveText('100%');

  await lightboxImage.click();
  await expect(zoomLabel).toHaveText('200%');

  await page.locator('.image-lightbox-controls').getByText('Reset', { exact: true }).click();
  await expect(zoomLabel).toHaveText('100%');

  await page.locator('.image-lightbox-controls').getByText('Close', { exact: true }).click();
  await expect(page.locator('.image-lightbox-root')).toBeHidden();
});

test('switching from a YouTube markdown preview to an image file clears the video overlay', async ({ page }) => {
  await openFile(page, 'README.md');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0f172a"/><circle cx="24" cy="24" r="10" fill="#f8fafc"/></svg>'),
    mimeType: 'image/svg+xml',
    name: 'preview-switch.svg',
  });

  await replaceEditorContent(page, [
    '# Video Preview',
    '',
    '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
  ].join('\n'));

  await expect(page.locator('#previewContent .video-embed-iframe')).toBeVisible();
  await expect(page.locator('#previewContent [data-video-overlay-root="true"]')).toBeVisible();

  await page.locator('#fileTree').getByText('assets').click();
  await page.locator('#fileTree .file-tree-item', { hasText: 'preview-switch' }).click();

  await expect(page.locator('#previewContent').locator('.image-file-preview-image')).toBeVisible();
  await expect(page.locator('#previewContent .video-embed-iframe')).toHaveCount(0);
  await expect(page.locator('#previewContent [data-video-overlay-root="true"]')).toHaveCount(0);
});

test('pasting an image uploads a vault attachment and inserts inline markdown', async ({ page }) => {
  await openFile(page, 'README.md');
  await waitForCollaborativeEditor(page);

  await pasteClipboardImage(page, {
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPgF9f6D8IMMAYAKWgFPch3sv8AAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
  });

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toMatch(/!\[[^\]]+\]\(assets\/[a-z-]+-[^)]+\.webp\)/i);

  await expect(page.locator('#fileTree')).toContainText('assets');
  const uploadedImage = page.locator('#previewContent img[src$=".webp"]');
  await expect(uploadedImage).toBeVisible();
  await expect(uploadedImage).toHaveAttribute(
    'src',
    /\/api\/attachment\?path=assets%2F[^?]+\.webp/,
  );
});

test('opens a file by clicking the sidebar', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();

  await page.locator('#fileTree .file-tree-dir', { hasText: 'projects' }).first().click();
  await page.locator('#fileTree .file-tree-item', { hasText: 'collabmd' }).first().click();

  await waitForEditor(page);
  await expect(page.locator('#previewContent')).toContainText('CollabMD Project');
  await expect(page.locator('#activeFileName')).toContainText('collabmd');
});

test('quick switcher reveals the opened file in the file tree', async ({ page }) => {
  await openHome(page);

  for (let index = 0; index < 40; index += 1) {
    const padded = String(index).padStart(2, '0');
    const response = await page.request.put('/api/file', {
      data: {
        content: `# note-${padded}\n`,
        path: `zz-folder-${padded}/note-${padded}.md`,
      },
    });
    expect(response.ok()).toBe(true);
  }

  await expect(page.locator('#fileTree')).toContainText('zz-folder-39');
  await expect(page.locator('#fileTree .file-tree-dir[data-path^="zz-folder-"]')).toHaveCount(40);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.locator('#quickSwitcher')).toHaveClass(/visible/);
  await page.locator('#quickSwitcherInput').fill('note-39');
  await page.locator('#quickSwitcherResults .qs-result-item').first().click();

  await waitForEditor(page);

  await expect.poll(async () => page.locator('#fileTree').evaluate((element) => {
    const active = element.querySelector('.file-tree-file.active');
    const activeRect = active?.getBoundingClientRect();
    const treeRect = element.getBoundingClientRect();

    return {
      activePath: active?.getAttribute('data-path') ?? null,
      isVisible: Boolean(
        activeRect
        && activeRect.top >= treeRect.top
        && activeRect.bottom <= treeRect.bottom + 1
      ),
    };
  })).toEqual({
    activePath: 'zz-folder-39/note-39.md',
    isVisible: true,
  });
});

test('quick switcher text search opens a grouped match at the matching line', async ({ page }) => {
  await openHome(page);

  const alphaLines = [
    '# Global Search Alpha',
    '',
    'Context before the target.',
    'Another ordinary line.',
    'Needle-E2E appears in alpha line.',
    'Context after the target.',
  ];
  const betaLines = [
    '# Global Search Beta',
    '',
    'Needle-E2E appears in beta line.',
  ];
  const files = [
    {
      content: `${alphaLines.join('\n')}\n`,
      path: 'search/global-search-alpha.md',
    },
    {
      content: `${betaLines.join('\n')}\n`,
      path: 'search/global-search-beta.md',
    },
    {
      content: '{"type":"excalidraw","elements":[{"text":"Needle-E2E should stay ignored"}]}\n',
      path: 'search/ignored-search-sketch.excalidraw',
    },
  ];

  for (const file of files) {
    const response = await page.request.put('/api/file', { data: file });
    expect(response.ok()).toBe(true);
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.locator('#quickSwitcher')).toHaveClass(/visible/);
  await page.locator('[data-qs-mode="text"]').click();
  await page.locator('#quickSwitcherInput').fill('needle-e2e');

  const results = page.locator('#quickSwitcherResults');
  const alphaGroup = results.locator('.qs-text-group', { hasText: 'global-search-alpha' });
  const betaGroup = results.locator('.qs-text-group', { hasText: 'global-search-beta' });
  await expect(alphaGroup).toBeVisible();
  await expect(betaGroup).toBeVisible();
  await expect(results).not.toContainText('ignored-search-sketch');

  await alphaGroup.locator('.qs-text-item', { hasText: 'Needle-E2E appears in alpha line.' }).click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('global-search-alpha');
  await expect(page.locator('.cm-content').first()).toContainText('Needle-E2E appears in alpha line.');
  await expect(page.locator('#lineInfo')).toContainText('Ln 5');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('file=search%2Fglobal-search-alpha.md');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('line=5');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('column=1');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('matchLength=10');
});

test('creates files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /Markdown note/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create markdown file');

  await page.locator('#fileActionInput').fill('plans/q1-roadmap');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('q1-roadmap');
  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('q1-roadmap');
});

test('creates empty folders from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();

  await page.locator('#fileActionInput').fill('plans/archive');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('archive');
});

test('empty state create uses the shared create picker', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /Markdown note/i, { from: 'empty-state' });
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create markdown file');
});

test('creates draw.io diagrams from the sidebar create picker', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /draw\.io diagram/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create draw.io diagram');

  await page.locator('#fileActionInput').fill('diagrams/system-map');
  await page.locator('#fileActionSubmit').click();

  await waitForPreview(page);
  await expect(page.locator('#activeFileName')).toContainText('system-map');
  await expect(page.locator('#fileTree')).toContainText('system-map');
});

test('creates files inside a folder from the tree context menu', async ({ page }) => {
  await openHome(page);

  const dailyFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first();
  await dailyFolder.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'New markdown file' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toContainText('Parent folder: daily');
  await page.locator('#fileActionInput').fill('meeting-notes');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('meeting-notes');
  await expect(page.locator('#fileTree')).toContainText('daily');
  await expect(page.locator('#fileTree')).toContainText('meeting-notes');
});

test('creates root files from empty tree space context menu', async ({ page }) => {
  await openHome(page);

  await page.locator('#fileSearchInput').fill('zzzz-no-match');
  await expect(page.locator('#fileTree')).toContainText('No matches');

  await page.locator('#fileTree').click({ button: 'right', position: { x: 24, y: 24 } });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'New PlantUML diagram' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toHaveAttribute('hidden', '');
  await page.locator('#fileActionInput').fill('quick-diagram');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('quick-diagram');

  await page.locator('#fileSearchInput').fill('');
  await expect(page.locator('#fileTree')).toContainText('quick-diagram');
});

test('moves and deletes files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /Markdown note/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await page.locator('#fileActionInput').fill('scratchpad');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  const scratchpadItem = page.locator('#fileTree .file-tree-item', { hasText: 'scratchpad' }).first();
  await scratchpadItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Rename / move' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionLabel')).toHaveText('Path');
  await page.locator('#fileActionInput').fill('notes/release-notes');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#activeFileName')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).not.toContainText('scratchpad');
  await expect(page.locator('#fileTree')).toContainText('notes');

  const renamedItem = page.locator('#fileTree .file-tree-item', { hasText: 'release-notes' }).first();
  await renamedItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionField')).toHaveAttribute('hidden', '');
  await expect(page.locator('#fileActionNote')).toContainText('release-notes.md');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#fileTree')).not.toContainText('release-notes');
});

test('moves files between folders by drag and drop in the sidebar', async ({ page }) => {
  await openHome(page);
  await page.locator('#fileSearchInput').fill('');

  const fileName = `scratchpad-${Date.now()}`;

  await chooseCreateAction(page, /Markdown note/i);
  await page.locator('#fileActionInput').fill(fileName);
  await page.locator('#fileActionSubmit').click();
  await waitForEditor(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('notes');
  await page.locator('#fileActionSubmit').click();

  const sourceFilePath = `${fileName}.md`;
  const movedFilePath = `notes/${fileName}.md`;

  await expect(page.locator(`#fileTree .file-tree-file[data-path="${sourceFilePath}"]`)).toBeVisible();
  await expect(page.locator('#fileTree .file-tree-dir[data-path="notes"]')).toBeVisible();

  let moved = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dragFileTreeFileToDirectory(page, {
      sourceFilePath,
      targetDirectoryPath: 'notes',
    });

    moved = await page.evaluate(async (pathValue) => {
      const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return response.ok;
    }, movedFilePath);
    if (moved) {
      break;
    }

    try {
      await expect.poll(async () => page.evaluate(async (pathValue) => {
        const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
        return response.ok;
      }, movedFilePath), { timeout: 1250 }).toBeTruthy();
      moved = true;
      break;
    } catch {
      // Retry the drag; WebKit/Chromium can occasionally miss the first drop event.
    }
  }

  expect(moved).toBe(true);

  await expect(page.locator('#activeFileName')).toContainText(fileName);
  await expect(page.locator('#fileTree')).toContainText('notes');
  await expect(page.locator('#fileTree')).toContainText(fileName);
  await expect(page.locator('#fileTree .file-tree-file').filter({ hasText: fileName })).toHaveCount(1);
  await expect.poll(async () => (
    page.evaluate(async (pathValue) => {
      const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return response.ok;
    }, movedFilePath)
  ), {
    timeout: 20000,
  }).toBe(true);
});

test('moves files back to the vault root through the root drop target', async ({ page }) => {
  await openHome(page);
  await page.locator('#fileSearchInput').fill('');

  const fileName = `scratchpad-${Date.now()}`;
  const nestedFilePath = `notes/${fileName}.md`;
  const rootFilePath = `${fileName}.md`;

  await chooseCreateAction(page, /Markdown note/i);
  await page.locator('#fileActionInput').fill(`notes/${fileName}`);
  await page.locator('#fileActionSubmit').click();
  await waitForEditor(page);

  await expect(page.locator(`#fileTree .file-tree-file[data-path="${nestedFilePath}"]`)).toBeVisible();

  const rootDropZone = page.locator('#fileTree .file-tree-root-drop-zone');
  await expect(rootDropZone).toBeHidden();

  await page.evaluate((pathValue) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(pathValue)}"]`);
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  }, nestedFilePath);
  await expect(rootDropZone).toBeVisible();
  await page.evaluate((pathValue) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(pathValue)}"]`);
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
  }, nestedFilePath);
  await expect(rootDropZone).toBeHidden();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dragFileTreeFileToRoot(page, { sourceFilePath: nestedFilePath });

    const movedToRoot = await page.evaluate(async (pathValue) => {
      const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return response.ok;
    }, rootFilePath);
    if (movedToRoot) {
      break;
    }

    await page.waitForTimeout(200);
  }

  await expect(page.locator('#activeFileName')).toContainText(fileName);
  await expect.poll(async () => (
    page.evaluate(async ({ nestedPath, rootPath }) => {
      const rootResponse = await fetch(`/api/file?path=${encodeURIComponent(rootPath)}`);
      const nestedResponse = await fetch(`/api/file?path=${encodeURIComponent(nestedPath)}`);
      return JSON.stringify({
        nestedExists: nestedResponse.ok,
        rootExists: rootResponse.ok,
      });
    }, {
      nestedPath: nestedFilePath,
      rootPath: rootFilePath,
    })
  ), {
    timeout: 20000,
  }).toContain('"rootExists":true');
  await expect.poll(async () => (
    page.evaluate(async (pathValue) => {
      const nestedResponse = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return nestedResponse.status;
    }, nestedFilePath)
  ), {
    timeout: 20000,
  }).toBe(404);
});

test('rejects dragging a folder into one of its descendants', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('guides/archive');
  await page.locator('#fileActionSubmit').click();

  const guidesItem = page.locator('#fileTree .file-tree-dir', { hasText: 'guides' }).first();
  const archiveItem = page.locator('#fileTree .file-tree-dir', { hasText: 'archive' }).first();
  await guidesItem.dragTo(archiveItem);

  await expect(page.locator('#fileTree')).toContainText('guides');
  await expect(page.locator('#fileTree')).toContainText('archive');
  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/files');
      const data = await response.json();
      return JSON.stringify(data.tree || []);
    })
  )).toContain('"path":"guides/archive"');
});

test('renames folders from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('drafts-old');
  await page.locator('#fileActionSubmit').click();

  const folderItem = page.locator('#fileTree .file-tree-dir', { hasText: 'drafts-old' }).first();
  await folderItem.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Rename / move' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Rename or move folder');
  await expect(page.locator('#fileActionLabel')).toHaveText('Path');
  await page.locator('#fileActionInput').fill('drafts-new');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('drafts-new');
  await expect(page.locator('#fileTree')).not.toContainText('drafts-old');
});

test('downloads files and directories from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  const fileDownloadPromise = page.waitForEvent('download');
  await page.locator('#fileTree .file-tree-file', { hasText: 'README' }).first().click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Download' }).click();
  const fileDownload = await fileDownloadPromise;
  expect(fileDownload.suggestedFilename()).toBe('README.md');

  const directoryDownloadPromise = page.waitForEvent('download');
  await page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first().click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Download' }).click();
  const directoryDownload = await directoryDownloadPromise;
  expect(directoryDownload.suggestedFilename()).toBe('daily.zip');
});

test('deletes empty folders from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('scratch-empty');
  await page.locator('#fileActionSubmit').click();

  const folderItem = page.locator('#fileTree .file-tree-dir', { hasText: 'scratch-empty' }).first();
  await folderItem.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Delete folder');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).not.toContainText('scratch-empty');
});

test('deletes non-empty folders with an explicit recursive confirmation', async ({ page }) => {
  await openHome(page);

  const dailyFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first();
  await dailyFolder.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Delete folder and contents');
  await expect(page.locator('#fileActionCopy')).toContainText('file');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).not.toContainText('daily');
});

test('search can find folders and open them into the expanded tree', async ({ page }) => {
  await restoreVaultFileFromTemplate(page, 'daily/2026-03-05.md');
  await openHome(page);

  await page.locator('#fileSearchInput').fill('daily');
  await expect(page.locator('#fileTree')).toContainText('daily');

  await page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first().click();

  await expect(page.locator('#fileSearchInput')).toHaveValue('');
  await expect(page.locator('#fileTree')).toContainText('2026-03-05');
});

test('creates and opens unresolved wiki-link targets', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Create\n\nGo to [[notes/new-page]]');
  await expect(page.locator('#previewContent .wiki-link-new')).toHaveCount(1);

  await page.locator('#previewContent .wiki-link-new').first().click();
  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('new-page');
});

test('does not create unresolved wiki-link targets when auto-create is disabled', async ({ page }) => {
  await page.route('**/app-config.js', async (route) => {
    await route.fulfill({
      body: 'window.__COLLABMD_CONFIG__ = {"wikiLinkAutoCreate":false};\n',
      contentType: 'text/javascript; charset=utf-8',
      status: 200,
    });
  });
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Missing\n\nGo to [[notes/hidden-page]]');
  const missingLink = page.locator('#previewContent .wiki-link-new').first();
  await expect(missingLink).toHaveAttribute('title', 'Missing "notes/hidden-page"');

  await missingLink.click();

  await expect(page.locator('#toastContainer')).toContainText('Wiki-link target does not exist');
  await expect(page.locator('#activeFileName')).toContainText('README');

  const response = await page.request.get('/api/file?path=notes%2Fhidden-page.md');
  expect(response.status()).toBe(404);
});

test('redundant hashchange events do not reopen the same markdown file into overlapping sessions', async ({ page }) => {
  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);

  await page.evaluate(() => {
    for (let index = 0; index < 10; index += 1) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });

  await waitForEditor(page);
  await appendEditorContent(page, 'hashchange marker');

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=sample-full.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toContain('hashchange marker');

  const persistedContent = await page.evaluate(async () => {
    const response = await fetch('/api/file?path=sample-full.md');
    const data = await response.json();
    return data.content || '';
  });

  expect((persistedContent.match(/hashchange marker/g) || []).length).toBe(1);
  expect((persistedContent.match(/CollabMD — Technical Design Document/g) || []).length).toBe(1);
});
