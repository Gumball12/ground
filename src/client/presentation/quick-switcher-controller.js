import { stripVaultFileExtension } from '../../domain/file-kind.js';
import { escapeHtml } from '../domain/vault-utils.js';
import {
  DEFAULT_SEARCH_DEBOUNCE_MS,
  QuickSwitcherTextSearchRunner,
  flattenTextResults,
  formatMatchCount,
} from './quick-switcher-text-search.js';

const MAX_VISIBLE_RESULTS = 12;

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

export class QuickSwitcherController {
  constructor({
    getFileList,
    getSearchConfig = () => ({}),
    onFileSelect,
    onTextMatchSelect = null,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
    searchText = null,
  }) {
    this.getFileList = getFileList;
    this.getSearchConfig = getSearchConfig;
    this.onFileSelect = onFileSelect;
    this.onTextMatchSelect = onTextMatchSelect;
    this.searchDebounceMs = searchDebounceMs;
    this.searchText = searchText;

    this.overlay = document.getElementById('quickSwitcher');
    this.input = document.getElementById('quickSwitcherInput');
    this.resultsList = document.getElementById('quickSwitcherResults');
    this.hint = document.getElementById('quickSwitcherHint');
    this.modeTabs = Array.from(document.querySelectorAll?.('[data-qs-mode]') ?? []);

    this.filteredFiles = [];
    this.fileCorpus = [];
    this.lastFileListRef = null;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.isOpen = false;
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

    this.isOpen = true;
    this.input.value = '';
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.overlay.classList.add('visible');
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

  close() {
    if (!this.overlay) return;

    this._cancelPendingFocus();
    this.abortTextSearch();
    this.isOpen = false;
    this.overlay.classList.remove('visible');
    this.input.value = '';
    this.resultsList.innerHTML = '';
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

    if (this.input) {
      this.input.placeholder = normalizedMode === 'text'
        ? 'Search text in files...'
        : 'Search files...';
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
    }

    if (!query) {
      this.filteredFiles = this.fileCorpus
        .slice(0, MAX_VISIBLE_RESULTS)
        .map((entry) => entry.filePath);
    } else {
      const ranked = [];
      this.fileCorpus.forEach((entry) => {
        const score = this.fuzzyScore(entry, query);
        if (score <= 0) {
          return;
        }

        const rankedEntry = { filePath: entry.filePath, score };
        let inserted = false;
        for (let index = 0; index < ranked.length; index += 1) {
          const current = ranked[index];
          if (score > current.score || (score === current.score && entry.lowerPath < String(current.filePath).toLowerCase())) {
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
    }

    this.selectedIndex = 0;
    this.renderResults(query);
  }

  fuzzyScore(entry, query) {
    const name = entry.lowerDisplayName;
    const nameOnly = entry.lowerFileName;

    if (nameOnly.includes(query)) return 100 + (1 / nameOnly.length);
    if (name.includes(query)) return 50 + (1 / name.length);

    let queryIndex = 0;
    let score = 0;
    let consecutiveBonus = 0;

    for (let i = 0; i < name.length && queryIndex < query.length; i++) {
      if (name[i] === query[queryIndex]) {
        queryIndex++;
        consecutiveBonus += 1;
        score += consecutiveBonus;

        if (i === 0 || name[i - 1] === '/' || name[i - 1] === '-' || name[i - 1] === '_' || name[i - 1] === ' ') {
          score += 5;
        }
      } else {
        consecutiveBonus = 0;
      }
    }

    return queryIndex === query.length ? score : 0;
  }

  renderResults(query) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    if (this.filteredFiles.length === 0) {
      if (this.hint) {
        this.hint.textContent = query ? 'No files found' : 'No files in vault';
        this.hint.classList.remove('hidden');
      }
      return;
    }

    if (this.hint) {
      this.hint.classList.add('hidden');
    }

    const fragment = document.createDocumentFragment();

    this.filteredFiles.forEach((filePath, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'qs-result-item';
      if (index === this.selectedIndex) {
        item.classList.add('selected');
      }
      item.dataset.index = String(index);

      const fileName = getFileName(filePath);
      const dirPath = getDirPath(filePath);

      item.innerHTML = `
        <svg class="qs-result-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="qs-result-name">${this.highlightMatch(fileName, query)}</span>
        ${dirPath ? `<span class="qs-result-path">${escapeHtml(dirPath)}</span>` : ''}
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
  }

  highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);

    if (idx >= 0) {
      const before = text.slice(0, idx);
      const match = text.slice(idx, idx + query.length);
      const after = text.slice(idx + query.length);
      return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
    }

    let result = '';
    let queryIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (queryIdx < query.length && text[i].toLowerCase() === query[queryIdx]) {
        result += `<mark>${escapeHtml(text[i])}</mark>`;
        queryIdx++;
      } else {
        result += escapeHtml(text[i]);
      }
    }
    return result;
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
    if (this.hint) {
      this.hint.textContent = message;
      this.hint.classList.remove('hidden');
    }
  }

  renderTextResults(query = '') {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    if (!this.textResults?.files?.length || this.textResultItems.length === 0) {
      this.renderTextState(query ? 'No text matches found' : 'Type to search file text');
      return;
    }

    if (this.hint) {
      this.hint.classList.toggle('hidden', !this.textResults.truncated);
      this.hint.textContent = this.textResults.truncated
        ? 'Showing the first matches. Refine the query to narrow results.'
        : '';
    }

    const fragment = document.createDocumentFragment();
    let flatIndex = 0;

    this.textResults.files.forEach((fileGroup) => {
      const group = document.createElement('section');
      group.className = 'qs-text-group';

      const header = document.createElement('div');
      header.className = 'qs-text-group-header';
      header.innerHTML = `
        <span class="qs-text-file-name">${escapeHtml(getFileName(fileGroup.file))}</span>
        <span class="qs-text-file-meta">${escapeHtml(getDirPath(fileGroup.file))}</span>
        <span class="qs-text-count">${escapeHtml(formatMatchCount(fileGroup.matchCount))}</span>
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
        item.classList.toggle('selected', i === this.selectedTextIndex);
      });
      items[this.selectedTextIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    const items = this.resultsList.querySelectorAll('.qs-result-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });

    items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  confirmSelection() {
    if (this.mode === 'text') {
      const match = this.textResultItems[this.selectedTextIndex];
      if (match) {
        this.close();
        this.onTextMatchSelect?.(match);
      }
      return;
    }

    const filePath = this.filteredFiles[this.selectedIndex];
    if (filePath) {
      this.close();
      this.onFileSelect?.(filePath);
    }
  }
}
