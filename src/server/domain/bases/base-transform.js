import { dump as dumpYaml } from 'js-yaml';

import {
  findView,
  normalizeBaseDefinition,
  normalizeRawDefinitionForWrite,
  parseBaseSource,
} from './base-definition.js';

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function cloneRawSource(source = '') {
  const parsed = parseBaseSource(source);
  return isPlainObject(parsed) ? parsed : {};
}

function ensureViews(rawDefinition) {
  if (!Array.isArray(rawDefinition.views) || rawDefinition.views.length === 0) {
    rawDefinition.views = [{ name: 'Table', type: 'table' }];
  }

  return rawDefinition.views;
}

function findViewIndex(definition, requestedView = '') {
  const activeView = findView(definition, requestedView);
  return definition.views.findIndex((view) => view.id === activeView.id);
}

function serializeGroupBy(groupBy) {
  if (!groupBy?.property) {
    return null;
  }

  return {
    direction: String(groupBy.direction ?? 'asc').toUpperCase(),
    property: groupBy.property,
  };
}

function serializeSort(sort = []) {
  return sort
    .filter((entry) => entry?.property)
    .map((entry) => ({
      direction: String(entry.direction ?? 'asc').toUpperCase(),
      property: entry.property,
    }));
}

function applySetViewConfig(rawDefinition, definition, mutation = {}) {
  const viewIndex = findViewIndex(definition, mutation.view ?? '');
  if (viewIndex < 0) {
    throw new Error('Base view not found');
  }

  const rawViews = ensureViews(rawDefinition);
  const nextView = isPlainObject(rawViews[viewIndex])
    ? { ...rawViews[viewIndex] }
    : {};
  const nextConfig = isPlainObject(mutation.config) ? mutation.config : {};

  if (Object.hasOwn(nextConfig, 'order')) {
    nextView.order = Array.isArray(nextConfig.order)
      ? nextConfig.order.filter((entry) => typeof entry === 'string' && entry.trim())
      : [];
  }

  if (Object.hasOwn(nextConfig, 'sort')) {
    const sort = serializeSort(nextConfig.sort);
    if (sort.length > 0) {
      nextView.sort = sort;
    } else {
      delete nextView.sort;
      delete nextView.sorts;
    }
  }

  if (Object.hasOwn(nextConfig, 'groupBy')) {
    const groupBy = serializeGroupBy(nextConfig.groupBy);
    if (groupBy) {
      nextView.groupBy = groupBy;
    } else {
      delete nextView.groupBy;
      delete nextView.group_by;
    }
  }

  if (Object.hasOwn(nextConfig, 'filters')) {
    if (nextConfig.filters == null || nextConfig.filters === '') {
      delete nextView.filters;
    } else {
      nextView.filters = nextConfig.filters;
    }
  }

  rawViews[viewIndex] = nextView;
}

export function transformBaseSource(source = '', mutation = {}) {
  const definition = normalizeBaseDefinition(source);
  const rawDefinition = normalizeRawDefinitionForWrite({
    raw: cloneRawSource(source),
  });
  const mutationType = String(mutation?.type ?? '');

  switch (mutationType) {
    case 'set-view-config':
      applySetViewConfig(rawDefinition, definition, mutation);
      break;
    default:
      throw new Error(`Unsupported base mutation: ${mutationType || 'unknown'}`);
  }

  return `${dumpYaml(normalizeRawDefinitionForWrite(rawDefinition), { lineWidth: -1, noRefs: true }).trim()}\n`;
}
