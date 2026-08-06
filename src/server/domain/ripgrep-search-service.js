import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { getVaultFileKind } from '../../domain/file-kind.js';
import { logPerfEvent } from '../config/perf-logging.js';

const execFile = promisify(execFileCallback);

const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_SNIPPETS_PER_FILE = 5;
const DEFAULT_MAX_FILE_SIZE = '1M';
const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_QUERY_LENGTH = 2;
const SNIPPET_CONTEXT_CHARS = 90;
const TEXT_SEARCH_GLOBS = Object.freeze([
  '*.md',
  '*.markdown',
  '*.mdx',
  '*.base',
  '*.mmd',
  '*.mermaid',
  '*.puml',
  '*.plantuml',
  '*.drawio',
]);

function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function createEmptySearchResult({
  backend = 'ripgrep',
  query = '',
  searchAvailable = true,
  truncated = false,
} = {}) {
  return {
    backend,
    files: [],
    matchCount: 0,
    ok: true,
    query,
    search: {
      available: searchAvailable,
      backend,
    },
    truncated,
  };
}

function byteOffsetToStringIndex(value = '', byteOffset = 0) {
  const normalizedOffset = Math.max(0, Number(byteOffset) || 0);
  if (normalizedOffset === 0) {
    return 0;
  }

  const text = String(value ?? '');
  let byteCount = 0;
  let stringIndex = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (byteCount + charBytes > normalizedOffset) {
      return stringIndex;
    }
    byteCount += charBytes;
    stringIndex += char.length;
  }

  return text.length;
}

function createSnippet(lineText = '', matchStart = 0, matchEnd = matchStart) {
  const normalizedLine = String(lineText ?? '').replace(/\r?\n$/u, '');
  const safeStart = Math.min(Math.max(Math.round(matchStart), 0), normalizedLine.length);
  const safeEnd = Math.min(Math.max(Math.round(matchEnd), safeStart), normalizedLine.length);
  const snippetStart = Math.max(0, safeStart - SNIPPET_CONTEXT_CHARS);
  const snippetEnd = Math.min(normalizedLine.length, safeEnd + SNIPPET_CONTEXT_CHARS);
  const prefix = snippetStart > 0 ? '...' : '';
  const suffix = snippetEnd < normalizedLine.length ? '...' : '';
  const text = `${prefix}${normalizedLine.slice(snippetStart, snippetEnd)}${suffix}`;
  const prefixLength = prefix.length;

  return {
    matchEnd: prefixLength + (safeEnd - snippetStart),
    matchStart: prefixLength + (safeStart - snippetStart),
    text,
  };
}

function createRipgrepArgs(query, {
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
} = {}) {
  const args = [
    '--json',
    '--fixed-strings',
    '--ignore-case',
    '--line-number',
    '--column',
    '--max-filesize',
    String(maxFileSize || DEFAULT_MAX_FILE_SIZE),
    '--max-count',
    String(Math.max(Number(maxSnippetsPerFile) || DEFAULT_MAX_SNIPPETS_PER_FILE, 1) + 1),
    '--glob',
    '!.git/**',
    '--glob',
    '!.collabmd/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!.obsidian/**',
    '--glob',
    '!.trash/**',
  ];

  TEXT_SEARCH_GLOBS.forEach((glob) => {
    args.push('--glob', glob);
  });

  args.push('--', String(query ?? ''), '.');
  return args;
}

export function parseRipgrepJson(stdout, {
  maxFiles = DEFAULT_MAX_FILES,
  maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
  query = '',
} = {}) {
  const files = [];
  const filesByPath = new Map();
  let matchCount = 0;
  let truncated = false;

  const lines = String(stdout ?? '').split(/\r?\n/u);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event?.type !== 'match') {
      continue;
    }

    const filePath = String(event?.data?.path?.text ?? '').replace(/^\.\//u, '');
    if (!filePath) {
      continue;
    }

    let fileGroup = filesByPath.get(filePath);
    if (!fileGroup) {
      if (files.length >= maxFiles) {
        truncated = true;
        continue;
      }

      fileGroup = {
        file: filePath,
        kind: getVaultFileKind(filePath) ?? 'text',
        matchCount: 0,
        snippets: [],
        truncated: false,
      };
      filesByPath.set(filePath, fileGroup);
      files.push(fileGroup);
    }

    const lineText = String(event?.data?.lines?.text ?? '');
    const lineNumber = Number(event?.data?.line_number) || 1;
    const submatches = Array.isArray(event?.data?.submatches) && event.data.submatches.length > 0
      ? event.data.submatches
      : [{ start: Math.max((Number(event?.data?.column) || 1) - 1, 0), end: Math.max((Number(event?.data?.column) || 1) - 1, 0) + String(query).length }];

    for (const submatch of submatches) {
      fileGroup.matchCount += 1;
      matchCount += 1;

      if (fileGroup.snippets.length >= maxSnippetsPerFile) {
        fileGroup.truncated = true;
        truncated = true;
        continue;
      }

      const matchStart = byteOffsetToStringIndex(lineText, submatch.start);
      const matchEnd = byteOffsetToStringIndex(lineText, submatch.end);
      const snippet = createSnippet(lineText, matchStart, matchEnd);
      fileGroup.snippets.push({
        column: matchStart + 1,
        line: lineNumber,
        matchEnd: snippet.matchEnd,
        matchStart: snippet.matchStart,
        text: snippet.text,
      });
    }
  }

  return {
    ...createEmptySearchResult({ query, truncated }),
    files,
    matchCount,
    truncated,
  };
}

