import { dump as dumpYaml, loadAll as loadAllYaml } from 'js-yaml';

const SUPPORTED_VIEW_TYPES = new Set(['cards', 'list', 'table']);

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function capitalize(value = '') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function normalizeDirection(value, fallback = 'asc') {
  return String(value ?? fallback).toLowerCase() === 'desc' ? 'desc' : 'asc';
}

function normalizeFormulaPropertyId(value = '') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  return normalized.startsWith('formula.')
    ? normalized
    : `formula.${normalized}`;
}

function bareFormulaName(value = '') {
  return normalizeFormulaPropertyId(value).replace(/^formula\./u, '');
}

function normalizeBaseView(rawView, index) {
  const view = isPlainObject(rawView) ? rawView : {};
  const type = typeof view.type === 'string' ? view.type : 'table';
  const name = typeof view.name === 'string' && view.name.trim()
    ? view.name.trim()
    : `${capitalize(type)} ${index + 1}`;
  return {
    extra: Object.entries(view).reduce((acc, [key, value]) => {
      if ([
        'filters',
        'groupBy',
        'group_by',
        'image',
        'limit',
        'name',
        'order',
        'properties',
        'sort',
        'sorts',
        'summaries',
        'type',
      ].includes(key)) {
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {}),
    filters: view.filters ?? null,
    groupBy: normalizeViewGroupBy(view.groupBy ?? view.group_by),
    id: `view-${index}`,
    image: typeof view.image === 'string' ? view.image : null,
    limit: Number.isFinite(Number(view.limit)) ? Math.max(0, Number(view.limit)) : null,
    name,
    order: normalizeViewOrder(view.order ?? view.properties),
    sort: normalizeViewSort(view.sort ?? view.sorts),
    summaries: normalizeSummaries(view.summaries),
    supported: SUPPORTED_VIEW_TYPES.has(type),
    type,
  };
}

function normalizeViewOrder(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (isPlainObject(entry)) {
          return entry.id ?? entry.property ?? entry.name ?? null;
        }
        return null;
      })
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function normalizeViewGroupBy(value) {
  if (typeof value === 'string' && value.trim()) {
    return {
      direction: 'asc',
      explicitDirection: false,
      property: value.trim(),
    };
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const property = value.property ?? value.id ?? value.name ?? null;
  if (typeof property !== 'string' || !property.trim()) {
    return null;
  }

  return {
    direction: normalizeDirection(value.direction ?? value.order, 'asc'),
    explicitDirection: Object.hasOwn(value, 'direction') || Object.hasOwn(value, 'order'),
    property: property.trim(),
  };
}

function normalizeViewSort(value) {
  if (typeof value === 'string' && value.trim()) {
    return [{ direction: 'asc', property: value.trim() }];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { direction: 'asc', property: entry };
      }
      if (!isPlainObject(entry)) {
        return null;
      }

      const property = entry.property ?? entry.id ?? entry.name ?? null;
      if (typeof property !== 'string' || !property.trim()) {
        return null;
      }

      const direction = normalizeDirection(entry.direction ?? entry.order, 'asc');
      return { direction, property: property.trim() };
    })
    .filter(Boolean);
}

function normalizeSummaries(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeSummary(entry, index))
      .filter(Boolean);
  }

  if (isPlainObject(value)) {
    const entries = [];
    Object.entries(value).forEach(([property, propertySummaries]) => {
      if (Array.isArray(propertySummaries)) {
        propertySummaries.forEach((entry, index) => {
          const normalized = normalizeSummary(entry, index, property);
          if (normalized) {
            entries.push(normalized);
          }
        });
        return;
      }

      const normalized = normalizeSummary(propertySummaries, entries.length, property);
      if (normalized) {
        entries.push(normalized);
      }
    });
    return entries;
  }

  return [];
}

function normalizeSummary(entry, index, property = null) {
  if (typeof entry === 'string') {
    return {
      id: `summary-${index}`,
      label: capitalize(entry),
      property,
      type: entry.toLowerCase(),
    };
  }

  if (!isPlainObject(entry)) {
    return null;
  }

  const summaryProperty = typeof (entry.property ?? property) === 'string'
    ? String(entry.property ?? property).trim()
    : null;
  const formula = typeof entry.formula === 'string' ? entry.formula : null;
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : (formula ? 'custom' : null);
  if (!summaryProperty) {
    return null;
  }

  return {
    formula,
    id: `summary-${index}`,
    label: typeof entry.name === 'string' ? entry.name : capitalize(type || 'Summary'),
    property: summaryProperty,
    type,
  };
}

function resolvePropertyLabel(propertyId, definition) {
  const config = definition.properties[propertyId];
  if (config?.displayName) {
    return config.displayName;
  }

  if (propertyId.startsWith('formula.')) {
    return bareFormulaName(propertyId);
  }

  return propertyId.startsWith('file.')
    ? propertyId.slice(5)
    : propertyId.replace(/^note\./u, '');
}

