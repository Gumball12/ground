import { stripVaultFileExtension } from '../../domain/file-kind.js';
import { escapeHtml } from '../domain/vault-utils.js';
import {
  DEFAULT_SEARCH_DEBOUNCE_MS,
  QuickSwitcherTextSearchRunner,
  flattenTextResults,
  formatMatchCount,
} from './quick-switcher-text-search.js';

const MAX_VISIBLE_RESULTS = 30;
const NO_RECENT_FILE_RANK = Number.MAX_SAFE_INTEGER;
const FILE_RESULT_ID_PREFIX = 'quick-switcher-file-';
const TEXT_RESULT_ID_PREFIX = 'quick-switcher-text-';

function getRawFileName(filePath) {
  return String(filePath ?? '').split('/').pop() || String(filePath ?? '');
}

function createCorpusEntry(filePath) {
  const displayName = stripVaultFileExtension(filePath);
  const fileName = displayName.split('/').pop() || displayName;

  return {
    displayName,
    fileName,
    filePath,
    lowerDisplayName: displayName.toLowerCase(),
    lowerFileName: fileName.toLowerCase(),
    lowerPath: String(filePath).toLowerCase(),
  };
}

function getFileName(filePath) {
  const displayName = stripVaultFileExtension(filePath);
  return displayName.split('/').pop() || displayName;
}

function getDirPath(filePath) {
  const displayName = stripVaultFileExtension(filePath);
  return displayName.includes('/') ? displayName.substring(0, displayName.lastIndexOf('/')) : '';
}

function createRangeIndices(start, length) {
  return Array.from({ length }, (_, index) => start + index);
}

function findFuzzyMatch(text, query) {
  const indices = [];
  let queryIndex = 0;
  let score = 0;
  let consecutiveBonus = 0;

  for (let index = 0; index < text.length && queryIndex < query.length; index += 1) {
    if (text[index] !== query[queryIndex]) {
      consecutiveBonus = 0;
      continue;
    }

    queryIndex += 1;
    indices.push(index);
    consecutiveBonus += 1;
    score += consecutiveBonus;

    if (
      index === 0
      || text[index - 1] === '/'
      || text[index - 1] === '-'
      || text[index - 1] === '_'
      || text[index - 1] === ' '
    ) {
      score += 5;
    }
  }

  return queryIndex === query.length && score > 0
    ? { indices, score }
    : null;
}

function findCorpusMatch(entry, query) {
  const fileIndex = entry.lowerFileName.indexOf(query);
  if (fileIndex >= 0) {
    return {
      indices: createRangeIndices(fileIndex + (entry.displayName.length - entry.fileName.length), query.length),
      score: 100 + (1 / entry.fileName.length),
    };
  }

  const pathIndex = entry.lowerDisplayName.indexOf(query);
  if (pathIndex >= 0) {
    return {
      indices: createRangeIndices(pathIndex, query.length),
      score: 50 + (1 / entry.displayName.length),
    };
  }

  return findFuzzyMatch(entry.lowerDisplayName, query);
}

function splitMatchIndices(entry, indices = []) {
  const fileNameStart = entry.displayName.length - entry.fileName.length;
  return {
    dirPath: indices.filter((index) => index < fileNameStart),
    fileName: indices
      .filter((index) => index >= fileNameStart)
      .map((index) => index - fileNameStart),
  };
}

function highlightText(text, indices = []) {
  if (indices.length === 0) {
    return escapeHtml(text);
  }

  const matchedIndices = new Set(indices);
  let result = '';
  let runStart = null;
  let cursor = 0;

  const appendRun = (runEnd) => {
    result += escapeHtml(text.slice(cursor, runStart));
    result += `<mark>${escapeHtml(text.slice(runStart, runEnd + 1))}</mark>`;
    cursor = runEnd + 1;
    runStart = null;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (!matchedIndices.has(index)) {
      if (runStart !== null) {
        appendRun(index - 1);
      }
      continue;
    }

    if (runStart === null) {
      runStart = index;
    }
  }

  if (runStart !== null) {
    appendRun(text.length - 1);
  }

  result += escapeHtml(text.slice(cursor));
  return result;
}