export class RipgrepSearchService {
  constructor({
    execFileImpl = execFile,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxFiles = DEFAULT_MAX_FILES,
    maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
    perfLoggingEnabled = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    vaultDir,
  } = {}) {
    this.execFileImpl = execFileImpl;
    this.maxBufferBytes = maxBufferBytes;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.maxSnippetsPerFile = maxSnippetsPerFile;
    this.perfLoggingEnabled = perfLoggingEnabled;
    this.timeoutMs = timeoutMs;
    this.vaultDir = vaultDir;
    this.available = false;
    this.version = '';
    this.unavailableReason = 'ripgrep has not been checked yet';
  }

  async initialize() {
    try {
      const result = await this.execFileImpl('rg', ['--version'], {
        encoding: 'utf8',
        maxBuffer: 128 * 1024,
        timeout: 3_000,
      });
      this.available = true;
      this.version = String(result.stdout ?? '').split(/\r?\n/u)[0] || 'ripgrep';
      this.unavailableReason = '';
    } catch (error) {
      this.available = false;
      this.version = '';
      this.unavailableReason = error?.code === 'ENOENT'
        ? 'ripgrep is not installed on the server'
        : (error?.message || 'ripgrep is unavailable');
    }

    logPerfEvent(this.perfLoggingEnabled, 'search-capability', {
      available: this.available,
      backend: 'ripgrep',
      version: this.version,
    });

    return this.getClientConfig();
  }

  getClientConfig() {
    return {
      available: this.available,
      backend: 'ripgrep',
      minQueryLength: MIN_QUERY_LENGTH,
      unavailableReason: this.unavailableReason,
      version: this.version,
    };
  }

  async search({
    limit = DEFAULT_MAX_FILES,
    query = '',
  } = {}) {
    const normalizedQuery = String(query ?? '').trim();
    const maxFiles = normalizePositiveInt(limit, this.maxFiles, {
      max: this.maxFiles,
      min: 1,
    });

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      return createEmptySearchResult({
        query: normalizedQuery,
        searchAvailable: this.available,
      });
    }

    if (!this.available) {
      const error = new Error('Global text search requires ripgrep on the server.');
      error.statusCode = 503;
      error.search = this.getClientConfig();
      throw error;
    }

    const startedAt = Date.now();
    const args = createRipgrepArgs(normalizedQuery, {
      maxFileSize: this.maxFileSize,
      maxSnippetsPerFile: this.maxSnippetsPerFile,
    });

    try {
      const result = await this.execFileImpl('rg', args, {
        cwd: this.vaultDir,
        encoding: 'utf8',
        maxBuffer: this.maxBufferBytes,
        timeout: this.timeoutMs,
      });
      const parsed = parseRipgrepJson(result.stdout, {
        maxFiles,
        maxSnippetsPerFile: this.maxSnippetsPerFile,
        query: normalizedQuery,
      });
      parsed.search = this.getClientConfig();

      logPerfEvent(this.perfLoggingEnabled, 'search-query', {
        durationMs: Date.now() - startedAt,
        fileCount: parsed.files.length,
        matchCount: parsed.matchCount,
        truncated: parsed.truncated,
      });
      return parsed;
    } catch (error) {
      if (error?.code === 1) {
        const empty = createEmptySearchResult({
          query: normalizedQuery,
          searchAvailable: this.available,
        });
        empty.search = this.getClientConfig();
        logPerfEvent(this.perfLoggingEnabled, 'search-query', {
          durationMs: Date.now() - startedAt,
          fileCount: 0,
          matchCount: 0,
          truncated: false,
        });
        return empty;
      }

      const isMaxBuffer = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      const parsed = parseRipgrepJson(error?.stdout ?? '', {
        maxFiles,
        maxSnippetsPerFile: this.maxSnippetsPerFile,
        query: normalizedQuery,
      });
      if (isMaxBuffer && parsed.files.length > 0) {
        parsed.search = this.getClientConfig();
        parsed.truncated = true;
        logPerfEvent(this.perfLoggingEnabled, 'search-query', {
          durationMs: Date.now() - startedAt,
          fileCount: parsed.files.length,
          matchCount: parsed.matchCount,
          truncated: true,
        });
        return parsed;
      }

      error.statusCode = error?.signal === 'SIGTERM' ? 504 : 500;
      throw error;
    }
  }
}