function normalizeFormulaEntries(rawFormulas, rawProperties) {
  const formulas = {};
  const appendFormula = (propertyId, formula, { legacy = false } = {}) => {
    const normalizedId = normalizeFormulaPropertyId(propertyId);
    if (!normalizedId || typeof formula !== 'string') {
      return;
    }

    formulas[normalizedId] = {
      formula,
      id: normalizedId,
      legacy,
      name: bareFormulaName(normalizedId),
    };
  };

  if (isPlainObject(rawFormulas)) {
    Object.entries(rawFormulas).forEach(([name, formula]) => {
      appendFormula(name, formula);
    });
  }

  Object.entries(rawProperties).forEach(([id, config]) => {
    if (typeof config?.formula === 'string') {
      appendFormula(id, config.formula, { legacy: true });
    }
  });

  return formulas;
}

function createFormulaLookup(formulas = {}) {
  const lookup = new Map();

  Object.keys(formulas).forEach((propertyId) => {
    const bareName = bareFormulaName(propertyId);
    if (bareName) {
      lookup.set(bareName, propertyId);
    }
    lookup.set(propertyId, propertyId);
  });

  return lookup;
}

export function parseBaseSource(source = '') {
  const documents = loadAllYaml(String(source ?? ''));
  if (documents.length > 1) {
    throw new Error('Base source must contain a single YAML document');
  }

  return documents[0] ?? {};
}

export function normalizeBaseDefinition(source = '') {
  const raw = parseBaseSource(source);
  const rawObject = isPlainObject(raw) ? raw : {};
  const rawProperties = isPlainObject(rawObject.properties) ? rawObject.properties : {};
  const formulas = normalizeFormulaEntries(rawObject.formulas, rawProperties);
  const properties = Object.entries(rawProperties).reduce((acc, [id, config]) => {
    const normalizedConfig = isPlainObject(config) ? { ...config } : {};
    acc[id] = {
      displayName: typeof normalizedConfig.displayName === 'string' ? normalizedConfig.displayName : null,
      id,
      raw: normalizedConfig,
    };
    return acc;
  }, {});

  const rawViews = Array.isArray(rawObject.views) ? rawObject.views : [];
  const views = rawViews.map((rawView, index) => normalizeBaseView(rawView, index));
  if (views.length === 0) {
    views.push(normalizeBaseView({ name: 'Table', type: 'table' }, 0));
  }

  return {
    filters: rawObject.filters ?? null,
    formulas,
    formulaLookup: createFormulaLookup(formulas),
    properties,
    raw: rawObject,
    views,
  };
}

export function buildColumns(definition, view) {
  const order = view.order.length > 0
    ? view.order
    : ['file.name', ...new Set([
      ...Object.keys(definition.properties),
      ...Object.keys(definition.formulas),
    ])];
  return order.map((propertyId) => ({
    id: propertyId,
    label: resolvePropertyLabel(propertyId, definition),
  }));
}

export function collectEvaluatedPropertyIds(columns, view) {
  const propertyIds = new Set(columns.map((column) => column.id));

  if (view.groupBy?.property) {
    propertyIds.add(view.groupBy.property);
  }

  view.sort.forEach((sortConfig) => {
    if (sortConfig?.property) {
      propertyIds.add(sortConfig.property);
    }
  });

  view.summaries.forEach((summary) => {
    if (summary?.property) {
      propertyIds.add(summary.property);
    }
  });

  return [...propertyIds];
}

export function findView(definition, requestedView = '') {
  return definition.views.find((entry) => entry.name === requestedView || entry.id === requestedView) ?? definition.views[0];
}

export function normalizeRawDefinitionForWrite(definition) {
  const rawDefinition = isPlainObject(definition?.raw)
    ? structuredClone(definition.raw)
    : structuredClone(isPlainObject(definition) ? definition : {});
  const rawProperties = isPlainObject(rawDefinition.properties) ? rawDefinition.properties : {};
  const formulas = isPlainObject(rawDefinition.formulas)
    ? { ...rawDefinition.formulas }
    : {};

  Object.entries(rawProperties).forEach(([propertyId, config]) => {
    if (!isPlainObject(config) || typeof config.formula !== 'string') {
      return;
    }

    formulas[bareFormulaName(propertyId)] = config.formula;
    delete config.formula;
  });

  rawDefinition.properties = rawProperties;
  if (Object.keys(formulas).length > 0) {
    rawDefinition.formulas = formulas;
  } else {
    delete rawDefinition.formulas;
  }

  return rawDefinition;
}

export function serializeBaseDefinition(definition) {
  const raw = normalizeRawDefinitionForWrite(definition);
  return `${dumpYaml(raw, { lineWidth: -1, noRefs: true }).trim()}\n`;
}
