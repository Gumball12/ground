import { dump as dumpYaml } from 'js-yaml';

import { escapeHtml } from '../domain/vault-utils.js';

export { extractYamlFrontmatter } from '../../domain/yaml-frontmatter.js';

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isScalarValue(value) {
  return (
    value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value instanceof Date
  );
}

function formatScalarValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value == null) {
    return 'null';
  }

  return String(value);
}

function serializeComplexValue(value) {
  return dumpYaml(value, {
    lineWidth: -1,
    noRefs: true,
  }).trim();
}

function createFrontmatterValueMarkup(value) {
  if (isScalarValue(value)) {
    return `<span class="frontmatter-value-text">${escapeHtml(formatScalarValue(value))}</span>`;
  }

  if (Array.isArray(value) && value.every((item) => isScalarValue(item))) {
    return `<div class="frontmatter-value-list">${value
      .map((item) => `<span class="frontmatter-value-pill">${escapeHtml(formatScalarValue(item))}</span>`)
      .join('')}</div>`;
  }

  return `<pre class="frontmatter-value-code"><code>${escapeHtml(serializeComplexValue(value))}</code></pre>`;
}

function createFrontmatterEntries(data) {
  if (isPlainObject(data)) {
    return Object.entries(data);
  }

  return [['value', data]];
}

function createHiddenSummary(entries) {
  if (entries.length === 0) {
    return 'No properties';
  }

  return `${entries.length} propert${entries.length === 1 ? 'y' : 'ies'} hidden`;
}

export function renderFrontmatterBlock(frontmatter, {
  collapsed = false,
  interactive = false,
} = {}) {
  if (!frontmatter) {
    return '';
  }

  const entries = createFrontmatterEntries(frontmatter.data);
  const collapsedState = interactive && collapsed;
  const sourceAttributes = ` data-source-line="${frontmatter.startLine}" data-source-line-end="${frontmatter.endLine}"${interactive ? ` data-collapsed="${collapsedState ? 'true' : 'false'}"` : ''}`;
  const bodyId = `frontmatter-body-${frontmatter.startLine}-${frontmatter.endLine}`;
  const emptyState = entries.length === 0
    ? '<div class="frontmatter-empty">No properties</div>'
    : '';
  const items = entries.map(([key, value]) => (
    `<div class="frontmatter-property"><dt class="frontmatter-key">${escapeHtml(key)}</dt><dd class="frontmatter-value">${createFrontmatterValueMarkup(value)}</dd></div>`
  )).join('');
  const header = interactive
    ? `<div class="frontmatter-header"><div class="frontmatter-label">Properties</div><button type="button" class="frontmatter-toggle" aria-controls="${bodyId}" aria-expanded="${collapsedState ? 'false' : 'true'}">${collapsedState ? 'Show' : 'Hide'}</button></div>`
    : '<div class="frontmatter-label">Properties</div>';
  const summary = interactive
    ? `<div class="frontmatter-summary"${collapsedState ? '' : ' hidden'}>${escapeHtml(createHiddenSummary(entries))}</div>`
    : '';
  const bodyAttributes = ` class="frontmatter-content"${interactive ? ` id="${bodyId}"` : ''}${collapsedState ? ' hidden' : ''}`;

  return `<section class="frontmatter-block"${sourceAttributes}>${header}${summary}<div${bodyAttributes}><dl class="frontmatter-properties">${items}</dl>${emptyState}</div></section>`;
}