export class QuickSwitcherController {
  constructor({
    getFileList,
    getFileMetadata = () => [],
    getRecentFiles = () => [],
    getSearchConfig = () => ({}),
    onFileSelect,
    onTextMatchSelect = null,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
    searchText = null,
  }) {
    this.getFileList = getFileList;
    this.getFileMetadata = getFileMetadata;
    this.getRecentFiles = getRecentFiles;
    this.getSearchConfig = getSearchConfig;
    this.onFileSelect = onFileSelect;
    this.onTextMatchSelect = onTextMatchSelect;
    this.searchDebounceMs = searchDebounceMs;
    this.searchText = searchText;

    this.overlay = document.getElementById('quickSwitcher');
    this.input = document.getElementById('quickSwitcherInput');
    this.resultsList = document.getElementById('quickSwitcherResults');
    this.hint = document.getElementById('quickSwitcherHint');
    this.scope = document.getElementById('quickSwitcherScope');
    this.modeTabs = Array.from(document.querySelectorAll?.('[data-qs-mode]') ?? []);

    this.filteredFiles = [];
    this.fileMatches = new Map();
    this.fileNameCounts = new Map();
    this.fileMatchCount = 0;
    this.fileResultsTruncated = false;
    this.fileCorpus = [];
    this.lastFileListRef = null;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.isOpen = false;
    this.previousActiveElement = null;
    this.mode = 'files';
    this.textResults = null;
    this.textResultItems = [];
    this.textSearchRunner = new QuickSwitcherTextSearchRunner({
      debounceMs: this.searchDebounceMs,
    });

    this.bindEvents();
  }

  bindEvents() {
    this.overlay?.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.modeTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.setMode(tab.dataset.qsMode === 'text' ? 'text' : 'files', { preserveInput: true });
      });
    });

    this.input?.addEventListener('input', () => {
      this.handleInput();
    });

    this.input?.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          this.confirmSelection();
          break;
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
        case 'Tab':
          e.preventDefault();
          if (this.modeTabs.length > 1 && !e.shiftKey) {
            this.setMode(this.mode === 'files' ? 'text' : 'files', { preserveInput: true });
          } else {
            this.moveSelection(e.shiftKey ? -1 : 1);
          }
          break;
      }
    });
  }

  open() {
    if (!this.overlay) return;

    this.previousActiveElement = document.activeElement;
    this.isOpen = true;
    this.input.value = '';
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.setMode('files', { preserveInput: true });

    // The overlay transitions visibility hidden→visible over 120ms.
    // Browsers ignore .focus() while the element is still visibility:hidden,
    // so we must wait for the transition to complete.
    this._focusAfterTransition();
  }

  /** Focus the input once the overlay visibility transition finishes. */
  _focusAfterTransition() {
    this._cancelPendingFocus();

    const tryFocus = () => {
      this._focusCleanup = null;
      this.input?.focus();
      if (this.isOpen && this.input && document.activeElement !== this.input) {
        setTimeout(() => this.input?.focus(), 50);
      }
    };

    const onEnd = (e) => {
      if (e.propertyName === 'visibility' || e.propertyName === 'opacity') {
        this.overlay.removeEventListener('transitionend', onEnd);
        clearTimeout(fallbackTimer);
        tryFocus();
      }
    };
    this.overlay.addEventListener('transitionend', onEnd);

    const fallbackTimer = setTimeout(() => {
      this.overlay.removeEventListener('transitionend', onEnd);
      tryFocus();
    }, 160);

    this._focusCleanup = () => {
      this.overlay.removeEventListener('transitionend', onEnd);
      clearTimeout(fallbackTimer);
    };
  }

  _cancelPendingFocus() {
    if (this._focusCleanup) {
      this._focusCleanup();
      this._focusCleanup = null;
    }
  }

  close({ restoreFocus = true } = {}) {
    if (!this.overlay) return;

    const previousActiveElement = this.previousActiveElement;
    this._cancelPendingFocus();
    this.abortTextSearch();
    this.isOpen = false;
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.input.value = '';
    this.resultsList.innerHTML = '';
    this.setActiveDescendant('');
    this.previousActiveElement = null;

    if (restoreFocus) {
      previousActiveElement?.focus?.();
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  setMode(mode = 'files', { preserveInput = false } = {}) {
    const normalizedMode = mode === 'text' ? 'text' : 'files';
    this.mode = normalizedMode;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;

    if (!preserveInput && this.input) {
      this.input.value = '';
    }

    this.modeTabs.forEach((tab) => {
      const isActive = tab.dataset.qsMode === normalizedMode;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    this.scope?.classList.toggle('hidden', normalizedMode !== 'text');
    this.scope?.setAttribute('aria-hidden', normalizedMode === 'text' ? 'false' : 'true');

    if (this.input) {
      this.input.placeholder = normalizedMode === 'text'
        ? 'Search text in files...'
        : 'Search files...';
      this.input.setAttribute(
        'aria-label',
        normalizedMode === 'text' ? 'Search text in files' : 'Search files',
      );
    }

    this.handleInput();
  }

  handleInput() {
    if (this.mode === 'text') {
      this.scheduleTextSearch();
      return;
    }

    this.abortTextSearch();
    this.filterFiles();
  }

  filterFiles() {
    const query = this.input?.value.trim().toLowerCase() ?? '';
    const allFiles = this.getFileList?.() ?? [];
    if (allFiles !== this.lastFileListRef) {
      this.lastFileListRef = allFiles;
      this.fileCorpus = allFiles.map((filePath) => createCorpusEntry(filePath));
      this.fileNameCounts = new Map();
      this.fileCorpus.forEach((entry) => {
        const count = this.fileNameCounts.get(entry.lowerFileName) ?? 0;
        this.fileNameCounts.set(entry.lowerFileName, count + 1);
      });
    }

    this.fileMatches.clear();
    const fileMetadata = this.getFileMetadata?.() ?? [];
    const modifiedTimes = new Map(
      (Array.isArray(fileMetadata) ? fileMetadata : []).map((entry) => [
        entry?.path,
        Number.isFinite(Number(entry?.mtimeMs)) ? Number(entry.mtimeMs) : 0,
      ]),
    );
    const recentFiles = this.getRecentFiles?.() ?? [];
    const recentRanks = new Map(
      (Array.isArray(recentFiles) ? recentFiles : []).map((filePath, index) => [filePath, index]),
    );
    if (!query) {
      this.filteredFiles = [...this.fileCorpus]
        .sort((left, right) => {
          const modifiedDelta = (modifiedTimes.get(right.filePath) ?? 0) - (modifiedTimes.get(left.filePath) ?? 0);
          if (modifiedDelta !== 0) {
            return modifiedDelta;
          }

          return (recentRanks.get(left.filePath) ?? NO_RECENT_FILE_RANK)
            - (recentRanks.get(right.filePath) ?? NO_RECENT_FILE_RANK);
        })
        .slice(0, MAX_VISIBLE_RESULTS)
        .map((entry) => entry.filePath);
      this.fileMatchCount = this.fileCorpus.length;
    } else {
      const ranked = [];
      let fileMatchCount = 0;
      this.fileCorpus.forEach((entry) => {
        const match = findCorpusMatch(entry, query);
        if (!match) {
          return;
        }

        fileMatchCount += 1;
        this.fileMatches.set(entry.filePath, match);
        const rankedEntry = {
          filePath: entry.filePath,
          recentRank: recentRanks.get(entry.filePath) ?? NO_RECENT_FILE_RANK,
          score: match.score,
        };
        let inserted = false;
        for (let index = 0; index < ranked.length; index += 1) {
          const current = ranked[index];
          const isBetter = rankedEntry.score > current.score
            || (
              rankedEntry.score === current.score
              && (
                rankedEntry.recentRank < current.recentRank
                || (
                  rankedEntry.recentRank === current.recentRank
                  && entry.lowerPath < String(current.filePath).toLowerCase()
                )
              )
            );
          if (isBetter) {
            ranked.splice(index, 0, rankedEntry);
            inserted = true;
            break;
          }
        }

        if (!inserted && ranked.length < MAX_VISIBLE_RESULTS) {
          ranked.push(rankedEntry);
        }

        if (ranked.length > MAX_VISIBLE_RESULTS) {
          ranked.length = MAX_VISIBLE_RESULTS;
        }
      });

      this.filteredFiles = ranked.map((entry) => entry.filePath);
      this.fileMatchCount = fileMatchCount;
    }

    this.fileResultsTruncated = this.fileMatchCount > MAX_VISIBLE_RESULTS;
    this.selectedIndex = 0;
    this.renderResults(query);
  }

  renderResults(query) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    if (this.filteredFiles.length === 0) {
      this.setActiveDescendant('');
      if (this.hint) {
        this.hint.textContent = query ? 'No files found' : 'No files in vault';
        this.hint.classList.remove('hidden');
      }
      return;
    }

    if (this.hint) {
      const hint = this.fileResultsTruncated
        ? query
          ? `Showing the top ${MAX_VISIBLE_RESULTS} of ${this.fileMatchCount} matches. Refine the query to narrow results.`
          : `Showing the first ${MAX_VISIBLE_RESULTS} of ${this.fileMatchCount} files.`
        : '';
      this.hint.textContent = hint;
      this.hint.classList.toggle('hidden', !hint);
    }

    const fragment = document.createDocumentFragment();

    this.filteredFiles.forEach((filePath, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'qs-result-item';
      if (index === this.selectedIndex) {
        item.classList.add('selected');
      }
      item.id = `${FILE_RESULT_ID_PREFIX}${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
      item.dataset.index = String(index);

      const fileName = getFileName(filePath);
      const rawFileName = getRawFileName(filePath);
      const dirPath = getDirPath(filePath);
      const match = this.fileMatches.get(filePath);
      const corpusEntry = this.fileCorpus.find((entry) => entry.filePath === filePath);
      const matchIndices = corpusEntry ? splitMatchIndices(corpusEntry, match?.indices) : { dirPath: [], fileName: [] };
      const displayFileName = (this.fileNameCounts.get(fileName.toLowerCase()) ?? 0) > 1
        ? rawFileName
        : fileName;

      item.innerHTML = `
        <svg class="qs-result-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="qs-result-name">${highlightText(displayFileName, matchIndices.fileName)}</span>
        ${dirPath ? `<span class="qs-result-path">${highlightText(dirPath, matchIndices.dirPath)}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        this.selectedIndex = index;
        this.confirmSelection();
      });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      fragment.appendChild(item);
    });

    this.resultsList.appendChild(fragment);
    this.updateSelection();
  }

  abortTextSearch({ invalidate = true } = {}) {
    this.textSearchRunner.abort({ invalidate });
  }

  scheduleTextSearch() {
    const query = this.input?.value.trim() ?? '';
    const searchConfig = this.getSearchConfig?.() ?? {};

    this.textResults = null;
    this.textResultItems = [];
    this.textSearchRunner.schedule({
      isActive: () => this.isOpen && this.mode === 'text',
      onResults: (result, searchedQuery) => {
        this.textResults = result;
        this.textResultItems = flattenTextResults(result);
        this.selectedTextIndex = 0;
        this.renderTextResults(searchedQuery);
      },
      onState: (message) => this.renderTextState(message),
      query,
      searchConfig,
      searchText: this.searchText,
    });
  }

  renderTextState(message) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';
    this.resultsList.setAttribute('aria-busy', message === 'Searching...' ? 'true' : 'false');
    this.setActiveDescendant('');
    if (this.hint) {
      this.hint.textContent = message;
      this.hint.classList.remove('hidden');
    }
  }

  renderTextResults(query = '') {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';
    this.resultsList.setAttribute('aria-busy', 'false');

    if (!this.textResults?.files?.length || this.textResultItems.length === 0) {
      this.setActiveDescendant('');
      this.renderTextState(query ? 'No text matches found' : 'Type to search file text');
      return;
    }

    if (this.hint) {
      const hint = this.textResults.truncated
        ? `Showing partial results: ${this.textResults.files.length} files and ${formatMatchCount(this.textResults.matchCount, { truncated: true })}. Refine the query to narrow results.`
        : '';
      this.hint.textContent = hint;
      this.hint.classList.toggle('hidden', !hint);
    }

    const fragment = document.createDocumentFragment();
    let flatIndex = 0;

    this.textResults.files.forEach((fileGroup) => {
      const group = document.createElement('section');
      group.className = 'qs-text-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', fileGroup.file);

      const header = document.createElement('div');
      header.className = 'qs-text-group-header';
      header.innerHTML = `
        <span class="qs-text-file-name">${escapeHtml(getFileName(fileGroup.file))}</span>
        <span class="qs-text-file-meta">${escapeHtml(getDirPath(fileGroup.file))}</span>
        <span class="qs-text-count">${escapeHtml(formatMatchCount(fileGroup.matchCount, { truncated: fileGroup.truncated }))}</span>
      `;
      group.appendChild(header);

      (fileGroup.snippets ?? []).forEach((snippet) => {
        const itemIndex = flatIndex;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qs-text-item';
        if (itemIndex === this.selectedTextIndex) {
          item.classList.add('selected');
        }
        item.id = `${TEXT_RESULT_ID_PREFIX}${itemIndex}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', itemIndex === this.selectedTextIndex ? 'true' : 'false');
        item.dataset.textIndex = String(itemIndex);
        item.innerHTML = `
          <span class="qs-text-line">L${escapeHtml(String(snippet.line ?? 1))}</span>
          <span class="qs-text-snippet">${this.highlightSnippet(snippet)}</span>
        `;
        item.addEventListener('click', () => {
          this.selectedTextIndex = itemIndex;
          this.confirmSelection();
        });
        item.addEventListener('mouseenter', () => {
          this.selectedTextIndex = itemIndex;
          this.updateSelection();
        });
        group.appendChild(item);
        flatIndex += 1;
      });

      fragment.appendChild(group);
    });

    this.resultsList.appendChild(fragment);
    this.updateSelection();
  }

  highlightSnippet(snippet = {}) {
    const text = String(snippet.text ?? '');
    const start = Math.min(Math.max(Number(snippet.matchStart) || 0, 0), text.length);
    const end = Math.min(Math.max(Number(snippet.matchEnd) || start, start), text.length);
    return `${escapeHtml(text.slice(0, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>${escapeHtml(text.slice(end))}`;
  }

  moveSelection(delta) {
    if (this.mode === 'text') {
      if (this.textResultItems.length === 0) return;
      this.selectedTextIndex = (this.selectedTextIndex + delta + this.textResultItems.length) % this.textResultItems.length;
      this.updateSelection();
      return;
    }

    if (this.filteredFiles.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.filteredFiles.length) % this.filteredFiles.length;
    this.updateSelection();
  }

  updateSelection() {
    if (!this.resultsList) return;

    if (this.mode === 'text') {
      const items = this.resultsList.querySelectorAll('.qs-text-item');
      items.forEach((item, i) => {
        const isSelected = i === this.selectedTextIndex;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });
      items[this.selectedTextIndex]?.scrollIntoView({ block: 'nearest' });
      this.setActiveDescendant(items[this.selectedTextIndex]?.id ?? '');
      return;
    }

    const items = this.resultsList.querySelectorAll('.qs-result-item');
    items.forEach((item, i) => {
      const isSelected = i === this.selectedIndex;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
    this.setActiveDescendant(items[this.selectedIndex]?.id ?? '');
  }

  setActiveDescendant(id = '') {
    this.input?.setAttribute('aria-activedescendant', id);
  }

  confirmSelection() {
    if (this.mode === 'text') {
      const match = this.textResultItems[this.selectedTextIndex];
      if (match) {
        this.close({ restoreFocus: false });
        this.onTextMatchSelect?.(match);
      }
      return;
    }

    const filePath = this.filteredFiles[this.selectedIndex];
    if (filePath) {
      this.close({ restoreFocus: false });
      this.onFileSelect?.(filePath);
    }
  }
}
